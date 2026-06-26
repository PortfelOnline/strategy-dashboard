import { invokeLLM } from './llm';
import type { SerpData } from './serpParser';

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
    .filter(r => TIER1.some(d => r.domain === d || r.domain.endsWith('.' + d)) && r.snippet)
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

export interface CragStats {
  total: number;
  ok: number;
  corrected: number;
  flagged: number; // unverified — оставлены нетронутыми, только посчитаны
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyCorrection(html: string, claim: Claim, grade: Grade): string {
  if (grade.verdict === 'correct') return html;

  // Якорь — точный snippet. Без него (или если он не найден в html дословно)
  // НЕ трогаем HTML вовсе: безопаснее оставить как есть, чем порвать разметку/прозу
  // или зацепить посторонние числа в другой части статьи.
  if (!claim.snippet || !html.includes(claim.snippet)) return html;

  if (grade.verdict === 'wrong' && grade.correctValue) {
    const valRe = new RegExp(escapeRe(claim.value), 'g');
    let newSnippet = claim.snippet.replace(valRe, grade.correctValue);
    if (newSnippet === claim.snippet) return html; // value не найден внутри snippet → no-op
    if (grade.source) {
      const host = (() => { try { return new URL(grade.source).hostname.replace(/^www\./, ''); } catch { return grade.source; } })();
      // источник добавляем к ПЕРВОМУ исправленному значению внутри snippet
      newSnippet = newSnippet.replace(grade.correctValue, `${grade.correctValue} (по данным ${host})`);
    }
    return html.replace(claim.snippet, newSnippet);
  }

  // unverified → оставляем факт НЕТРОНУТЫМ. Поиск мог быть пуст/сломан (captcha и т.п.),
  // и вырезание тогда калечит прозу. Модифицируем ТОЛЬКО подтверждённо неверные (wrong).
  return html;
}

export async function verifyAndCorrectClaims(
  html: string,
  keyword: string,
  model: string,
  searchFn: SearchFn,
): Promise<{ html: string; stats: CragStats }> {
  const claims = await extractClaims(html, keyword, model);
  const stats: CragStats = { total: claims.length, ok: 0, corrected: 0, flagged: 0 };
  let out = html;
  for (const claim of claims) {
    const grade = await gradeClaim(claim, searchFn, model);
    if (grade.verdict === 'wrong') { out = applyCorrection(out, claim, grade); stats.corrected++; }
    else if (grade.verdict === 'correct') stats.ok++;
    else stats.flagged++; // unverified — оставляем как есть
  }
  console.log(`[CRAG] "${keyword}": ${stats.total} claims → ${stats.ok} ok, ${stats.corrected} corrected, ${stats.flagged} flagged (unverified, оставлены)`);
  return { html: out, stats };
}
