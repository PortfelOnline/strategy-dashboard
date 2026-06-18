# CRAG write-time gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Проверять факты/статистику генерируемых статей против tier-1 источников на этапе генерации (rewriteArticle) и исправлять до публикации.

**Architecture:** Вся логика — в новом файле `server/_core/crag.ts` как чистые функции с dependency injection поисковой функции (`searchFn`). `articles.ts` импортирует `verifyAndCorrectClaims` и вызывает его новым шагом цепочки между `applyCriticalReview` и `beautifyArticleHtml`, под env-флагом `LLM_CRAG_PASS`. Тесты мокают `invokeLLM` и передают фейковый `searchFn`.

**Tech Stack:** TypeScript, Node.js (tsx), Vitest. Переиспользуем `invokeLLM` (`server/_core/llm.ts`) и `fetchGoogleSerp`/`SerpData` (`server/_core/serpParser.ts`).

---

## File Structure

- **Create:** `server/_core/crag.ts` — типы `Claim`/`Grade`/`CragStats`, функции `extractClaims`, `gradeClaim`, `applyCorrection`, `verifyAndCorrectClaims`.
- **Create:** `server/_core/crag.test.ts` — юнит-тесты (мок llm + фейковый searchFn).
- **Modify:** `server/routers/articles.ts` — импорт + вызов в `rewriteArticle` (≈стр. 1936-1943).

---

### Task 1: Типы и `extractClaims`

**Files:**
- Create: `server/_core/crag.ts`
- Test: `server/_core/crag.test.ts`

- [ ] **Step 1: Написать падающий тест**

```typescript
// server/_core/crag.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('./llm', () => ({
  invokeLLM: vi.fn(),
}));
import * as llmModule from './llm';
import { extractClaims } from './crag';

const mockLLM = llmModule.invokeLLM as ReturnType<typeof vi.fn>;

describe('extractClaims', () => {
  it('парсит JSON-список проверяемых утверждений из HTML', async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: '[{"claim":"госпошлина за выписку ЕГРН","value":"350 рублей","type":"fee","snippet":"госпошлина составляет 350 рублей"}]' } }],
    });
    const claims = await extractClaims('<p>госпошлина составляет 350 рублей</p>', 'выписка ЕГРН', 'test-model');
    expect(claims).toHaveLength(1);
    expect(claims[0].value).toBe('350 рублей');
    expect(claims[0].type).toBe('fee');
  });

  it('возвращает [] при невалидном JSON (не роняется)', async () => {
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: 'не json' } }] });
    const claims = await extractClaims('<p>текст</p>', 'ключ', 'test-model');
    expect(claims).toEqual([]);
  });

  it('каппит число утверждений до 8', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}`, value: `${i}`, type: 'stat', snippet: `s${i}` }));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(many) } }] });
    const claims = await extractClaims('<p>x</p>', 'ключ', 'test-model');
    expect(claims).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться что падает**

Run: `npx vitest run server/_core/crag.test.ts`
Expected: FAIL — `Cannot find module './crag'`.

- [ ] **Step 3: Минимальная реализация**

