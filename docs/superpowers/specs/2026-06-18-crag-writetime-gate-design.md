# CRAG write-time gate — дизайн

**Дата:** 2026-06-18
**Проект:** strategy-dashboard → `server/routers/articles.ts` (`rewriteArticle`)
**Цель:** убрать выдуманную статистику/факты из генерируемых статей kadastrmap.info на этапе генерации — источник деиндекса. Corrective RAG: проверять каждый факт против tier-1 источников и исправлять до публикации.

## Решения (из брейншторма)

| Вопрос | Выбор |
|---|---|
| Когда вмешивается | Write-time гейт (плохой контент не рождается) |
| Источник истины | Веб-поиск с фильтром на tier-1 домены |
| Реакция на непруф | Correct → иначе strip/смягчить (публикация не блокируется) |

## Точка интеграции

Новый шаг `verifyAndCorrectClaims(content, keyword, model)` в цепочке `rewriteArticle`,
**между** `applyCriticalReview` (≈стр. 1936) **и** `beautifyArticleHtml` (≈1943).

Env-флаг `LLM_CRAG_PASS` (default on, `=0` opt-out) — по образцу `LLM_CRITICAL_PASS`.
Переиспользуем существующую инфраструктуру: `invokeLLM`, `cachedGoogleSerp`.

## Поток данных (5 шагов)

1. **Extract claims.** `invokeLLM` (дешёвый `seoModel`) вытаскивает из HTML проверяемые
   утверждения: числа, проценты, размеры пошлин, сроки, ссылки на статьи законов.
   Возврат JSON `[{claim, value, type, snippet}]`. Кап топ-N по рискованности (default 8).
2. **Retrieve.** Для каждого claim → `cachedGoogleSerp(query)` с принудительным
   доменным фильтром tier-1: `site:rosreestr.gov.ru OR consultant.ru OR rosstat.gov.ru
   OR pravo.gov.ru OR nalog.ru`. Параллельно, с кешем `claimHash → результат`.
3. **Grade.** LLM сравнивает claim со сниппетами tier-1 →
   `correct` / `wrong(value=X, source=url)` / `unverified`.
4. **Correct/strip.** String-replace в HTML:
   - `wrong` → подмена значения на верное + инлайн-ссылка-пруф
     (разворачивается в текст post-processing'ом, упоминание источника остаётся).
   - `unverified` → смягчение формулировки (убрать конкретную цифру).
   - `correct` → оставить, опционально добавить источник.
5. **Log.** `[CRAG] "keyword": 8 claims → 5 ok, 2 corrected, 1 stripped`
   (формат как `[Competitors]` / `[Critical]`).

## Обработка ошибок

Весь шаг обёрнут в `.catch()` → при любом сбое возвращает исходный `content`
(как `applyCriticalReview`). Гейт **никогда не роняет пайплайн** и **не блокирует
публикацию** (выбран correct→strip, не block-on-review).

## Cost-guard

- Кап N=8 claims на статью.
- Кеш SERP + grade по `claimHash`.
- Дешёвая модель на extract/grade.
- Полное отключение одним env `LLM_CRAG_PASS=0`.
- Оценка: +1 extract + ≤8 кешируемых SERP + 1 grade ≈ **+15-25с/статья**
  (в духе critical-pass +20-30с).

## Изоляция / тестируемость

Чистая функция `(html, keyword, model) → html`. Юнит-тесты на фикстурах:
- статья с неверной пошлиной (350₽ вместо 2000₽) → `corrected`;
- выдуманная статистика без пруфа → `stripped`;
- верный факт → не тронут;
- `cachedGoogleSerp` падает → content без изменений.

## Вне области (YAGNI)

- Block-on-review — отмели.
- Отдельная БД пруфов — не строим.
- Ретро-аудит 324 опубликованных статей — отдельный спек, не здесь.
- Только write-time гейт.