```typescript
// server/_core/crag.ts
import { invokeLLM } from './llm';

export type ClaimType = 'fee' | 'stat' | 'term' | 'law' | 'other';

export interface Claim {
  claim: string;   // что утверждается
  value: string;   // конкретное значение (число/срок/статья)
  type: ClaimType;
  snippet: string; // фрагмент HTML где встречается (для замены)
}

const MAX_CLAIMS = 8;

function stripJson(raw: string): string {
  return raw.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function extractClaims(html: string, keyword: string, model: string): Promise<Claim[]> {
  try {
    const resp = await invokeLLM({
      model,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: 'Ты фактчекер статей по недвижимости РФ. Находишь проверяемые конкретные утверждения. Отвечай ТОЛЬКО валидным JSON-массивом без markdown.' },
        { role: 'user', content: `Из статьи про "${keyword}" вытащи проверяемые утверждения: размеры госпошлин, проценты, сроки, цифры статистики, ссылки на статьи законов. Игнорируй цены kadastrmap.info и общие фразы.\n\nФормат: [{"claim":"<что>","value":"<конкретное значение>","type":"fee|stat|term|law|other","snippet":"<точный фрагмент текста где это написано>"}]\n\nСТАТЬЯ (первые 8000 символов):\n${html.slice(0, 8000)}\n\nВерни ТОЛЬКО JSON-массив.` },
      ],
    });
    const content = resp.choices[0]?.message.content;
    const raw = typeof content === 'string' ? stripJson(content) : '[]';
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: any) => c && typeof c.claim === 'string' && typeof c.value === 'string' && typeof c.snippet === 'string')
      .map((c: any) => ({ claim: c.claim, value: c.value, type: (c.type ?? 'other') as ClaimType, snippet: c.snippet }))
      .slice(0, MAX_CLAIMS);
  } catch (e: any) {
    console.warn('[CRAG] extractClaims failed:', e?.message ?? e);
    return [];
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться что проходит**

Run: `npx vitest run server/_core/crag.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add server/_core/crag.ts server/_core/crag.test.ts
git commit -m "feat(crag): extractClaims — извлечение проверяемых утверждений из HTML"
```

---

### Task 2: `gradeClaim` — оценка против tier-1 поиска

**Files:**
- Modify: `server/_core/crag.ts`
- Test: `server/_core/crag.test.ts`

- [ ] **Step 1: Написать падающий тест** (добавить в `crag.test.ts`)

```typescript
import { gradeClaim } from './crag';
import type { SerpData } from './serpParser';

const fakeSerp = (snippets: string[]): SerpData => ({
  results: snippets.map((s, i) => ({ url: `https://rosreestr.gov.ru/${i}`, domain: 'rosreestr.gov.ru', title: 't', snippet: s })),
  error: '',
} as SerpData);

describe('gradeClaim', () => {
  it('помечает correct когда значение совпадает с tier-1', async () => {
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['госпошлина за выписку ЕГРН — 350 рублей для физлиц']));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"correct"}' } }] });
    const g = await gradeClaim({ claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'госпошлина 350 рублей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('correct');
    expect(searchFn).toHaveBeenCalledOnce();
  });

  it('помечает wrong и возвращает верное значение + источник', async () => {
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['актуальная госпошлина 2000 рублей']));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"wrong","correctValue":"2000 рублей","source":"https://rosreestr.gov.ru/0"}' } }] });
    const g = await gradeClaim({ claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'госпошлина 350 рублей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('wrong');
    expect(g.correctValue).toBe('2000 рублей');
    expect(g.source).toContain('rosreestr.gov.ru');
  });

  it('помечает unverified когда поиск пуст', async () => {
    const searchFn = vi.fn().mockResolvedValue({ results: [], error: '' } as SerpData);
    const g = await gradeClaim({ claim: 'выдумка', value: '99%', type: 'stat', snippet: '99% людей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('unverified');
    expect(mockLLM).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — убедиться что падает**

Run: `npx vitest run server/_core/crag.test.ts -t gradeClaim`
Expected: FAIL — `gradeClaim is not exported`.

- [ ] **Step 3: Реализация** (добавить в `crag.ts`)

```typescript
import type { SerpData } from './serpParser';

export type SearchFn = (query: string) => Promise<SerpData>;

export interface Grade {
  verdict: 'correct' | 'wrong' | 'unverified';
  correctValue?: string;
  source?: string;
}

const TIER1 = ['rosreestr.gov.ru', 'consultant.ru', 'rosstat.gov.ru', 'pravo.gov.ru', 'nalog.ru'];

export async function gradeClaim(claim: Claim, searchFn: SearchFn, model: string): Promise<Grade> {
  const query = `${claim.claim} ${claim.value} ${TIER1.map(d => `site:${d}`).join(' OR ')}`;
  let serp: SerpData;
  try {
    serp = await searchFn(query);
  } catch (e: any) {
    console.warn('[CRAG] search failed:', e?.message ?? e);
    return { verdict: 'unverified' };
  }
  const snippets = (serp.results ?? [])
    .filter(r => TIER1.some(d => r.domain.includes(d)) && r.snippet)
    .slice(0, 5)
    .map(r => `- (${r.url}) ${r.snippet}`)
    .join('\n');
  if (!snippets) return { verdict: 'unverified' };

  try {
    const resp = await invokeLLM({
      model,
      maxTokens: 300,
      messages: [
        { role: 'system', content: 'Ты сверяешь утверждение из статьи с официальными источниками. Отвечай ТОЛЬКО валидным JSON без markdown.' },
        { role: 'user', content: `Утверждение: "${claim.claim} = ${claim.value}".\n\nОфициальные источники (tier-1):\n${snippets}\n\nВердикт:\n- "correct" если значение подтверждается;\n- "wrong" если источники дают другое значение (укажи correctValue и source-url);\n- "unverified" если источники не дают однозначного ответа.\n\nФормат: {"verdict":"correct|wrong|unverified","correctValue":"<если wrong>","source":"<url если wrong>"}` },
      ],
    });
    const content = resp.choices[0]?.message.content;
    const raw = typeof content === 'string' ? stripJson(content) : '{}';
    const parsed = JSON.parse(raw);
    if (parsed.verdict === 'wrong' && parsed.correctValue) {
      return { verdict: 'wrong', correctValue: String(parsed.correctValue), source: parsed.source ? String(parsed.source) : undefined };
    }
    if (parsed.verdict === 'correct') return { verdict: 'correct' };
    return { verdict: 'unverified' };
  } catch (e: any) {
    console.warn('[CRAG] gradeClaim parse failed:', e?.message ?? e);
    return { verdict: 'unverified' };
  }
}
```

- [ ] **Step 4: Запустить — убедиться что проходит**

Run: `npx vitest run server/_core/crag.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add server/_core/crag.ts server/_core/crag.test.ts
git commit -m "feat(crag): gradeClaim — сверка утверждения с tier-1 источниками"
```

---

### Task 3: `applyCorrection` + `verifyAndCorrectClaims` (оркестрация)

**Files:**
- Modify: `server/_core/crag.ts`
- Test: `server/_core/crag.test.ts`

- [ ] **Step 1: Написать падающий тест** (добавить в `crag.test.ts`)

```typescript
import { applyCorrection, verifyAndCorrectClaims } from './crag';

describe('applyCorrection', () => {
  it('wrong → подменяет значение в snippet и добавляет упоминание источника', () => {
    const html = '<p>Госпошлина составляет 350 рублей за услугу.</p>';
    const out = applyCorrection(html,
      { claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'Госпошлина составляет 350 рублей' },
      { verdict: 'wrong', correctValue: '2000 рублей', source: 'https://rosreestr.gov.ru/x' });
    expect(out).toContain('2000 рублей');
    expect(out).not.toContain('350 рублей');
    expect(out.toLowerCase()).toContain('rosreestr.gov.ru');
  });

  it('unverified → убирает конкретное значение из snippet', () => {
    const html = '<p>По статистике 99% россиян заказывают выписку онлайн.</p>';
    const out = applyCorrection(html,
      { claim: 'доля', value: '99%', type: 'stat', snippet: '99% россиян' },
      { verdict: 'unverified' });
    expect(out).not.toContain('99%');
  });

  it('correct → не меняет html', () => {
    const html = '<p>Срок регистрации 7 рабочих дней.</p>';
    const out = applyCorrection(html,
      { claim: 'срок', value: '7 рабочих дней', type: 'term', snippet: '7 рабочих дней' },
      { verdict: 'correct' });
    expect(out).toBe(html);
  });
});

describe('verifyAndCorrectClaims', () => {
  it('прогоняет extract→grade→correct и возвращает статистику', async () => {
    mockLLM.mockReset();
    // extractClaims
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '[{"claim":"госпошлина","value":"350 рублей","type":"fee","snippet":"Госпошлина 350 рублей"}]' } }] });
    // gradeClaim
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"wrong","correctValue":"2000 рублей","source":"https://rosreestr.gov.ru/x"}' } }] });
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['госпошлина 2000 рублей']));
    const res = await verifyAndCorrectClaims('<p>Госпошлина 350 рублей.</p>', 'выписка', 'test-model', searchFn);
    expect(res.html).toContain('2000 рублей');
    expect(res.stats).toEqual({ total: 1, ok: 0, corrected: 1, stripped: 0 });
  });

  it('нет утверждений → html без изменений', async () => {
    mockLLM.mockReset();
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] });
    const searchFn = vi.fn();
    const html = '<p>Текст без фактов.</p>';
    const res = await verifyAndCorrectClaims(html, 'ключ', 'test-model', searchFn);
    expect(res.html).toBe(html);
    expect(searchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — убедиться что падает**

Run: `npx vitest run server/_core/crag.test.ts -t verifyAndCorrectClaims`
Expected: FAIL — `applyCorrection is not exported`.

- [ ] **Step 3: Реализация** (добавить в `crag.ts`)

```typescript
export interface CragStats {
  total: number;
  ok: number;
  corrected: number;
  stripped: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyCorrection(html: string, claim: Claim, grade: Grade): string {
  if (grade.verdict === 'correct') return html;

  if (grade.verdict === 'wrong' && grade.correctValue) {
    // подменяем только сам value внутри текста (не весь snippet, чтобы не порвать разметку)
    const valRe = new RegExp(escapeRe(claim.value), 'g');
    let out = html.replace(valRe, grade.correctValue);
    if (out === html) {
      // value не нашёлся буквально — заменяем целиком snippet
      out = html.replace(claim.snippet, claim.snippet.replace(valRe, grade.correctValue));
    }
    if (grade.source) {
      const host = (() => { try { return new URL(grade.source).hostname.replace(/^www\./, ''); } catch { return grade.source; } })();
      // упоминание источника после исправленного значения (разворачивается post-processing'ом)
      out = out.replace(grade.correctValue, `${grade.correctValue} (по данным ${host})`);
    }
    return out;
  }

  // unverified → убрать конкретное значение, смягчив фразу
  const valRe = new RegExp('\\s*' + escapeRe(claim.value), 'g');
  return html.replace(valRe, '');
}

export async function verifyAndCorrectClaims(
  html: string,
  keyword: string,
  model: string,
  searchFn: SearchFn,
): Promise<{ html: string; stats: CragStats }> {
  const claims = await extractClaims(html, keyword, model);
  const stats: CragStats = { total: claims.length, ok: 0, corrected: 0, stripped: 0 };
  let out = html;
  for (const claim of claims) {
    const grade = await gradeClaim(claim, searchFn, model);
    if (grade.verdict === 'correct') { stats.ok++; continue; }
    out = applyCorrection(out, claim, grade);
    if (grade.verdict === 'wrong') stats.corrected++;
    else stats.stripped++;
  }
  console.log(`[CRAG] "${keyword}": ${stats.total} claims → ${stats.ok} ok, ${stats.corrected} corrected, ${stats.stripped} stripped`);
  return { html: out, stats };
}
```

- [ ] **Step 4: Запустить — убедиться что проходит**

Run: `npx vitest run server/_core/crag.test.ts`
Expected: PASS (все тесты, ~11).

- [ ] **Step 5: Коммит**

```bash
git add server/_core/crag.ts server/_core/crag.test.ts
git commit -m "feat(crag): verifyAndCorrectClaims — оркестрация extract→grade→correct"
```

---

### Task 4: Врезка в `rewriteArticle`

**Files:**
- Modify: `server/routers/articles.ts` (импорт вверху + вызов ≈стр. 1936-1943)

- [ ] **Step 1: Добавить импорт** в начало `articles.ts` (рядом с другими импортами `../_core/...`, ≈стр. 8)

```typescript
import { verifyAndCorrectClaims } from "../_core/crag";
```

- [ ] **Step 2: Вставить шаг CRAG** в `rewriteArticle` сразу ПОСЛЕ блока `applyCriticalReview` (после строки `}` закрывающей `if (process.env.LLM_CRITICAL_PASS !== '0') { ... }`, ≈стр. 1936) и ПЕРЕД `improvedContent = await ensureFeaturedSnippet(...)`:

```typescript
  // CRAG write-time гейт: проверка фактов/статистики против tier-1 источников
  // до публикации. Источник деиндекса — выдуманная статистика — устраняется здесь.
  // Opt-out: LLM_CRAG_PASS=0. Никогда не роняет пайплайн (всё в catch).
  if (process.env.LLM_CRAG_PASS !== '0') {
    improvedContent = await verifyAndCorrectClaims(
      improvedContent,
      keyword,
      seoModel,
      (q: string) => cachedGoogleSerp(q),
    ).then(r => r.html).catch((e) => {
      console.warn('[CRAG] pass skipped:', e?.message ?? e);
      return improvedContent;
    });
  }
```

- [ ] **Step 3: Проверить типы**

Run: `npm run check`
Expected: PASS — без ошибок типов (`verifyAndCorrectClaims` и `cachedGoogleSerp` совместимы, обе используют `SerpData`).

- [ ] **Step 4: Прогнать весь тест-набор (регрессия)**

Run: `npm run test`
Expected: PASS — существующие тесты не сломаны, `crag.test.ts` зелёный.

- [ ] **Step 5: Коммит**

```bash
git add server/routers/articles.ts
git commit -m "feat(crag): врезка write-time гейта в rewriteArticle под LLM_CRAG_PASS"
```

---

### Task 5: Smoke-проверка на живой статье (dry-run)

**Files:** нет (ручная проверка)

- [ ] **Step 1: Прогнать один рерайт с включённым CRAG и логами**

Run (из корня проекта, подставить реальный URL статьи kadastrmap.info):
```bash
LLM_CRAG_PASS=1 SKIP_IMAGES=1 npx tsx scripts/score-articles.ts --one "https://kadastrmap.info/<статья>" 2>&1 | grep -E "\[CRAG\]|\[Critical\]|\[Competitors\]"
```
Expected: в логах строка `[CRAG] "<keyword>": N claims → X ok, Y corrected, Z stripped`.

> Если `scripts/score-articles.ts` не принимает `--one`, использовать существующую точку запуска рерайта одной статьи (см. как вызывается `rewriteArticle` в роутере/скриптах) — цель: увидеть `[CRAG]` лог на одной реальной статье без публикации (`SKIP_IMAGES`/dry-режим).

- [ ] **Step 2: Сверить выхлоп**

Глазами проверить: исправленные значения снабжены «по данным <источник>», выдуманная статистика убрана, верные факты не тронуты.

- [ ] **Step 3: Финальный коммит (если правок не было — пропустить)**

```bash
git commit --allow-empty -m "chore(crag): smoke-проверка write-time гейта на живой статье"
```

---

## Self-Review

**Spec coverage:**
- Write-time гейт между applyCriticalReview и beautifyArticleHtml → Task 4 ✅
- Источник истины tier-1 веб-поиск → `TIER1` + `site:` фильтр в `gradeClaim` (Task 2) ✅
- Correct→strip реакция → `applyCorrection` (Task 3) ✅
- Цитата-пруф при correct → `(по данным <host>)` в `applyCorrection` ✅
- Cost-guard: кап 8 → `MAX_CLAIMS` (Task 1); env opt-out → `LLM_CRAG_PASS` (Task 4); дешёвая модель → передаём `seoModel` (Task 4) ✅
- Никогда не роняет пайплайн → `.catch()` в Task 4 + try/catch внутри каждой функции ✅
- Тестируемость чистой функции → DI `searchFn`, `crag.test.ts` ✅

**Placeholder scan:** код во всех шагах реальный; единственная мягкая формулировка — fallback запуска в Task 5 Step 1 (зависит от наличия CLI-флага в скрипте), помечена явно.

**Type consistency:** `Claim`, `Grade`, `SearchFn`, `CragStats`, `verifyAndCorrectClaims` — имена согласованы между задачами; `searchFn` возвращает `SerpData`, `cachedGoogleSerp` тоже возвращает `SerpData` — совместимы.
