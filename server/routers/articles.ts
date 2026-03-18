import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as cheerio from "cheerio";
import { parseArticleFromUrl, scanCatalog } from "../_core/articleParser";
import { fetchGoogleSerp, fetchYandexSerp, SerpData } from "../_core/serpParser";
import { invokeLLM } from "../_core/llm";
import { generateDallEImage } from "../_core/imageGen";
import * as wp from "../_core/wordpress";
import { createContentPost } from "../db";
import * as articlesDb from "../articles.db";
import * as wordpressDb from "../wordpress.db";

// ── In-memory cache: SERP results + competitor pages (TTL 24h) ───────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const serpCache = new Map<string, { data: SerpData; ts: number }>();
const pageCache = new Map<string, { data: any; ts: number }>();

function cacheGet<T>(map: Map<string, { data: T; ts: number }>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { map.delete(key); return null; }
  return entry.data;
}
function cacheSet<T>(map: Map<string, { data: T; ts: number }>, key: string, data: T): void {
  map.set(key, { data, ts: Date.now() });
}

async function cachedGoogleSerp(keyword: string): Promise<SerpData> {
  const key = `google:${keyword}`;
  const hit = cacheGet(serpCache, key);
  if (hit) { console.log(`[cache] SERP HIT google:${keyword}`); return hit; }
  const result = await fetchGoogleSerp(keyword);
  if (!result.error) cacheSet(serpCache, key, result);
  return result;
}

async function cachedYandexSerp(keyword: string): Promise<SerpData> {
  const key = `yandex:${keyword}`;
  const hit = cacheGet(serpCache, key);
  if (hit) { console.log(`[cache] SERP HIT yandex:${keyword}`); return hit; }
  const result = await fetchYandexSerp(keyword);
  if (!result.error) cacheSet(serpCache, key, result);
  return result;
}

// ─── Актуальные цены с kadastrmap.info/spravki/ ──────────────────────────────
const REAL_PRICES = `Актуальные цены kadastrmap.info:
- Справка об объекте недвижимости — 649 руб.
- Справка о переходе прав — 649 руб.
- Расширенная справка об объекте — 699 руб.
- Справка о кадастровой стоимости — 299 руб.
- Кадастровый план территории квартала — 1 190 руб.
- Ситуационный план (газификация/электрификация) — 2 490 руб.
- План поэтажный с экспликацией БТИ — 3 990 руб.
Срок получения: 5 минут – 24 часа. Получение онлайн (скачать или открыть в личном кабинете), без доставки.`;

// ─── WordPress shortcodes — определяются по ключевому запросу статьи ─────────
function getShortcodesHint(keyword: string): string {
  const kw = keyword.toLowerCase();
  const blocks: string[] = [
    '- [BLOCK_PRICE] — таблица сравнения цен и сроков получения. Вставляй в раздел "Сроки и стоимость" ВСЕГДА.',
  ];
  if (/ситуацион|ситуативн|участ.*план|строительств|ижс|межеван/.test(kw)) {
    blocks.push('- [BLOCK_SITUATIONAL_PLAN] — кнопка заказа ситуационного плана. Вставляй в раздел "Как заказать" или после описания документа.');
  }
  if (/план.*(этаж|помещ|квартир|экспликац)|экспликац|этаж.*план|поэтажн/.test(kw)) {
    blocks.push('- [BLOCK_ETAGI_PLAN] — кнопка заказа плана этажей/экспликации. Вставляй в раздел "Как заказать" или после описания документа.');
  }
  return `${REAL_PRICES}\n\nWORDPRESS ШОРТКОДЫ (вставляй как отдельную строку в HTML):\n${blocks.join('\n')}`;
}
// ─────────────────────────────────────────────────────────────────────────────


export interface SeoAnalysis {
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  headingsSuggestions: { level: string; current: string; suggested: string }[];
  generalSuggestions: string[];
  competitorInsights?: string[];
  score: number;
}

export interface ArticleAnalysisResult {
  analysisId: number | null;
  originalTitle: string;
  originalContent: string;
  originalMetaDescription: string;
  headings: { level: string; text: string }[];
  wordCount: number;
  improvedTitle: string;
  improvedContent: string;
  seo: SeoAnalysis;
}

// ── Server-side Batch Analysis ───────────────────────────────────────────────

interface BatchJobState {
  total: number;
  done: number;
  errors: number;
  running: boolean;
  stop: () => void;
}

const batchJobs = new Map<number, BatchJobState>();

// ── Server-side Batch Rewrite ─────────────────────────────────────────────────

interface BatchRewriteJobState {
  total: number;
  done: number;
  errors: number;
  running: boolean;
  current: string;
  stop: () => void;
}

const batchRewriteJobs = new Map<number, BatchRewriteJobState>();

/** Extract short keyword from title (same logic as frontend extractKeyword) */
function extractKeywordFromTitle(title: string): string {
  if (!title) return '';
  const short = title.split(/[,–—:?]|(?:\s+-\s+)/)[0].trim();
  return short.split(/\s+/).slice(0, 5).join(' ');
}

// Fetch top competitor articles from SERP results
async function fetchCompetitorArticles(
  serpResults: { url: string; domain: string; title: string }[],
  ourDomain: string,
  maxCompetitors = 5,
): Promise<{ position: number; domain: string; title: string; headings: string; content: string; wordCount: number }[]> {
  const competitors = serpResults
    .filter(r => !r.domain.includes(ourDomain) && !ourDomain.includes(r.domain))
    .slice(0, maxCompetitors);

  const fetched = await Promise.allSettled(
    competitors.map(async (r, i) => {
      const cached = cacheGet(pageCache, r.url);
      if (cached) { console.log(`[cache] PAGE HIT ${r.url}`); return cached; }
      const parsed = await Promise.race([
        parseArticleFromUrl(r.url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      const result = {
        position: i + 1,
        domain: r.domain,
        title: parsed.title,
        headings: parsed.headings.map(h => `${h.level}: ${h.text}`).join(' | '),
        content: parsed.content.slice(0, 4000),
        wordCount: parsed.wordCount,
      };
      if (parsed.wordCount > 0) cacheSet(pageCache, r.url, result);
      return result;
    }),
  );

  return fetched
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── LSI keyword extraction from SERP snippets ────────────────────────────────

const RU_STOP_WORDS = new Set(['и','в','на','с','по','для','от','до','из','не','как','что','это','при','за','или','также','а','но','то','о','об','у','к','же','бы','был','была','были','есть','быть','так','вы','вас','ваш','их','они','он','она','через','после','во','со','между','без','чем','если','когда','где','можно','нужно','всё','все','который','которые','которая','которого']);

function extractLsiKeywords(serpResults: { snippet?: string; title?: string }[]): string[] {
  const wordFreq = new Map<string, number>();
  for (const r of serpResults) {
    const text = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
    const words = text.match(/[а-яёa-z]{4,}/g) || [];
    for (const w of words) {
      if (!RU_STOP_WORDS.has(w)) wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
    }
  }
  return Array.from(wordFreq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word]) => word);
}

// ── Post-generation quality check + fix ──────────────────────────────────────

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

async function enhanceIfNeeded(html: string, keyword: string): Promise<string> {
  const wordCount = countWords(html);
  const faqItems = (html.match(/<details/gi) || []).length;
  const hasTable = /<table/i.test(html);

  const tasks: string[] = [];

  if (wordCount < 1800) {
    const needed = 1800 - wordCount;
    // Request 1.5x to compensate for LLM undershoot
    const targetWords = Math.round(needed * 1.5);
    const sections = Math.max(3, Math.ceil(targetWords / 200));
    tasks.push(`Напиши ${sections} новых подробных раздела (<h2>Заголовок</h2><p>минимум 200 слов каждый</p>) которых ещё НЕТ в статье. Суммарно минимум ${targetWords} слов. Используй H2/H3, не H1.`);
  }
  if (faqItems < 10) {
    const faqNeeded = Math.max(10 - faqItems, 5);
    tasks.push(`Добавь раздел FAQ: <h2>Часто задаваемые вопросы</h2> с ${faqNeeded} вопросами в формате:\n<details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details>\n(первый элемент с атрибутом open, остальные без него). НЕ используй <h3> для вопросов.`);
  }
  if (!hasTable) {
    tasks.push(`Добавь таблицу <table> сравнения способов получения документа: колонки — Способ/Срок/Стоимость/Удобство. Цены — только через [BLOCK_PRICE].`);
  }

  if (tasks.length === 0) return html;

  // APPEND approach: generate only new blocks, concatenate to existing html
  const response = await invokeLLM({
    messages: [
      { role: 'system', content: 'Ты SEO-копирайтер. Генерируешь ДОПОЛНИТЕЛЬНЫЙ HTML-контент для добавления в статью. НЕ пересказывай существующий текст. Используй только H2/H3 (не H1). Цены — через [BLOCK_PRICE]. Все упоминания заказа — ТОЛЬКО через /spravki/. НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа. Возвращай ТОЛЬКО новые HTML-блоки.' },
      { role: 'user', content: `Тема: "${keyword}". Существующая статья (${wordCount} слов, начало):\n${html.slice(0, 1500)}...\n\nСгенерируй ДОПОЛНИТЕЛЬНЫЙ HTML (не дублируй то что уже есть):\n${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nВерни ТОЛЬКО новые HTML-блоки без <html>/<body>.` },
    ],
    maxTokens: 4096,
  }).catch(() => null);

  const rawContent = response?.choices[0]?.message.content;
  const addition = typeof rawContent === 'string'
    ? rawContent.trim().replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
    : '';
  if (!addition || countWords(addition) < 50) return html;

  // Insert before conclusion H2, or append at end
  const conclusionMatch = html.match(/(<h2[^>]*>[^<]*(?:[Вв]ывод|[Зз]аключ)[^<]*<\/h2>)/);
  return conclusionMatch
    ? html.replace(conclusionMatch[0], addition + '\n' + conclusionMatch[0])
    : html + '\n' + addition;
}

// ── Extract headings from generated HTML ─────────────────────────────────────
function extractHeadingsFromHtml(html: string): { level: string; text: string }[] {
  const results: { level: string; text: string }[] = [];
  const re = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) results.push({ level: m[1].toUpperCase(), text });
  }
  return results;
}

// ── Normalize heading hierarchy (H1→H2 for all headings after the first H1) ─
function normalizeHeadings(html: string): string {
  let h1Count = 0;
  let inConverted = false;
  return html.replace(/<(\/?)h1(\b[^>]*)?>/gi, (_match, slash, attrs) => {
    if (!slash) {
      h1Count++;
      if (h1Count > 1) { inConverted = true; return `<h2${attrs || ''}>`; }
      inConverted = false;
      return _match;
    } else {
      if (inConverted) { inConverted = false; return '</h2>'; }
      return _match;
    }
  });
}

// ── Remove first H1 from content (WP theme already renders post title as H1) ─
function stripFirstH1(html: string): string {
  return html.replace(/<h1[^>]*>.*?<\/h1>\s*/i, '');
}

// ── Internal links from user's article history ───────────────────────────────

async function addInternalLinks(html: string, userId: number, ourDomain: string, currentTitle: string): Promise<string> {
  const history = await articlesDb.getUserAnalysisHistory(userId, 300).catch(() => []);

  // Only articles from same domain, deduplicated by URL
  const seen = new Set<string>();
  const siteArticles = history
    .filter(a => {
      try {
        const domain = new URL(a.url).hostname.replace(/^www\./, '');
        if (domain !== ourDomain || seen.has(a.url)) return false;
        seen.add(a.url);
        return true;
      } catch { return false; }
    })
    .map(a => ({ url: a.url, title: a.originalTitle || '' }))
    .filter(a => a.title && a.title !== currentTitle)
    .slice(0, 100);

  if (siteArticles.length === 0) return html;

  // Extract key words from current article title (first 4 words)
  const currentWords = currentTitle.toLowerCase().split(/\s+/).slice(0, 4);

  // Find articles with 2+ matching words
  const related = siteArticles
    .map(a => {
      const titleWords = a.title.toLowerCase().split(/\s+/);
      const matches = currentWords.filter(w => w.length > 3 && titleWords.some(tw => tw.includes(w) || w.includes(tw)));
      return { ...a, score: matches.length };
    })
    .filter(a => a.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (related.length === 0) return html;

  const linksBlock = `\n<h2>Полезные материалы по теме</h2>\n` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:1em 0 2em;">\n` +
    related.map(a =>
      `<a href="${a.url}" style="display:block;padding:12px 16px;background:#f0fdf4;border:1px solid #22c55e;` +
      `border-radius:8px;text-decoration:none;color:#166534;font-weight:500;font-size:14px;line-height:1.4;">` +
      `${a.title}</a>`
    ).join('\n') +
    `\n</div>\n`;

  // Insert before last h2 (conclusion) if exists, otherwise append
  const lastH2Match = html.match(/(<h2[^>]*>[^<]*(?:[Вв]ывод|[Зз]аключ)[^<]*<\/h2>)/);
  return lastH2Match
    ? html.replace(lastH2Match[0], linksBlock + lastH2Match[0])
    : html + linksBlock;
}

async function analyzeAndSaveArticle(userId: number, url: string): Promise<void> {
  const parsed = await parseArticleFromUrl(url);
  const contentForLLM = parsed.content.slice(0, 6000);
  const serpKeyword = extractKeywordFromTitle(parsed.title);
  const ourDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  // Step 1: Google + Яндекс параллельно
  const [googleSerp, yandexSerp] = await Promise.all([
    cachedGoogleSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
    cachedYandexSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
  ]);

  // Дедупликация по домену: Яндекс добавляет уникальных конкурентов
  const seenDomains = new Set(googleSerp.results.map((r: any) => r.domain));
  const mergedResults = [
    ...googleSerp.results,
    ...yandexSerp.results.filter((r: any) => r.url && !seenDomains.has(r.domain)),
  ];

  // Step 2: fetch top-5 competitor articles from combined SERP
  const competitors = await fetchCompetitorArticles(mergedResults, ourDomain);

  // Step 3: build competitor context for prompts
  const avgCompetitorWords = competitors.length > 0
    ? Math.round(competitors.reduce((s, c) => s + (c.wordCount || 0), 0) / competitors.length)
    : 1200;
  const maxCompetitorWords = competitors.length > 0
    ? Math.max(...competitors.map(c => c.wordCount || 0))
    : 1200;
  const targetWords = Math.max(1800, Math.round(maxCompetitorWords * 1.3));

  const competitorContext = competitors.length > 0
    ? competitors.map((c, i) => `Конкурент #${i + 1} (${c.domain}, ~${c.wordCount} слов):
  Заголовок: ${c.title}
  Структура: ${c.headings || '—'}
  Текст (фрагмент): ${c.content}`).join('\n\n')
    : '(конкуренты недоступны)';

  const ourHeadings = parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ');

  // Extract missing H2 topics from competitors + LSI keywords from SERP
  const ourH2s = new Set(
    (parsed.headings || []).filter((h: any) => h.level === 'H2').map((h: any) => h.text.toLowerCase())
  );
  const missingTopics = competitors.flatMap(c =>
    (c.headings || '').split(' | ')
      .filter(h => h.startsWith('H2:'))
      .map(h => h.replace('H2:', '').trim())
      .filter(h => h && !ourH2s.has(h.toLowerCase()))
  );
  const uniqueMissingTopics = Array.from(new Set(missingTopics));
  const missingTopicsBlock = uniqueMissingTopics.length > 0
    ? `\nТЕМЫ КОНКУРЕНТОВ КОТОРЫХ НЕТ В НАШЕЙ СТАТЬЕ (обязательно добавить):\n${uniqueMissingTopics.map(t => `- ${t}`).join('\n')}\n`
    : '';
  const lsiKeywords = extractLsiKeywords([...googleSerp.results, ...yandexSerp.results]);
  const lsiBlock = lsiKeywords.length > 0
    ? `\nLSI-ТЕРМИНЫ (должны встречаться в статье): ${lsiKeywords.join(', ')}\n`
    : '';

  const seoPrompt = `Ты SEO-эксперт по российскому рынку. Проанализируй нашу статью с учётом конкурентов из поисковой выдачи и верни JSON.

Наша статья:
Заголовок: ${parsed.title}
Ключевой запрос: ${serpKeyword}
Мета-описание: ${parsed.metaDescription || '(отсутствует)'}
Структура заголовков: ${ourHeadings}
Объём: ${parsed.wordCount} слов
Текст (фрагмент): ${contentForLLM}

Топ конкуренты из SERP (средний объём: ${avgCompetitorWords} слов):
${competitorContext}

Верни ТОЛЬКО валидный JSON без markdown-блоков:
{
  "metaTitle": "оптимизированный title с ключом в начале (до 60 символов)",
  "metaDescription": "мета-описание с призывом к действию и ключом (до 160 символов)",
  "keywords": ["ключевое1", "LSI-термин2", ...до 10 штук],
  "headingsSuggestions": [{ "level": "H1", "current": "текущий", "suggested": "улучшенный с ключом" }],
  "generalSuggestions": ["конкретный совет с примером", ...до 7 советов],
  "competitorInsights": ["тема/раздел у конкурентов которого нет у нас", ...до 5 пунктов],
  "missingFaqQuestions": ["Вопрос из блока Люди также спрашивают?", ...до 5],
  "conversionTips": ["как усилить конверсию в заказ справки", ...до 3],
  "score": 75
}`;

  const improvePrompt = `Ты SEO-копирайтер экстра-класса для русскоязычного поиска. Цель: переписать статью так, чтобы она вышла в ТОП-3 Яндекса и Google по запросу "${serpKeyword}".

НАША СТАТЬЯ (${parsed.wordCount} слов):
Заголовок: ${parsed.title}
Структура: ${ourHeadings}
Текст:
${contentForLLM}

КОНКУРЕНТЫ В ТОП-${competitors.length} (средний объём: ${avgCompetitorWords} слов):
${competitorContext}
${missingTopicsBlock}${lsiBlock}
ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов (конкуренты пишут в среднем ${avgCompetitorWords} слов — нужно превзойти)
2. Структура HTML: один H1, 6-10 подзаголовков H2, H3 где уместно, списки <ul>/<ol>, таблицы <table> где есть данные для сравнения
3. Начало: прямой ответ на запрос "${serpKeyword}" в первых 2-3 предложениях (featured snippet)
4. Охват тем: включи ВСЕ темы конкурентов которых нет у нас
5. FAQ-раздел: H2 "Часто задаваемые вопросы" с минимум 10 вопросами СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные без. НЕ используй <h3> для вопросов (важно для блока "Люди также спрашивают" в Яндексе)
6. E-E-A-T: добавь конкретные факты, числа, сроки, стоимости, ссылки на законы где уместно. ${getShortcodesHint(serpKeyword)}
7. Пошаговые инструкции: нумерованные списки для процессов
8. Все упоминания заказа документов — ТОЛЬКО через /spravki/ (<a>-ссылка). НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Сохрани язык и стиль оригинала

Верни ТОЛЬКО готовый HTML-текст статьи используя теги: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <td>, <th>, <strong>, <em>. Без <html>/<body>/<head> тегов.`;

  const [seoResponse, improvedResponse] = await Promise.all([
    invokeLLM({ messages: [{ role: 'system', content: 'Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON.' }, { role: 'user', content: seoPrompt }] }),
    invokeLLM({ messages: [{ role: 'system', content: 'Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 1800+ слов для топа поиска. Никогда не сокращай разделы — каждый H2 минимум 200 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE], не вставляй конкретные цифры цен в рублях.' }, { role: 'user', content: improvePrompt }], maxTokens: 8192 }),
  ]);

  let seo: SeoAnalysis;
  try {
    const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
      ? seoResponse.choices[0].message.content.trim() : '{}';
    seo = JSON.parse(seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    seo = { metaTitle: parsed.title, metaDescription: parsed.metaDescription, keywords: [], headingsSuggestions: [], generalSuggestions: [], score: 0 };
  }

  let improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
    ? improvedResponse.choices[0].message.content.trim()
        .replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
    : parsed.content;

  improvedContent = await enhanceIfNeeded(improvedContent, serpKeyword);
  improvedContent = stripFirstH1(normalizeHeadings(improvedContent));
  improvedContent = beautifyArticleHtml(improvedContent);

  const improvedWordCount = improvedContent
    ? improvedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
    : parsed.wordCount;

  // Find our position in each SERP
  const findPos = (results: { domain: string }[]) => {
    if (!ourDomain) return null;
    const idx = results.findIndex(r => r.domain.includes(ourDomain) || ourDomain.includes(r.domain));
    return idx >= 0 ? idx + 1 : null;
  };
  const googlePos = findPos(googleSerp.results);
  const yandexPos = findPos(yandexSerp.results);

  await articlesDb.saveArticleAnalysis(userId, {
    url,
    originalTitle: parsed.title,
    originalContent: parsed.content,
    wordCount: improvedWordCount,
    improvedTitle: seo.metaTitle || parsed.title,
    improvedContent,
    metaTitle: seo.metaTitle || null,
    metaDescription: seo.metaDescription || null,
    keywords: JSON.stringify(seo.keywords || []),
    generalSuggestions: JSON.stringify(seo.generalSuggestions || []),
    headings: JSON.stringify(parsed.headings || []),
    seoScore: seo.score || 0,
    serpKeyword: serpKeyword || null,
    googlePos,
    yandexPos,
  });
}

async function runBatchJob(userId: number, urls: string[]): Promise<void> {
  let stopped = false;
  const queue = [...urls];
  const state: BatchJobState = {
    total: urls.length,
    done: 0,
    errors: 0,
    running: true,
    stop: () => { stopped = true; },
  };
  batchJobs.set(userId, state);

  const CONCURRENCY = 3;
  async function worker(): Promise<void> {
    while (!stopped) {
      const url = queue.shift();
      if (!url) break;
      try {
        await analyzeAndSaveArticle(userId, url);
      } catch (err) {
        console.error(`[Batch] Failed: ${url}`, err);
        state.errors++;
      }
      state.done++;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  state.running = false;
  setTimeout(() => { if (!batchJobs.get(userId)?.running) batchJobs.delete(userId); }, 30 * 60 * 1000);
}

async function rewriteArticle(userId: number, url: string): Promise<void> {
  const parsed = await parseArticleFromUrl(url);
  const ourDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const keyword = extractKeywordFromTitle(parsed.title);

  // Google + Яндекс параллельно
  const [googleSerp, yandexSerp] = await Promise.all([
    cachedGoogleSerp(keyword).catch(() => ({ results: [] as any[], error: '' })),
    cachedYandexSerp(keyword).catch(() => ({ results: [] as any[], error: '' })),
  ]);

  // Дедупликация по домену
  const seenDomains = new Set(googleSerp.results.map((r: any) => r.domain));
  const mergedSerp = [
    ...googleSerp.results.filter((r: any) => r.url),
    ...yandexSerp.results.filter((r: any) => r.url && !seenDomains.has(r.domain)),
  ];

  const competitors = await fetchCompetitorArticles(mergedSerp, ourDomain, 5);
  const avgCompetitorWords = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length) : 1200;
  const maxCompetitorWords = competitors.length
    ? Math.max(...competitors.map(c => c.wordCount)) : 1200;
  const targetWords = Math.max(1800, Math.round(maxCompetitorWords * 1.3));

  // Extract unique H2 headings from competitors that our article is missing
  const ourH2s = new Set(
    (parsed.headings || []).filter((h: any) => h.level === 'H2').map((h: any) => h.text.toLowerCase())
  );
  const missingTopics = competitors.flatMap(c =>
    (c.headings || '').split(' | ')
      .filter(h => h.startsWith('H2:'))
      .map(h => h.replace('H2:', '').trim())
      .filter(h => h && !ourH2s.has(h.toLowerCase()))
  );
  const uniqueMissingTopics = Array.from(new Set(missingTopics));

  // Use SERP snippets as fallback context when competitor articles couldn't be parsed
  const serpFallback = googleSerp.results
    .filter((r: any) => !r.domain.includes(ourDomain) && r.snippet)
    .slice(0, 5)
    .map((r: any) => `- ${r.title}: ${r.snippet}`)
    .join('\n');

  const competitorContext = competitors.length
    ? competitors.map(c =>
        `--- Конкурент ${c.position}: ${c.domain} (${c.wordCount} слов) ---\nЗаголовки: ${c.headings}\nФрагмент:\n${c.content.slice(0, 3000)}`
      ).join('\n\n')
    : serpFallback
      ? `(полный текст конкурентов недоступен, используй сниппеты из SERP)\n${serpFallback}`
      : null;

  const missingTopicsBlock = uniqueMissingTopics.length > 0
    ? `\nТЕМЫ КОНКУРЕНТОВ КОТОРЫХ НЕТ В НАШЕЙ СТАТЬЕ (обязательно добавить):\n${uniqueMissingTopics.map(t => `- ${t}`).join('\n')}\n`
    : '';

  // LSI keywords from all SERP results
  const lsiKeywords = extractLsiKeywords([...googleSerp.results, ...yandexSerp.results]);
  const lsiBlock = lsiKeywords.length > 0
    ? `\nLSI-ТЕРМИНЫ (должны встречаться в статье): ${lsiKeywords.join(', ')}\n`
    : '';

  const improvePrompt = competitorContext
    ? `Ключ: "${keyword}"

Наша статья (${parsed.wordCount} слов):
${parsed.title}
${parsed.content.slice(0, 3000)}

КОНКУРЕНТЫ ТОП-5 (лучший конкурент: ${maxCompetitorWords} слов, средний: ${avgCompetitorWords} слов):
${competitorContext}
${missingTopicsBlock}${lsiBlock}
ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов — это 30% БОЛЬШЕ лучшего конкурента (${maxCompetitorWords} слов). Каждый раздел должен быть полным, не обрывай мысль.
2. HTML: H1, H2 (7-12), H3 где уместно, <ul>/<ol>, <table> для сравнений и данных
3. Прямой ответ на "${keyword}" в первых 2-3 предложениях (featured snippet для Яндекса)
4. Покрой ВСЕ темы из списка "ТЕМЫ КОНКУРЕНТОВ" выше плюс добавь уникальный угол — то чего нет ни у кого
5. FAQ: H2 "Часто задаваемые вопросы" с минимум 10 вопросами-ответами в формате <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> (первый с open, остальные без). НЕ используй <h3> для вопросов — только <details>/<summary>.
6. E-E-A-T: конкретные числа, сроки, законы РФ, стоимости, примеры из практики. ${getShortcodesHint(keyword)}
7. Все упоминания заказа документов — ТОЛЬКО через /spravki/ (ссылка <a>). НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
8. Качество: пиши лучше конкурентов — более подробно, структурировано, с конкретными примерами и полезными деталями которых у них нет.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Внешние авторитетные ссылки: добавь 2-3 ссылки на официальные источники — <a href="https://rosreestr.gov.ru">rosreestr.gov.ru</a>, ФЗ-218 "О государственной регистрации недвижимости". Это обязательно для E-E-A-T.
12. СТРОГО по теме запроса "${keyword}" — НЕ включай разделы про другие продукты (выписки ЕГРН, отчёты о недвижимости и т.д.) если они не относятся к теме. Только релевантные разделы.

Верни ТОЛЬКО HTML без <html>/<body>.`
    : `Ключ: "${keyword}"\n\nОригинальная статья (${parsed.wordCount} слов):\n${parsed.title}\n${parsed.content.slice(0, 5000)}\n${lsiBlock}\nНапиши расширенную SEO-статью строго по следующей структуре. Каждый раздел ОБЯЗАТЕЛЕН и должен содержать указанный минимум слов:\n\n<h1>${parsed.title}</h1>\n<p>[Прямой ответ: что такое "${keyword}" — 120-150 слов, featured snippet]</p>\n\n<h2>Что такое ${keyword}</h2>\n<p>[Подробное определение, правовая база, зачем нужно — 200-250 слов]</p>\n\n<h2>Когда требуется ${keyword}</h2>\n<p>[5-7 конкретных случаев с пояснением — 200-250 слов]</p>\n\n<h2>Какие сведения содержит ${keyword}</h2>\n<p>[Список с пояснениями — 200-250 слов, используй <ul>]</p>\n\n<h2>Как заказать ${keyword} онлайн через kadastrmap.info</h2>\n<p>[Пошаговая инструкция заказа через <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 250-300 слов, используй <ol>]</p>\n\n<h2>Сроки и стоимость</h2>\n<p>[Вступление к разделу — 1-2 предложения]</p>\n[BLOCK_PRICE]\n<p>[Краткое пояснение — 60-80 слов]</p>\n\n<h2>Преимущества заказа через kadastrmap.info</h2>\n<p>[Почему удобнее заказать на нашем сайте: скорость, простота, электронная доставка — 200-250 слов]</p>\n\n<h2>Типичные ошибки при заказе</h2>\n<p>[4-5 частых ошибок с советами — 150-200 слов]</p>\n\n<h2>Часто задаваемые вопросы</h2>\n[10 вопросов-ответов СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с атрибутом open, остальные 9 без него. НЕ используй <h3> для вопросов.]\n\n<h2>Вывод</h2>\n<p>[Итог + CTA: заказать на <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 100-120 слов]</p>\n\nПравила:\n- Все упоминания заказа документов — ТОЛЬКО через /spravki/ (вставляй как ссылку <a>). НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.\n- Конкретные факты, законы РФ, сроки. Цены — ТОЛЬКО через [BLOCK_PRICE], не вставляй цифры.\n- FAQ ТОЛЬКО через <details class="faq-item">/<summary>, НЕ через <h3>.\n- Только HTML без <html>/<body>.\n- Не сокращай разделы — каждый должен быть полным.`;

  const [seoResponse, improvedResponse] = await Promise.all([
    invokeLLM({
      messages: [
        { role: 'system', content: 'Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON.' },
        { role: 'user', content: `Ты SEO-эксперт. Проанализируй статью и верни JSON:\nЗаголовок: ${parsed.title}\nКлюч: ${keyword}\nОбъём: ${parsed.wordCount} слов (целевой объём: 1800+ слов)\n\nВерни ТОЛЬКО валидный JSON:\n{"metaTitle":"до 60 симв","metaDescription":"до 160 симв","keywords":["ключ1"],"headingsSuggestions":[],"generalSuggestions":["совет"],"score":75}` },
      ],
    }),
    invokeLLM({
      messages: [
        { role: 'system', content: 'Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 1800+ слов для топа поиска. Каждый H2-раздел минимум 200 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE], не вставляй конкретные цифры цен.' },
        { role: 'user', content: improvePrompt },
      ],
      maxTokens: 8192,
    }),
  ]);

  let seo: SeoAnalysis;
  try {
    const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
      ? seoResponse.choices[0].message.content.trim() : '{}';
    seo = JSON.parse(seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    seo = { metaTitle: parsed.title, metaDescription: parsed.metaDescription, keywords: [], headingsSuggestions: [], generalSuggestions: [], score: 0 };
  }

  let improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
    ? improvedResponse.choices[0].message.content.trim()
        .replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
    : parsed.content;

  // Post-generation quality check: add missing FAQ questions or table
  improvedContent = await enhanceIfNeeded(improvedContent, keyword);
  improvedContent = stripFirstH1(normalizeHeadings(improvedContent));
  improvedContent = beautifyArticleHtml(improvedContent);

  // Add internal links to related articles on the same site
  improvedContent = await addInternalLinks(improvedContent, userId, ourDomain, parsed.title);

  const improvedWordCount = improvedContent
    ? improvedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
    : parsed.wordCount;

  const findPos = (results: { domain: string }[]) => {
    if (!ourDomain) return null;
    const idx = results.findIndex(r => r.domain.includes(ourDomain) || ourDomain.includes(r.domain));
    return idx >= 0 ? idx + 1 : null;
  };

  await articlesDb.saveArticleAnalysis(userId, {
    url,
    originalTitle: parsed.title,
    originalContent: parsed.content,
    wordCount: improvedWordCount,
    improvedTitle: seo.metaTitle || parsed.title,
    improvedContent,
    metaTitle: seo.metaTitle || null,
    metaDescription: seo.metaDescription || null,
    keywords: JSON.stringify(seo.keywords || []),
    generalSuggestions: JSON.stringify(seo.generalSuggestions || []),
    headings: JSON.stringify(parsed.headings || []),
    seoScore: seo.score || 0,
    serpKeyword: keyword || null,
    googlePos: findPos(googleSerp.results),
    yandexPos: findPos(yandexSerp.results),
  });
}

export async function runBatchRewrite(userId: number, urls: string[]): Promise<void> {
  let stopped = false;
  const queue = [...urls];
  const state: BatchRewriteJobState = {
    total: urls.length,
    done: 0,
    errors: 0,
    running: true,
    current: '',
    stop: () => { stopped = true; },
  };
  batchRewriteJobs.set(userId, state);

  // Sequential (1 at a time) to avoid hammering SERP proxies
  while (!stopped && queue.length > 0) {
    const url = queue.shift()!;
    state.current = url;
    try {
      await rewriteArticle(userId, url);
    } catch (err) {
      console.error(`[BatchRewrite] Failed: ${url}`, err);
      state.errors++;
    }
    state.done++;
  }

  state.running = false;
  state.current = '';
  setTimeout(() => { if (!batchRewriteJobs.get(userId)?.running) batchRewriteJobs.delete(userId); }, 30 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────

export const articlesRouter = router({
  /**
   * Scan a catalog listing page and return article links (no AI, just parsing)
   */
  scanCatalog: protectedProcedure
    .input(z.object({
      url:      z.string().url(),
      maxPages: z.number().min(1).max(500).default(1),
      startPage: z.number().min(1).default(1),
    }))
    .mutation(async ({ input }) => {
      try {
        const result = await scanCatalog(input.url, input.maxPages, input.startPage);
        return result;
      } catch (error: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Не удалось сканировать каталог: ${error?.message || 'неизвестная ошибка'}`,
        });
      }
    }),

  /**
   * Fetch article from URL, analyze + improve with AI, auto-save to history
   */
  analyzeUrl: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }): Promise<ArticleAnalysisResult> => {
      // 1. Parse article
      let parsed;
      try {
        parsed = await parseArticleFromUrl(input.url);
      } catch (error: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Не удалось загрузить статью: ${error?.message || 'неизвестная ошибка'}`,
        });
      }

      const contentForLLM = parsed.content.slice(0, 6000);
      const serpKeyword = extractKeywordFromTitle(parsed.title);
      const ourDomain = (() => { try { return new URL(input.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

      // 2. Fetch SERP — Google + Яндекс параллельно
      const [googleSerp, yandexSerp] = await Promise.all([
        cachedGoogleSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
        cachedYandexSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
      ]);

      // Дедупликация по домену
      const seenDomains = new Set(googleSerp.results.map((r: any) => r.domain));
      const mergedSerpResults = [
        ...googleSerp.results,
        ...yandexSerp.results.filter((r: any) => r.url && !seenDomains.has(r.domain)),
      ];

      const competitors = await fetchCompetitorArticles(mergedSerpResults, ourDomain);

      const avgCompetitorWords = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + (c.wordCount || 0), 0) / competitors.length)
        : 1200;
      const maxCompetitorWords = competitors.length > 0
        ? Math.max(...competitors.map(c => c.wordCount || 0))
        : 1200;
      const targetWords = Math.max(1800, Math.round(maxCompetitorWords * 1.3));

      // Extract unique H2 topics from competitors missing in our article
      const ourH2s = new Set(
        (parsed.headings || []).filter((h: any) => h.level === 'H2').map((h: any) => h.text.toLowerCase())
      );
      const missingTopics = competitors.flatMap(c =>
        (c.headings || '').split(' | ')
          .filter(h => h.startsWith('H2:'))
          .map(h => h.replace('H2:', '').trim())
          .filter(h => h && !ourH2s.has(h.toLowerCase()))
      );
      const uniqueMissingTopics = Array.from(new Set(missingTopics));

      // SERP snippets fallback when full competitor content unavailable
      const serpFallback = googleSerp.results
        .filter((r: any) => !r.domain.includes(ourDomain) && r.snippet)
        .slice(0, 5)
        .map((r: any) => `- ${r.title}: ${r.snippet}`)
        .join('\n');

      const competitorContext = competitors.length > 0
        ? competitors.map(c =>
            `--- Конкурент ${c.position}: ${c.domain} (${c.wordCount} слов) ---\nЗаголовки: ${c.headings}\nФрагмент:\n${c.content.slice(0, 3000)}`
          ).join('\n\n')
        : serpFallback
          ? `(полный текст конкурентов недоступен, используй сниппеты из SERP)\n${serpFallback}`
          : null;

      const missingTopicsBlock = uniqueMissingTopics.length > 0
        ? `\nТЕМЫ КОНКУРЕНТОВ КОТОРЫХ НЕТ В НАШЕЙ СТАТЬЕ (обязательно добавить):\n${uniqueMissingTopics.map(t => `- ${t}`).join('\n')}\n`
        : '';

      // LSI keywords from both SERPs
      const lsiKeywords = extractLsiKeywords([...googleSerp.results, ...yandexSerp.results]);
      const lsiBlock = lsiKeywords.length > 0
        ? `\nLSI-ТЕРМИНЫ (должны встречаться в статье): ${lsiKeywords.join(', ')}\n`
        : '';

      const ourHeadings = parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ');

      // 3. SEO analysis + improved text — parallel, with competitor context
      const seoPrompt = `Ты SEO-эксперт по российскому рынку. Проанализируй статью и верни JSON.

Статья (ПОСЛЕ улучшения ИИ):
Заголовок: ${parsed.title}
Ключевой запрос: ${serpKeyword}
Объём: ${parsed.wordCount} слов → целевой после улучшения: 1800+ слов
Структура: ${ourHeadings}

Правила оценки score (0-100):
- 1800+ слов → +20
- 7+ H2 заголовков → +15
- Ключ в H1 и первом абзаце → +15
- FAQ раздел (6+ вопросов) → +10
- Таблица сравнения → +10
- Внешние ссылки на авторитетные источники (rosreestr.gov.ru и др.) → +10
- Внутренние ссылки на другие страницы сайта → +10
- Ключевые слова в подзаголовках → +10

Верни ТОЛЬКО валидный JSON:
{"metaTitle":"до 60 симв","metaDescription":"до 160 симв","keywords":["ключ1"],"headingsSuggestions":[],"generalSuggestions":["совет"],"score":75}`;

      const improvePrompt = competitorContext
        ? `Ключ: "${serpKeyword}"

Наша статья (${parsed.wordCount} слов):
${parsed.title}
${parsed.content.slice(0, 3000)}

КОНКУРЕНТЫ ТОП-5 (лучший конкурент: ${maxCompetitorWords} слов, средний: ${avgCompetitorWords} слов):
${competitorContext}
${missingTopicsBlock}${lsiBlock}
ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов — это 30% БОЛЬШЕ лучшего конкурента (${maxCompetitorWords} слов). Каждый раздел должен быть полным, не обрывай мысль.
2. HTML: H1, H2 (7-12), H3 где уместно, <ul>/<ol>, <table> для сравнений и данных
3. Прямой ответ на "${serpKeyword}" в первых 2-3 предложениях (featured snippet для Яндекса)
4. Покрой ВСЕ темы из списка "ТЕМЫ КОНКУРЕНТОВ" выше плюс добавь уникальный угол — то чего нет ни у кого
5. FAQ: H2 "Часто задаваемые вопросы" с минимум 10 вопросами СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные без. НЕ используй <h3> для вопросов — только <details>/<summary> (блок "Люди также спрашивают")
6. E-E-A-T: конкретные числа, сроки, законы РФ, стоимости, примеры из практики. ${getShortcodesHint(serpKeyword)}
7. Все упоминания заказа документов — ТОЛЬКО через /spravki/ (ссылка <a>). НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
8. Качество: пиши лучше конкурентов — более подробно, структурировано, с конкретными примерами и полезными деталями которых у них нет.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Внешние авторитетные ссылки: добавь 2-3 ссылки на официальные источники — <a href="https://rosreestr.gov.ru">rosreestr.gov.ru</a>, ФЗ-218 "О государственной регистрации недвижимости". Это обязательно для E-E-A-T.
12. СТРОГО по теме запроса "${serpKeyword}" — НЕ включай разделы про другие продукты (выписки ЕГРН, отчёты о недвижимости и т.д.) если они не относятся к теме. Только релевантные разделы.

Верни ТОЛЬКО HTML без <html>/<body>.`
        : `Ключ: "${serpKeyword}"\n\nОригинальная статья (${parsed.wordCount} слов):\n${parsed.title}\n${parsed.content.slice(0, 5000)}\n\nНапиши расширенную SEO-статью строго по следующей структуре. Каждый раздел ОБЯЗАТЕЛЕН и должен содержать указанный минимум слов:\n\n<h1>${parsed.title}</h1>\n<p>[Прямой ответ: что такое "${serpKeyword}" — 120-150 слов, featured snippet]</p>\n\n<h2>Что такое ${serpKeyword}</h2>\n<p>[Подробное определение, правовая база, зачем нужно — 200-250 слов]</p>\n\n<h2>Когда требуется ${serpKeyword}</h2>\n<p>[5-7 конкретных случаев с пояснением — 200-250 слов]</p>\n\n<h2>Какие сведения содержит ${serpKeyword}</h2>\n<p>[Список с пояснениями — 200-250 слов, используй <ul>]</p>\n\n<h2>Как заказать ${serpKeyword} онлайн через kadastrmap.info</h2>\n<p>[Пошаговая инструкция заказа через <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 250-300 слов, используй <ol>]</p>\n\n<h2>Сроки и стоимость</h2>\n<p>[Вступление к разделу — 1-2 предложения]</p>\n[BLOCK_PRICE]\n<p>[Краткое пояснение — 60-80 слов]</p>\n\n<h2>Преимущества заказа через kadastrmap.info</h2>\n<p>[Почему удобнее заказать на нашем сайте: скорость, простота, электронная доставка — 200-250 слов]</p>\n\n<h2>Типичные ошибки при заказе</h2>\n<p>[4-5 частых ошибок с советами — 150-200 слов]</p>\n\n<h2>Часто задаваемые вопросы</h2>\n[10 вопросов-ответов СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные 9 без него. НЕ используй <h3> для вопросов.]\n\n<h2>Вывод</h2>\n<p>[Итог + CTA: заказать на <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 100-120 слов]</p>\n\nПравила:\n- Все упоминания заказа документов — ТОЛЬКО через /spravki/ (<a>-ссылка). НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.\n- Конкретные факты, законы РФ, сроки. Цены — ТОЛЬКО через [BLOCK_PRICE], не вставляй цифры.\n- FAQ ТОЛЬКО через <details class="faq-item">/<summary>, НЕ через <h3>.\n- Только HTML без <html>/<body>.\n- Не сокращай разделы — каждый должен быть полным.`;

      const [seoResponse, improvedResponse] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: "Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON." },
            { role: "user", content: seoPrompt },
          ],
        }),
        invokeLLM({
          messages: [
            { role: "system", content: "Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 1800+ слов для топа поиска. Никогда не сокращай разделы — каждый H2 минимум 200 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE], не вставляй конкретные цифры цен в рублях." },
            { role: "user", content: improvePrompt },
          ],
          maxTokens: 8192,
        }),
      ]);

      // Parse SEO JSON
      let seo: SeoAnalysis;
      try {
        const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
          ? seoResponse.choices[0].message.content.trim()
          : '{}';
        const jsonStr = seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        seo = JSON.parse(jsonStr);
      } catch {
        seo = {
          metaTitle: parsed.title,
          metaDescription: parsed.metaDescription,
          keywords: [],
          headingsSuggestions: [],
          generalSuggestions: ['Не удалось разобрать SEO-ответ'],
          score: 0,
        };
      }

      let improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
        ? improvedResponse.choices[0].message.content.trim()
            .replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
        : parsed.content;

      // Post-generation: fix missing FAQ questions or table
      improvedContent = await enhanceIfNeeded(improvedContent, serpKeyword);
      improvedContent = normalizeHeadings(improvedContent);
      improvedContent = beautifyArticleHtml(improvedContent);

      // Add internal links to related articles on the same site
      improvedContent = await addInternalLinks(improvedContent, ctx.user.id, ourDomain, parsed.title);

      const improvedWordCount = improvedContent
        ? improvedContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
        : parsed.wordCount;

      // 3. Auto-save to history
      let analysisId: number | null = null;
      try {
        const findPos = (results: { domain: string }[]) => {
          if (!ourDomain) return null;
          const idx = results.findIndex(r => r.domain.includes(ourDomain) || ourDomain.includes(r.domain));
          return idx >= 0 ? idx + 1 : null;
        };
        analysisId = await articlesDb.saveArticleAnalysis(ctx.user.id, {
          url: input.url,
          originalTitle: parsed.title,
          originalContent: parsed.content,
          wordCount: improvedWordCount,
          improvedTitle: seo.metaTitle || parsed.title,
          improvedContent,
          metaTitle: seo.metaTitle || null,
          metaDescription: seo.metaDescription || null,
          keywords: JSON.stringify(seo.keywords || []),
          generalSuggestions: JSON.stringify(seo.generalSuggestions || []),
          headings: JSON.stringify(extractHeadingsFromHtml(improvedContent)),
          seoScore: seo.score || 0,
          serpKeyword: serpKeyword || null,
          googlePos: findPos(googleSerp.results),
          yandexPos: findPos(yandexSerp.results),
        });
      } catch (err) {
        console.error('[Articles] Failed to save to history:', err);
      }

      return {
        analysisId,
        originalTitle: parsed.title,
        originalContent: parsed.content,
        originalMetaDescription: parsed.metaDescription,
        headings: extractHeadingsFromHtml(improvedContent),
        wordCount: improvedWordCount,
        improvedTitle: seo.metaTitle || parsed.title,
        improvedContent,
        seo,
      };
    }),

  /**
   * Get analysis history for current user
   */
  getHistory: protectedProcedure
    .query(async ({ ctx }) => {
      const rows = await articlesDb.getUserAnalysisHistory(ctx.user.id);
      return rows.map(r => ({
        id: r.id,
        url: r.url,
        originalTitle: r.originalTitle,
        improvedTitle: r.improvedTitle,
        seoScore: r.seoScore,
        wordCount: r.wordCount,
        serpKeyword: r.serpKeyword ?? null,
        googlePos: r.googlePos ?? null,
        yandexPos: r.yandexPos ?? null,
        createdAt: r.createdAt,
      }));
    }),

  /**
   * Load a full analysis from history by id
   */
  getAnalysis: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const row = await articlesDb.getAnalysisById(ctx.user.id, input.id);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Анализ не найден" });
      }

      const parseJson = (s: string | null | undefined, fallback: any) => {
        try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
      };

      return {
        analysisId: row.id,
        url: row.url,
        originalTitle: row.originalTitle,
        originalContent: row.originalContent,
        originalMetaDescription: '',
        headings: parseJson(row.headings, []),
        wordCount: row.wordCount,
        improvedTitle: row.improvedTitle,
        improvedContent: row.improvedContent,
        seo: {
          metaTitle: row.metaTitle || row.improvedTitle,
          metaDescription: row.metaDescription || '',
          keywords: parseJson(row.keywords, []),
          headingsSuggestions: [],
          generalSuggestions: parseJson(row.generalSuggestions, []),
          score: row.seoScore,
        },
      };
    }),

  /**
   * Delete a history entry
   */
  deleteAnalysis: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await articlesDb.deleteAnalysis(ctx.user.id, input.id);
      return { success: true };
    }),

  /**
   * Delete duplicate history entries — keep only the latest per URL
   */
  clearDuplicates: protectedProcedure
    .mutation(async ({ ctx }) => {
      const rows = await articlesDb.getUserAnalysisHistory(ctx.user.id, 10000);
      // Group by URL, keep highest id (latest)
      const latestByUrl = new Map<string, number>();
      for (const row of rows) {
        const existing = latestByUrl.get(row.url);
        if (!existing || row.id > existing) latestByUrl.set(row.url, row.id);
      }
      const toDelete = rows.filter(r => latestByUrl.get(r.url) !== r.id).map(r => r.id);
      await Promise.all(toDelete.map(id => articlesDb.deleteAnalysis(ctx.user.id, id)));
      return { deleted: toDelete.length };
    }),

  /**
   * Queue re-improvement for short articles (wordCount < threshold)
   */
  reImproveShort: protectedProcedure
    .input(z.object({ maxWords: z.number().min(100).max(2000).default(600) }))
    .mutation(async ({ ctx }) => {
      const rows = await articlesDb.getUserAnalysisHistory(ctx.user.id, 10000);
      // Deduplicate by URL first, keep latest; then filter by short wordCount
      const latestByUrl = new Map<string, typeof rows[0]>();
      for (const row of rows) {
        const existing = latestByUrl.get(row.url);
        if (!existing || row.id > existing.id) latestByUrl.set(row.url, row);
      }
      const shortUrls = Array.from(latestByUrl.values())
        .filter(r => (r.wordCount ?? 9999) < 600)
        .map(r => r.url);
      if (shortUrls.length === 0) return { queued: 0 };
      void runBatchRewrite(ctx.user.id, shortUrls);
      return { queued: shortUrls.length };
    }),

  /**
   * Fetch Google + Yandex top-10, optionally compare with our article via LLM
   */
  analyzeCompetitors: protectedProcedure
    .input(z.object({
      keyword:   z.string().min(1),
      ourUrl:    z.string().url().optional(),
      ourContent: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Fetch both SERPs in parallel
      const [google, yandex] = await Promise.all([
        cachedGoogleSerp(input.keyword),
        cachedYandexSerp(input.keyword),
      ]);

      // Find our position in each SERP
      const ourDomain = input.ourUrl ? (() => { try { return new URL(input.ourUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
      const googlePos = ourDomain ? (google.results.findIndex(r => r.domain.includes(ourDomain) || ourDomain.includes(r.domain)) + 1) || null : null;
      const yandexPos = ourDomain ? (yandex.results.findIndex(r => r.domain.includes(ourDomain) || ourDomain.includes(r.domain)) + 1) || null : null;

      // LLM comparison if we have content and at least some results
      let aiComparison: string | null = null;
      const allResults = [...google.results.slice(0, 3), ...yandex.results.slice(0, 3)];
      const uniqueResults = allResults.filter((r, i, arr) => arr.findIndex(x => x.domain === r.domain) === i).slice(0, 5);

      if (input.ourContent && uniqueResults.length > 0) {
        const competitorList = uniqueResults.map((r, i) =>
          `${i + 1}. ${r.title} (${r.domain})\n   Сниппет: ${r.snippet}`
        ).join('\n');

        try {
          const response = await invokeLLM({
            messages: [
              { role: 'system', content: 'Ты SEO-аналитик. Анализируй конкурентов и давай конкретные рекомендации.' },
              { role: 'user', content: `Ключевое слово: "${input.keyword}"

Наша статья (фрагмент):
${input.ourContent.slice(0, 2000)}

Конкуренты в топе:
${competitorList}

Дай краткий анализ:
1. Какие темы/аспекты конкуренты покрывают, а мы — нет?
2. Что нужно добавить в нашу статью чтобы обогнать конкурентов?
3. Преимущества нашей статьи перед конкурентами.
Будь конкретным, до 300 слов.` },
            ],
          });
          aiComparison = typeof response.choices[0]?.message.content === 'string'
            ? response.choices[0].message.content.trim()
            : null;
        } catch (err) {
          console.error('[Articles] LLM competitor analysis failed:', err);
        }
      }

      return {
        keyword: input.keyword,
        google: { results: google.results, error: google.error ?? null },
        yandex: { results: yandex.results, error: yandex.error ?? null },
        ourPosition: { google: googlePos, yandex: yandexPos },
        aiComparison,
      };
    }),

  /**
   * Lightweight audit of multiple article URLs — no LLM, just parse metrics.
   * Returns word count, headings count, has meta description, duplicate detection.
   */
  auditArticles: protectedProcedure
    .input(z.object({
      articles: z.array(z.object({ url: z.string().url(), title: z.string() })).max(1500),
    }))
    .mutation(async ({ input }) => {
      // Batch parse all articles in parallel (10 at a time)
      const results: {
        url: string;
        title: string;
        wordCount: number;
        headingsCount: number;
        hasMeta: boolean;
        h1Count: number;
        issues: string[];
      }[] = [];

      const BATCH = 10;
      for (let i = 0; i < input.articles.length; i += BATCH) {
        const batch = input.articles.slice(i, i + BATCH);
        const settled = await Promise.allSettled(
          batch.map(a => parseArticleFromUrl(a.url))
        );
        for (let j = 0; j < batch.length; j++) {
          const art = batch[j];
          const r = settled[j];
          if (r.status === 'rejected') {
            results.push({ url: art.url, title: art.title, wordCount: 0, headingsCount: 0, hasMeta: false, h1Count: 0, issues: ['Ошибка загрузки'] });
            continue;
          }
          const p = r.value;
          const issues: string[] = [];
          if (p.wordCount < 500) issues.push(`Мало текста (${p.wordCount} сл.)`);
          if (!p.metaDescription) issues.push('Нет мета-описания');
          const h1 = p.headings.filter(h => h.level === 'H1').length;
          if (h1 === 0) issues.push('Нет H1');
          if (h1 > 1) issues.push(`Несколько H1 (${h1})`);
          if (p.headings.length === 0) issues.push('Нет заголовков');
          results.push({
            url: art.url,
            title: art.title,
            wordCount: p.wordCount,
            headingsCount: p.headings.length,
            hasMeta: !!p.metaDescription,
            h1Count: h1,
            issues,
          });
        }
      }

      // Detect near-duplicate titles
      const titleMap = new Map<string, string[]>();
      for (const r of results) {
        const key = r.title.toLowerCase().slice(0, 40);
        if (!titleMap.has(key)) titleMap.set(key, []);
        titleMap.get(key)!.push(r.url);
      }
      for (const [, urls] of Array.from(titleMap)) {
        if (urls.length > 1) {
          for (const url of urls) {
            const r = results.find(x => x.url === url);
            if (r && !r.issues.includes('Дубликат заголовка')) r.issues.push('Дубликат заголовка');
          }
        }
      }

      const stats = {
        total: results.length,
        tooShort: results.filter(r => r.wordCount > 0 && r.wordCount < 500).length,
        noMeta: results.filter(r => r.wordCount > 0 && !r.hasMeta).length,
        noH1: results.filter(r => r.wordCount > 0 && r.h1Count === 0).length,
        duplicates: results.filter(r => r.issues.includes('Дубликат заголовка')).length,
        errors: results.filter(r => r.issues.includes('Ошибка загрузки')).length,
        ok: results.filter(r => r.issues.length === 0).length,
      };

      return { results, stats };
    }),

  /**
   * Rewrite article incorporating what top competitors cover
   */
  rewriteWithCompetitors: protectedProcedure
    .input(z.object({
      originalTitle:   z.string(),
      originalContent: z.string(),
      keyword:         z.string(),
      competitors: z.array(z.object({
        title:   z.string(),
        domain:  z.string(),
        snippet: z.string(),
      })),
    }))
    .mutation(async ({ input }) => {
      const competitorList = input.competitors
        .map((r, i) => `${i + 1}. ${r.title} (${r.domain})\n   ${r.snippet}`)
        .join('\n');

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-копирайтер экстра-класса. Пишешь статьи для топа Яндекса и Google. Всегда возвращаешь HTML.' },
          { role: 'user', content: `Ключевое слово: "${input.keyword}"

Наша текущая статья:
Заголовок: ${input.originalTitle}
Текст:
${input.originalContent.slice(0, 5000)}

Конкуренты в ТОП-10 поиска (заголовки и сниппеты):
${competitorList}

ЗАДАЧА: Перепиши нашу статью чтобы она вышла в ТОП-3 по запросу "${input.keyword}".

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Объём: минимум 1800 слов (конкуренты в топе пишут именно столько)
2. Начало: прямой ответ на запрос "${input.keyword}" в первых 2-3 предложениях
3. Структура: H1 (один), 6-10 H2, H3 где уместно, списки, таблицы где уместно
4. Покрой ВСЕ темы конкурентов (судя по их заголовкам и сниппетам)
5. FAQ-раздел: H2 "Часто задаваемые вопросы" с минимум 5 вопросами-ответами
6. E-E-A-T: конкретные факты, числа, сроки, стоимости, нормативные акты. ${getShortcodesHint(input.keyword)}
7. Пошаговые нумерованные инструкции для любых процессов
8. Тема кадастр/недвижимость: упомяни возможность заказать справку онлайн
9. Сохрани язык и стиль оригинала

Верни ТОЛЬКО HTML-текст: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <strong>, <em>. Без <html>/<body> тегов.` },
        ],
        maxTokens: 8192,
      });

      const improvedContent = typeof response.choices[0]?.message.content === 'string'
        ? response.choices[0].message.content.trim()
        : input.originalContent;

      return { improvedContent };
    }),

  /**
   * Analyze content gaps and suggest new article ideas for a niche
   */
  suggestArticleIdeas: protectedProcedure
    .input(z.object({
      niche:          z.string().min(1),          // e.g. "кадастр, земельные участки"
      ourTitles:      z.array(z.string()),         // existing article titles from catalog
      competitorTitles: z.array(z.string()).optional(), // titles from SERP (optional)
      count:          z.number().min(5).max(50).default(20),
    }))
    .mutation(async ({ input }) => {
      const ourList = input.ourTitles.slice(0, 200).map((t, i) => `${i + 1}. ${t}`).join('\n');
      const competitorSection = input.competitorTitles && input.competitorTitles.length > 0
        ? `\nСтатьи конкурентов в топе поиска:\n${input.competitorTitles.slice(0, 50).map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : '';

      const prompt = `Ты эксперт по контент-маркетингу и SEO. Анализируй пробелы в контенте сайта.

Ниша: ${input.niche}

Наши существующие статьи (${input.ourTitles.length} шт.):
${ourList}
${competitorSection}

Задача: найди ${input.count} тем для новых статей, которых НЕТ на нашем сайте, но которые:
1. Важны для нашей ниши
2. Имеют поисковый спрос
3. Помогут привлечь новую аудиторию
4. Конкуренты покрывают (если есть их данные)

Верни ТОЛЬКО валидный JSON (без markdown):
[
  {
    "title": "Точный заголовок статьи",
    "keyword": "главное ключевое слово",
    "priority": "high" | "medium" | "low",
    "reason": "почему эта тема важна (1-2 предложения)",
    "searchIntent": "informational" | "transactional" | "navigational"
  }
]

Сортируй по приоритету: сначала high, потом medium, потом low.`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-эксперт. Отвечай только валидным JSON-массивом.' },
          { role: 'user', content: prompt },
        ],
      });

      let ideas: any[] = [];
      try {
        const raw = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content.trim()
          : '[]';
        const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
        ideas = JSON.parse(jsonStr);
        if (!Array.isArray(ideas)) ideas = [];
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Не удалось разобрать ответ AI' });
      }

      return { ideas, ourCount: input.ourTitles.length };
    }),

  /**
   * Generate a brand-new article from scratch targeting top-3 for a keyword.
   * Fetches live SERP, reads competitor content, then writes a full article.
   */
  generateTopArticle: protectedProcedure
    .input(z.object({
      keyword:  z.string().min(2),
      niche:    z.string().default('кадастр и недвижимость'),
      ctaHint:  z.string().default('Вы можете заказать справку на объект недвижимости онлайн — данные реальные из ЕГРН, подходят для проверки объекта, сделок и юридического анализа. Заказать на /spravki/'),
    }))
    .mutation(async ({ input }) => {
      // 1. SERP
      const [googleSerp, yandexSerp] = await Promise.all([
        cachedGoogleSerp(input.keyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
        cachedYandexSerp(input.keyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
      ]);

      const bestSerp = (googleSerp.results.length >= yandexSerp.results.length ? googleSerp : yandexSerp).results;

      // 2. Read competitor content
      const competitors = await fetchCompetitorArticles(bestSerp, '', 5);
      const avgWords = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + (c.wordCount || 0), 0) / competitors.length)
        : 1500;
      const targetWords = Math.max(1800, avgWords + 400);

      const competitorContext = competitors.length > 0
        ? competitors.map((c, i) => `Конкурент #${i + 1} (${c.domain}, ~${c.wordCount} слов):
  Заголовок: ${c.title}
  Структура H2/H3: ${c.headings || '—'}
  Фрагмент текста: ${c.content}`).join('\n\n')
        : '(данные конкурентов недоступны)';

      // 3. Generate article
      const prompt = `Ты SEO-копирайтер экстра-класса для русскоязычного поиска. Напиши НОВУЮ статью для ТОП-3 Яндекса и Google.

Ключевой запрос: "${input.keyword}"
Ниша: ${input.niche}

АНАЛИЗ КОНКУРЕНТОВ В ТОП-5 (средний объём: ${avgWords} слов):
${competitorContext}

ТРЕБОВАНИЯ К СТАТЬЕ:
1. Объём: минимум ${targetWords} слов — превзойди конкурентов по полноте
2. H1: точно под запрос "${input.keyword}" + дополнительный контекст
3. Структура: 7-12 H2, H3 где уместно; не менее 3 нумерованных или маркированных списков
4. Вступление: прямой ответ на запрос в первых 2-3 предложениях (попадание в featured snippet)
5. Покрой ВСЕ темы которые есть у конкурентов — сделай статью исчерпывающей
6. Таблицы: добавь хотя бы одну сравнительную таблицу где уместно
7. FAQ: H2 "Часто задаваемые вопросы" → минимум 10 вопросов-ответов СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> (первый с open, остальные без). НЕ используй <h3> для вопросов (для блока "Люди также спрашивают")
8. E-E-A-T: конкретные цифры, сроки, стоимости, ссылки на законы/постановления где уместно
9. CTA: в конце статьи и в одном-двух местах по тексту добавь призыв — ${input.ctaHint}
10. Стиль: информационный, деловой, без воды

Верни ТОЛЬКО HTML-текст используя: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <thead>, <tbody>, <tr>, <td>, <th>, <strong>, <em>. Без <html>/<body> тегов.`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-копирайтер. Пишешь длинные экспертные статьи для топа поиска. Всегда возвращаешь только HTML.' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 8192,
      });

      const articleHtml = typeof response.choices[0]?.message.content === 'string'
        ? response.choices[0].message.content.trim()
        : '';

      // 4. SEO meta
      const metaResponse = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-эксперт. Отвечай только валидным JSON.' },
          { role: 'user', content: `Для статьи по запросу "${input.keyword}" сгенерируй SEO-мету. Верни только JSON:
{
  "metaTitle": "title до 60 символов с ключом в начале",
  "metaDescription": "мета-описание до 160 символов с призывом к действию",
  "keywords": ["ключ1", "LSI2", ...до 10 штук],
  "faqQuestions": ["вопрос1?", ...до 6]
}` },
        ],
      });

      let meta = { metaTitle: input.keyword, metaDescription: '', keywords: [] as string[], faqQuestions: [] as string[] };
      try {
        const raw = typeof metaResponse.choices[0]?.message.content === 'string'
          ? metaResponse.choices[0].message.content.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
          : '{}';
        meta = { ...meta, ...JSON.parse(raw) };
      } catch { /* keep defaults */ }

      return {
        keyword: input.keyword,
        articleHtml,
        metaTitle: meta.metaTitle,
        metaDescription: meta.metaDescription,
        keywords: meta.keywords,
        faqQuestions: meta.faqQuestions,
        competitorCount: competitors.length,
        avgCompetitorWords: avgWords,
        targetWords,
        serpResults: bestSerp.slice(0, 10),
      };
    }),

  /**
   * Publish improved article back to the original site via WordPress REST API
   * - Finds post by slug from original URL
   * - Generates DALL-E featured image (optional)
   * - AI generates 3 CTA button texts for the article
   * - Injects CTA buttons at 1/3, 2/3 and end of content
   * - Updates existing WP post
   */
  publishArticleToSite: protectedProcedure
    .input(z.object({
      accountId:   z.number(),
      originalUrl: z.string().url(),
      title:       z.string(),
      content:     z.string(),  // HTML content (improved)
      ctaUrl:      z.string().url(),
      generateImage: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Get WP account
      const account = await wordpressDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'WordPress аккаунт не найден' });

      // 2. Extract slug from original URL (follow redirects to get real slug)
      let resolvedUrl = input.originalUrl;
      try {
        const headResp = await fetch(input.originalUrl, { method: 'HEAD', redirect: 'follow' });
        if (headResp.url && headResp.url !== input.originalUrl) resolvedUrl = headResp.url;
      } catch { /* keep original */ }
      const slug = new URL(resolvedUrl).pathname.replace(/\/$/, '').split('/').pop() || '';
      if (!slug) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не удалось извлечь slug из URL' });

      // 3. Find post by slug
      const post = await wp.findPostBySlug(account.siteUrl, account.username, account.appPassword, slug);
      if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: `Статья "${slug}" не найдена` });

      // 4. In parallel: generate CTA texts + 3 DALL-E images
      const noText = `NO text, NO letters, NO words, NO labels, NO watermarks, NO inscriptions anywhere in the image.`;
      const skinNote = `All people must have light/fair Slavic skin tone (Russian appearance). No dark-skinned people.`;
      const imgSubjectPub = input.title
        .replace(/^Заказать\s+|^Как\s+|^Что\s+такое\s+|^Получить\s+/i, '')
        .replace(/\s+в\s+Москве$/i, '')
        .replace(/:\s*.+$/, '')
        .trim();
      const imagePrompts = [
        `Photorealistic wide-format photo: friendly real estate agent and client shaking hands in a bright modern office, large windows, plants, neutral interior. ${skinNote} No text, no signs, no screens, no documents visible.`,
        `Aerial drone view of a Russian city residential neighborhood, rows of apartment buildings, courtyards with trees, clear blue sky, warm daylight. No text, no labels, no overlays.`,
        `Photorealistic close-up: a person's hands holding a set of keys over a wooden desk with a blurred laptop and coffee cup in the background, warm natural light. ${skinNote} No text, no screens, no signs.`,
      ];

      const [ctaResponse, metaResponse, excerptResponse, ...imageResults] = await Promise.all([
        invokeLLM({
          messages: [
            { role: 'system', content: 'Ты копирайтер. Пишешь короткие призывы к действию для кнопок.' },
            { role: 'user', content: `Статья: "${input.title}"

Напиши 3 разных призыва к действию (CTA) для кнопки заказа документов на этой странице.
Каждый должен быть коротким (до 10 слов), конкретным и соответствующим теме статьи.
Верни ТОЛЬКО JSON-массив из 3 строк без markdown:
["текст кнопки 1", "текст кнопки 2", "текст кнопки 3"]` },
          ],
        }),
        invokeLLM({
          messages: [
            { role: 'system', content: 'Ты SEO-копирайтер. Пишешь meta description для страниц. Никогда не упоминай Госуслуги, МФЦ, Росреестр как способы заказа. Акцент — заказ через kadastrmap.info.' },
            { role: 'user', content: `Заголовок: "${input.title}"

Напиши meta description для этой страницы (130–155 символов).
Должен содержать ключевой запрос, выгоду и CTA «заказать на kadastrmap.info».
Верни ТОЛЬКО строку без кавычек и markdown.` },
          ],
          maxTokens: 200,
        }).catch(() => null),
        invokeLLM({
          messages: [
            { role: 'system', content: 'Ты SEO-копирайтер. Пишешь анонсы (excerpts) для статей WordPress. Никогда не упоминай Госуслуги, МФЦ, Росреестр как способы заказа. Акцент — kadastrmap.info.' },
            { role: 'user', content: `Заголовок статьи: "${input.title}"

Напиши анонс (excerpt) для листинга статей — 1-2 предложения, 100–160 символов.
Должен быть интригующим, содержать ключевой запрос и побуждать читать дальше.
Верни ТОЛЬКО текст анонса без кавычек, тегов и markdown.` },
          ],
          maxTokens: 100,
        }).catch(() => null),
        ...(input.generateImage
          ? imagePrompts.map((p) =>
              generateDallEImage(p).catch((e) => { console.error('[Articles] DALL-E failed:', e.message); return null; })
            )
          : [Promise.resolve(null), Promise.resolve(null), Promise.resolve(null)]
        ),
      ]);

      // Parse CTA texts
      let ctaTexts: string[] = [
        'Получить полную информацию об объекте',
        'Заказать документ онлайн',
        'Узнать кадастровую стоимость',
      ];
      try {
        const raw = typeof ctaResponse.choices[0]?.message.content === 'string'
          ? ctaResponse.choices[0].message.content.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
          : '[]';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 3) ctaTexts = parsed;
      } catch { /* use defaults */ }

      // Parse meta description
      const metaDescription: string | undefined = (() => {
        try {
          const raw = typeof metaResponse?.choices[0]?.message.content === 'string'
            ? metaResponse.choices[0].message.content.trim().replace(/^["']|["']$/g, '')
            : '';
          return raw.length > 20 ? raw : undefined;
        } catch { return undefined; }
      })();
      if (metaDescription) console.log(`[Articles] Generated meta: ${metaDescription}`);

      // Parse excerpt
      const excerpt: string | undefined = (() => {
        try {
          const raw = typeof excerptResponse?.choices[0]?.message.content === 'string'
            ? excerptResponse.choices[0].message.content.trim().replace(/^["']|["']$/g, '')
            : '';
          return raw.length > 20 ? raw : undefined;
        } catch { return undefined; }
      })();
      if (excerpt) console.log(`[Articles] Generated excerpt: ${excerpt}`);

      // 5. Upload all generated images to WP media
      const imageUrls = imageResults as (string | null)[];
      const uploadedMedia: ({ id: number; url: string } | null)[] = await Promise.all(
        imageUrls.map(async (url, i) => {
          if (!url) return null;
          try {
            return await wp.uploadMediaFromUrl(
              account.siteUrl, account.username, account.appPassword,
              url, `${slug}-img-${i + 1}.jpg`
            );
          } catch (e: any) {
            console.error(`[Articles] Media upload ${i + 1} failed:`, e.message);
            return null;
          }
        })
      );

      // 6. Inject CTAs into existing HTML after H2 headings (at ~1/3, ~2/3, and end)
      const ctaBlock = (text: string) =>
        `\n<div style="text-align:center;margin:2em 0 2.5em;">` +
        `<a href="${input.ctaUrl}" style="display:inline-block;background:#4CAF50;color:#fff;` +
        `padding:16px 48px;border-radius:8px;font-size:16px;font-weight:500;text-decoration:none;">` +
        `${text}</a></div>\n`;

      let htmlContent = injectCtasIntoHtml(beautifyArticleHtml(stripFirstH1(input.content)), ctaTexts, ctaBlock);

      // 7. Inject content images after H2 tags (2nd, 4th, 6th occurrence)
      const validMedia = uploadedMedia.filter(Boolean) as { id: number; url: string }[];
      if (validMedia.length > 0) {
        let h2count = 0;
        htmlContent = htmlContent.replace(/<\/h2>/gi, () => {
          h2count++;
          const targets: Record<number, number> = { 2: 0, 4: 1, 6: 2 };
          const mediaIndex = targets[h2count];
          if (mediaIndex !== undefined && validMedia[mediaIndex]) {
            const imgUrl = validMedia[mediaIndex].url;
            return `</h2>\n<figure style="margin:1.5em 0;text-align:center;"><img src="${imgUrl}" alt="${input.title}" style="max-width:100%;height:auto;border-radius:8px;" loading="lazy"></figure>`;
          }
          return '</h2>';
        });
      }

      // 8. Update WP post (first image as featured media)
      const featuredMediaId: number | undefined = validMedia[0]?.id;

      const updated = await wp.updatePost(
        account.siteUrl, account.username, account.appPassword,
        post.id,
        {
          title:      input.title,
          content:    htmlContent,
          categories: detectCategoryIds(input.originalUrl),
          ...(excerpt ? { excerpt } : {}),
          ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        }
      );

      // Update Yoast meta + outsearch via custom endpoint
      {
        const siteBase = account.siteUrl.replace(/\/$/, '');
        const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');
        const axiosInst2 = (await import('axios')).default;
        const metaPayload: Record<string, string> = { outsearch: '1' };
        if (metaDescription) metaPayload['_yoast_wpseo_metadesc'] = metaDescription;
        await axiosInst2.post(
          `${siteBase}/wp-json/kadastrmap/v1/post-meta/${post.id}`,
          { meta: metaPayload },
          { headers: { Authorization: auth, 'Content-Type': 'application/json' } }
        ).catch((e: any) => console.warn('[Articles] meta update failed:', e?.message));
      }

      return {
        success: true,
        link: updated.link,
        imagesUploaded: validMedia.length,
        metaDescription,
        ctaTexts,
      };
    }),

  /**
   * Create a Revisionize draft copy of an existing post for review before publishing
   */
  createDraftRevision: protectedProcedure
    .input(z.object({
      accountId:   z.number(),
      originalUrl: z.string().url(),
      title:       z.string(),
      content:     z.string(),  // HTML content (improved)
      ctaUrl:      z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await wordpressDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'WordPress аккаунт не найден' });

      let resolvedUrl2 = input.originalUrl;
      try {
        const headResp = await fetch(input.originalUrl, { method: 'HEAD', redirect: 'follow' });
        if (headResp.url && headResp.url !== input.originalUrl) resolvedUrl2 = headResp.url;
      } catch { /* keep original */ }
      const slug = new URL(resolvedUrl2).pathname.replace(/\/$/, '').split('/').pop() || '';
      if (!slug) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не удалось извлечь slug из URL' });

      const original = await wp.findPostBySlug(account.siteUrl, account.username, account.appPassword, slug);
      if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: `Статья "${slug}" не найдена` });

      // Generate Yoast meta + focus keyword in parallel with draft setup
      const siteBase = account.siteUrl.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');
      const categories = detectCategoryIds(input.originalUrl);

      // Focus keyword: extract from Russian title (strip action verbs and location suffixes)
      const focusKeyword = input.title
        .replace(/^Заказать\s+|^Как\s+|^Что\s+такое\s+|^Получить\s+/i, '')
        .replace(/\s+в\s+Москве$/i, '')
        .replace(/:\s*.+$/, '')  // remove subtitle after colon
        .trim();

      // Derive short subject for context-specific prompt
      const imgSubject = focusKeyword || input.title;
      const skinNoteD = `All people must have light/fair Slavic skin tone (Russian appearance). No dark-skinned people.`;
      const imagePrompts = [
        `Photorealistic wide-format photo: friendly real estate agent and client shaking hands in a bright modern office, large windows, plants, neutral interior. ${skinNoteD} No text, no signs, no screens, no documents visible.`,
        `Aerial drone view of a Russian city residential neighborhood, rows of apartment buildings, courtyards with trees, clear blue sky, warm daylight. No text, no labels, no overlays.`,
        `Photorealistic close-up: a person's hands holding a set of keys over a wooden desk with a blurred laptop and coffee cup in the background, warm natural light. ${skinNoteD} No text, no screens, no signs.`,
      ];

      // Run meta LLM + DALL-E images in parallel
      const [metaResp, ...imageResults] = await Promise.all([
        invokeLLM({
          messages: [
            { role: 'system', content: 'Ты SEO-копирайтер. Никогда не упоминай Госуслуги, МФЦ, Росреестр как способы заказа. Акцент — заказ через kadastrmap.info.' },
            { role: 'user', content: `Заголовок: "${input.title}"\nФокусный ключ: "${focusKeyword}"\n\nНапиши meta description (130–155 символов). Включи ключевой запрос и CTA «заказать на kadastrmap.info». Верни ТОЛЬКО строку без кавычек.` },
          ],
          maxTokens: 200,
        }).catch(() => null),
        ...imagePrompts.map(p =>
          generateDallEImage(p).catch((e: any) => { console.warn('[Draft] DALL-E failed:', e?.message); return null; })
        ),
      ]);

      let metaDesc: string | undefined;
      try {
        const raw = metaResp?.choices[0]?.message.content;
        if (typeof raw === 'string' && raw.trim().length > 20) metaDesc = raw.trim().replace(/^["']|["']$/g, '');
      } catch { /* ignore */ }

      const axiosInst = (await import('axios')).default;
      const headers = { Authorization: auth, 'Content-Type': 'application/json' };

      // Upload images to WP media
      const uploadedMedia: ({ id: number; url: string } | null)[] = await Promise.all(
        (imageResults as (string | null)[]).map(async (imgUrl, i) => {
          if (!imgUrl) return null;
          try { return await wp.uploadMediaFromUrl(account.siteUrl, account.username, account.appPassword, imgUrl, `${slug}-img-${i + 1}.jpg`); }
          catch (e: any) { console.warn(`[Draft] media upload ${i + 1} failed:`, e?.message); return null; }
        })
      );
      const validMedia = uploadedMedia.filter(Boolean) as { id: number; url: string }[];

      // Inject images after H2 (2nd, 4th, 6th) and CTA at end
      let html = beautifyArticleHtml(stripFirstH1(input.content));
      if (validMedia.length > 0) {
        let h2count = 0;
        html = html.replace(/<\/h2>/gi, () => {
          h2count++;
          const targets: Record<number, number> = { 2: 0, 4: 1, 6: 2 };
          const mi = targets[h2count];
          if (mi !== undefined && validMedia[mi]) {
            return `</h2>\n<figure style="margin:1.5em 0;text-align:center;"><img src="${validMedia[mi].url}" alt="${input.title}" style="max-width:100%;height:auto;border-radius:8px;" loading="lazy"></figure>`;
          }
          return '</h2>';
        });
      }
      const ctaHtml = `\n<div style="text-align:center;margin:2em 0 2.5em;"><a href="${input.ctaUrl}" style="display:inline-block;background:#4CAF50;color:#fff;padding:16px 48px;border-radius:8px;font-size:16px;font-weight:500;text-decoration:none;">Заказать документ онлайн</a></div>\n`;
      const finalHtml = html + ctaHtml;

      const featuredMediaId = validMedia[0]?.id;

      const { data: draft } = await axiosInst.post(
        `${siteBase}/wp-json/wp/v2/posts`,
        {
          title:   input.title,
          slug:    `${slug}-draft-rev`,
          content: finalHtml,
          status:  'draft',
          categories,
          ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
          meta: { _revisionize_revision_for: String(original.id) },
        },
        { headers }
      );

      // Update Yoast meta + outsearch via custom endpoint
      const yoastMeta: Record<string, string> = { outsearch: '1' };
      if (metaDesc)     yoastMeta._yoast_wpseo_metadesc = metaDesc;
      if (focusKeyword) yoastMeta._yoast_wpseo_focuskw  = focusKeyword;
      await axiosInst.post(
        `${siteBase}/wp-json/kadastrmap/v1/post-meta/${draft.id}`,
        { meta: yoastMeta },
        { headers }
      ).catch((e: any) => console.warn('[Draft] meta update failed:', e?.message));

      return {
        draftId:        draft.id as number,
        editUrl:        `${siteBase}/wp-admin/post.php?post=${draft.id}&action=edit`,
        originalId:     original.id,
        imagesUploaded: validMedia.length,
        focusKeyword,
        metaDesc,
      };
    }),

  /**
   * Publish a Revisionize draft → applies content to original post
   * Revisionize hooks transition_post_status and copies draft → original automatically
   */
  publishDraftRevision: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      draftId:   z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await wordpressDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'WordPress аккаунт не найден' });

      const siteBase = account.siteUrl.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');
      const axiosInst = (await import('axios')).default;

      const { data } = await axiosInst.post(
        `${siteBase}/wp-json/wp/v2/posts/${input.draftId}`,
        { status: 'publish' },
        { headers: { Authorization: auth, 'Content-Type': 'application/json' } }
      );

      return { success: true, link: data.link as string };
    }),

  /**
   * Save improved article to Content Library
   */
  saveToLibrary: protectedProcedure
    .input(z.object({
      title:    z.string(),
      content:  z.string(),
      hashtags: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createContentPost(ctx.user.id, {
          title: input.title,
          content: input.content,
          platform: "facebook",
          language: "russian",
          hashtags: input.hashtags,
          status: "draft",
        });
        const insertId = (result as any)?.[0]?.insertId ?? (result as any)?.insertId ?? null;
        return { success: true, postId: insertId as number | null };
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Не удалось сохранить в библиотеку",
        });
      }
    }),

  /**
   * SerpAPI account quota — remaining searches this month
   */
  serpApiQuota: protectedProcedure
    .query(async () => {
      const key = process.env.SERPAPI_KEY;
      if (!key) return null;
      try {
        const axios = (await import('axios')).default;
        const { data } = await axios.get(`https://serpapi.com/account?api_key=${key}`, { timeout: 8000 });
        return {
          planName:        data.plan_name        as string,
          searchesPerMonth: data.searches_per_month as number,
          searchesLeft:    data.plan_searches_left as number,
          extraCredits:    data.extra_credits      as number,
          totalLeft:       data.total_searches_left as number,
          thisMonthUsage:  data.this_month_usage   as number,
        };
      } catch {
        return null;
      }
    }),

  /**
   * Lightweight SERP position check for one keyword — no AI
   */
  checkPosition: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      domain:  z.string().default('kadastrmap.info'),
    }))
    .mutation(async ({ input }) => {
      const [google, yandex] = await Promise.all([
        cachedGoogleSerp(input.keyword),
        cachedYandexSerp(input.keyword),
      ]);

      const findPos = (results: { domain: string }[]) => {
        const idx = results.findIndex(r => r.domain.includes(input.domain));
        return idx >= 0 ? idx + 1 : null;
      };

      return {
        keyword:        input.keyword,
        googlePos:      findPos(google.results),
        yandexPos:      findPos(yandex.results),
        googleError:    google.error  ?? null,
        yandexError:    yandex.error  ?? null,
        topCompetitors: google.results
          .filter(r => !r.domain.includes(input.domain))
          .slice(0, 5)
          .map(r => ({ title: r.title, domain: r.domain, snippet: r.snippet })),
      };
    }),

  /**
   * Generate a new full article from title + keyword, auto-save to Content Library
   */
  generateNewArticle: protectedProcedure
    .input(z.object({
      title:       z.string().min(3),
      keyword:     z.string().min(1),
      competitors: z.array(z.object({
        title:   z.string(),
        domain:  z.string(),
        snippet: z.string(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const competitorSection = input.competitors && input.competitors.length > 0
        ? `\nКонкуренты в топе поиска по этой теме:\n${input.competitors.map((c, i) => `${i + 1}. ${c.title} (${c.domain})\n   ${c.snippet}`).join('\n')}`
        : '';

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты эксперт-копирайтер и SEO-специалист. Пишешь полные, подробные статьи на русском языке.' },
          { role: 'user', content: `Напиши полную SEO-статью.

Заголовок: ${input.title}
Ключевое слово: ${input.keyword}${competitorSection}

Требования:
1. Структура: вводный абзац (ответ на вопрос) → 5-7 разделов H2 → заключение
2. Объём: 900-1500 слов
3. Форматирование: ## для H2, ### для H3, списки с - или 1.
4. Конкретные практические советы, реальные цифры и сроки если применимо
5. Таблица сравнения где уместно
6. Заключение с призывом к действию

Верни ТОЛЬКО текст статьи без комментариев, преамбулы и послесловий.` },
        ],
      });

      const content = typeof response.choices[0]?.message.content === 'string'
        ? response.choices[0].message.content.trim()
        : '';

      const result = await createContentPost(ctx.user.id, {
        title:    input.title,
        content,
        platform: 'facebook',
        language: 'russian',
        status:   'draft',
      });
      const postId = (result as any)?.[0]?.insertId ?? (result as any)?.insertId ?? null;

      return { title: input.title, content, postId: postId as number | null };
    }),

  /**
   * AI recommendations for duplicate article groups:
   * which to keep (canonical), which to 301-redirect/merge/delete.
   */
  recommendDuplicates: protectedProcedure
    .input(z.object({
      groups: z.array(z.object({
        articles: z.array(z.object({
          url:       z.string(),
          title:     z.string(),
          seoScore:  z.number().nullable().optional(),
          wordCount: z.number().nullable().optional(),
        })),
      })).max(50),
    }))
    .mutation(async ({ input }) => {
      const groupsSummary = input.groups.map((g, i) => {
        const items = g.articles.map((a, j) =>
          `  ${j + 1}. "${a.title}" | ${a.url}${a.seoScore != null ? ` | SEO: ${a.seoScore}` : ''}${a.wordCount != null ? ` | ${a.wordCount} сл.` : ''}`
        ).join('\n');
        return `Группа ${i + 1}:\n${items}`;
      }).join('\n\n');

      const prompt = `Ты SEO-эксперт. На сайте kadastrmap.info найдены группы дублирующихся статей (похожие заголовки, разные URL).

${groupsSummary}

Для каждой группы определи стратегию:
1. Какую статью оставить как основную (canonical) — выбери ту что лучше (если есть SEO-оценка или больше слов)
2. Что делать с остальными: "301_redirect" (лучший вариант для SEO) | "merge" (объединить контент) | "delete"
3. Одна строка обоснования

Верни ТОЛЬКО валидный JSON-массив без markdown:
[
  {
    "group": 1,
    "keepUrl": "URL статьи которую оставляем",
    "keepTitle": "её заголовок",
    "others": [{"url": "...", "action": "301_redirect"|"merge"|"delete"}],
    "reason": "краткое обоснование"
  }
]`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-эксперт. Отвечай только валидным JSON.' },
          { role: 'user', content: prompt },
        ],
      });

      let recommendations: any[] = [];
      try {
        const raw = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
          : '[]';
        recommendations = JSON.parse(raw);
        if (!Array.isArray(recommendations)) recommendations = [];
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Не удалось разобрать рекомендации AI' });
      }

      return { recommendations };
    }),

  /**
   * Start background batch analysis on the server — browser can close.
   * Processes articles with concurrency=3, saves each to history automatically.
   */
  startBatchAnalysis: protectedProcedure
    .input(z.object({
      urls:          z.array(z.string().url()).max(2000),
      skipAnalyzed:  z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const existing = batchJobs.get(userId);
      if (existing?.running) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Серверный анализ уже запущен' });
      }

      let urls = input.urls;
      if (input.skipAnalyzed) {
        const history = await articlesDb.getUserAnalysisHistory(userId, 5000);
        const done = new Set(history.map(h => h.url));
        urls = urls.filter(u => !done.has(u));
      }

      if (urls.length === 0) {
        return { started: false, total: 0, message: 'Все статьи уже проанализированы' };
      }

      // Fire and forget — runs on server after response is sent
      runBatchJob(userId, urls).catch(err => {
        console.error('[Batch] Fatal error:', err);
        const job = batchJobs.get(userId);
        if (job) job.running = false;
      });

      return { started: true, total: urls.length, message: `Запущен серверный анализ ${urls.length} статей` };
    }),

  /**
   * Poll server-side batch job status
   */
  getBatchStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const job = batchJobs.get(ctx.user.id);
      if (!job) return { running: false, done: 0, total: 0, errors: 0 };
      return { running: job.running, done: job.done, total: job.total, errors: job.errors };
    }),

  /**
   * Stop the running server-side batch job
   */
  stopBatchAnalysis: protectedProcedure
    .mutation(async ({ ctx }) => {
      const job = batchJobs.get(ctx.user.id);
      if (job) {
        job.stop();
        job.running = false;
      }
      return { stopped: true };
    }),

  /**
   * Apply a 301 redirect recommendation via the Redirection WP plugin.
   * Optionally also deletes the source post from WordPress.
   */
  applyRedirect: protectedProcedure
    .input(z.object({
      accountId:  z.number(),
      fromUrl:    z.string().url(),  // article to redirect away from
      toUrl:      z.string().url(),  // canonical destination
      deletePost: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await wordpressDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'WordPress аккаунт не найден' });

      // Extract relative path for the Redirection plugin
      const sourcePath = (() => {
        try {
          const u = new URL(input.fromUrl);
          return u.pathname + (u.search || '');
        } catch { return input.fromUrl; }
      })();

      // Create redirect
      const redirect = await wp.createRedirect(
        account.siteUrl,
        account.username,
        account.appPassword,
        sourcePath,
        input.toUrl,
      );

      // Optionally delete source post from WP
      let postDeleted = false;
      if (input.deletePost) {
        const slug = sourcePath.replace(/\/$/, '').split('/').pop() || '';
        if (slug) {
          const post = await wp.findPostBySlug(account.siteUrl, account.username, account.appPassword, slug);
          if (post) {
            await wp.deletePost(account.siteUrl, account.username, account.appPassword, post.id);
            postDeleted = true;
          }
        }
      }

      return { success: true, redirectId: redirect.id, postDeleted };
    }),

  /**
   * Suggest best keywords for kadastrmap.info ranked by traffic × conversion potential.
   * Sources:
   *   1. Our existing catalog titles (gaps analysis)
   *   2. Live SERP for seed keywords → real competitor titles
   *   3. LLM gap analysis + conversion scoring
   */
  suggestConversionKeywords: protectedProcedure
    .input(z.object({
      seedKeywords: z.array(z.string()).default([]),
      ourTitles:    z.array(z.string()).default([]),
      count:        z.number().min(10).max(150).default(60),
    }))
    .mutation(async ({ input }) => {
      // Default seeds when none provided
      const seeds = input.seedKeywords.length > 0
        ? input.seedKeywords.slice(0, 6)
        : [
            'кадастровая стоимость',
            'выписка ЕГРН онлайн',
            'проверить квартиру перед покупкой',
            'кадастровый номер по адресу',
            'обременение на недвижимость',
            'узнать владельца квартиры',
          ];

      // ── Step 1: fetch live SERP for each seed (parallel, best-effort) ──────
      console.log(`[KeywordResearch] Fetching SERP for ${seeds.length} seeds via proxies...`);
      const serpJobs = seeds.map(kw =>
        Promise.all([
          cachedGoogleSerp(kw).catch(() => ({ results: [] as any[], error: 'fail' })),
          cachedYandexSerp(kw).catch(() => ({ results: [] as any[], error: 'fail' })),
        ])
      );
      const serpAll = await Promise.allSettled(serpJobs);

      // Collect competitor titles + domains from SERP
      const competitorEntries: { keyword: string; title: string; domain: string; snippet: string }[] = [];
      const competitorDomains = new Set<string>();

      serpAll.forEach((res, idx) => {
        if (res.status !== 'fulfilled') return;
        const [google, yandex] = res.value;
        const kw = seeds[idx];
        for (const r of [...google.results, ...yandex.results]) {
          if (r.domain.includes('kadastrmap')) continue;
          competitorEntries.push({ keyword: kw, title: r.title, domain: r.domain, snippet: r.snippet || '' });
          competitorDomains.add(r.domain as string);
        }
      });

      // Deduplicate by title
      const seenTitles = new Set<string>();
      const uniqueCompetitor = competitorEntries.filter(e => {
        if (seenTitles.has(e.title)) return false;
        seenTitles.add(e.title);
        return true;
      });

      console.log(`[KeywordResearch] Found ${uniqueCompetitor.length} competitor titles from ${competitorDomains.size} domains`);

      // ── Step 2: build LLM prompt with real data ───────────────────────────
      const ourSection = input.ourTitles.length > 0
        ? `\nНАШ САЙТ — статьи которые УЖЕ ЕСТЬ (НЕ предлагай эти темы, только пробелы):\n${input.ourTitles.slice(0, 150).join('\n')}`
        : '';

      const competitorSection = uniqueCompetitor.length > 0
        ? `\nКОНКУРЕНТЫ — реальные заголовки из Google и Яндекс (${uniqueCompetitor.length} заголовков от: ${Array.from(competitorDomains).slice(0, 8).join(', ')}):\n${
            uniqueCompetitor.slice(0, 120).map(e => `[${e.keyword}] ${e.title} (${e.domain})`).join('\n')
          }`
        : '';

      const prompt = `Ты SEO-эксперт по российскому рынку недвижимости. Анализируй реальные данные и предложи ключевые запросы для kadastrmap.info.

О САЙТЕ:
kadastrmap.info — сервис справок о недвижимости. Пользователь вводит адрес или кадастровый номер и получает справку с данными из ЕГРН:
- кадастровая стоимость объекта
- история владельцев, переходы прав
- обременения, аресты, залоги
- характеристики объекта (площадь, этаж, назначение)
Это НЕ официальная выписка ЕГРН, но данные реальные — подходят для проверки перед покупкой, сделками, юридического анализа.
${ourSection}
${competitorSection}

ЗАДАЧА: на основе РЕАЛЬНЫХ данных конкурентов и пробелов нашего сайта предложи ${input.count} ключевых запросов.

Для каждого запроса укажи:
- keyword: точная поисковая фраза (как вводят в Яндекс/Google)
- trafficScore (1-10): относительный объём поиска
- conversionScore (1-10): вероятность заказа справки после прочтения статьи (10 = почти наверняка: "кто владелец квартиры")
- difficulty (1-5): конкуренция в топе (1=легко, 5=очень сложно)
- intent: "transactional" | "informational" | "commercial"
- source: "competitor" (нашёл у конкурентов выше) | "gap" (пробел — ни у нас, ни у конкурентов) | "expansion" (расширение существующих наших тем)
- articleTitle: конкретный заголовок статьи
- reason: 1 предложение — почему ценный запрос

ПРИОРИТЕТЫ:
1. Запросы с намерением заказать/проверить недвижимость (conversionScore 8-10)
2. Запросы которые есть у конкурентов, но которых НЕТ у нас
3. Информационные запросы с высоким трафиком (приводят аудиторию → конверсия в справку)

Верни ТОЛЬКО валидный JSON-массив без markdown:
[
  {
    "keyword": "проверить квартиру перед покупкой",
    "trafficScore": 9,
    "conversionScore": 10,
    "difficulty": 3,
    "intent": "transactional",
    "source": "competitor",
    "articleTitle": "Как проверить квартиру перед покупкой: полная инструкция 2025",
    "reason": "Покупатель хочет проверку — это прямая аудитория для заказа справки"
  }
]`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-эксперт. Анализируй реальные данные. Отвечай только валидным JSON-массивом.' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 8192,
      });

      let keywords: any[] = [];
      try {
        const raw = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
          : '[]';
        keywords = JSON.parse(raw);
        if (!Array.isArray(keywords)) keywords = [];
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Не удалось разобрать ответ AI' });
      }

      // Compute combined score and re-sort
      keywords = keywords.map(k => ({
        ...k,
        combinedScore: Math.round(((k.trafficScore * 0.35 + k.conversionScore * 0.65) / Math.max(1, k.difficulty)) * 10) / 10,
      })).sort((a, b) => b.combinedScore - a.combinedScore);

      return {
        keywords,
        count: keywords.length,
        serpStats: {
          seedsSearched: seeds.length,
          competitorTitles: uniqueCompetitor.length,
          competitorDomains: Array.from(competitorDomains).slice(0, 15),
          ourTitlesAnalyzed: input.ourTitles.length,
        },
      };
    }),

  /**
   * Start auto-rewrite batch: fetch SERP, fetch competitor content, rewrite to 1800+ words, save.
   */
  startBatchRewrite: protectedProcedure
    .input(z.object({
      urls: z.array(z.string().url()).min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const existing = batchRewriteJobs.get(userId);
      if (existing?.running) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Авто-улучшение уже запущено' });
      }

      runBatchRewrite(userId, input.urls).catch(err => {
        console.error('[BatchRewrite] Fatal error:', err);
        const job = batchRewriteJobs.get(userId);
        if (job) job.running = false;
      });

      return { started: true, total: input.urls.length };
    }),

  getBatchRewriteStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const job = batchRewriteJobs.get(ctx.user.id);
      if (!job) return { running: false, done: 0, total: 0, errors: 0, current: '' };
      return { running: job.running, done: job.done, total: job.total, errors: job.errors, current: job.current };
    }),

  stopBatchRewrite: protectedProcedure
    .mutation(async ({ ctx }) => {
      const job = batchRewriteJobs.get(ctx.user.id);
      if (job) { job.stop(); job.running = false; }
      return { stopped: true };
    }),

  // ── Scheduler ────────────────────────────────────────────────────────────

  getSchedulerConfig: protectedProcedure
    .query(async () => {
      const { getSchedulerConfig, getSchedulerStatus } = await import('../articleScheduler');
      return { config: getSchedulerConfig(), status: getSchedulerStatus() };
    }),

  saveSchedulerConfig: protectedProcedure
    .input(z.object({
      enabled:          z.boolean(),
      catalogUrl:       z.string().url(),
      articlesPerNight: z.number().min(1).max(200),
      hour:             z.number().min(0).max(23),
      userId:           z.number().min(1),
      skipImprovedDays: z.number().min(0).max(365),
    }))
    .mutation(async ({ input }) => {
      const { saveSchedulerConfig } = await import('../articleScheduler');
      saveSchedulerConfig(input);
      return { saved: true };
    }),

  // ── Progress stats ────────────────────────────────────────────────────────

  getProgressStats: protectedProcedure
    .query(async ({ ctx }) => {
      return articlesDb.getProgressStats(ctx.user.id);
    }),

});
// ROUTER_END — do not remove this marker

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Detect WP category ID based on article URL path
 * /novosti/ → 1 (Новости)
 * /kadastr/ → 2 (Кадастр)  — default
 */
function detectCategoryIds(url: string): number[] {
  const path = new URL(url).pathname;
  if (path.includes('/novosti/')) return [1];
  return [2]; // kadastr by default
}

/**
 * Maps a Russian heading text to a relevant emoji based on keywords.
 */
function pickHeadingEmoji(text: string): string {
  const t = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/кадастр|кпт|публичн|карт/, '🗺️'],
    [/стоимост|цен|рыноч|оценк/, '💰'],
    [/докум|справк|выписк|свидетельств/, '📄'],
    [/земл|участ|надел|межеван/, '🌱'],
    [/квартир|жил|недвижимост|объект/, '🏠'],
    [/оформлен|регистрац|сделк|купл|продаж/, '✍️'],
    [/срок|время|сколько|когда|период/, '⏱️'],
    [/налог/, '💼'],
    [/ипотек|кредит|банк/, '🏦'],
    [/заказ|получ|запрос/, '📝'],
    [/право|закон|правов|юрид/, '⚖️'],
    [/онлайн|интернет|сайт|электрон/, '💻'],
    [/строительств|строит|капиталь/, '🏗️'],
    [/росреестр|фкп|гкн/, '🏛️'],
    [/наследств|завещан/, '📜'],
    [/проверк|проверит|узнат/, '🔍'],
    [/история|архив|сведен/, '📚'],
    [/итог|вывод|заключен|резюме/, '✅'],
    [/часто|вопрос|faq/, '❓'],
    [/ошибк|ошибк|проблем/, '⚠️'],
    [/преимущест|плюс|польза|выгод/, '👍'],
    [/шаг|инструкц|порядок|этап/, '📋'],
    [/адрес|местопол|координат/, '📍'],
  ];
  for (const [re, emoji] of rules) {
    if (re.test(t)) return emoji;
  }
  return '📌';
}

/**
 * Post-process article HTML to add visual styling:
 * - h2/h3 → styled headings with emojis
 * - <ol> steps → numbered cards with colored step circles
 * - <ul> → green checkmark cards
 * - "Важно:" / "Обратите внимание" → yellow info-box
 */
function beautifyArticleHtml(html: string): string {
  const $ = cheerio.load(html, { xml: { decodeEntities: false } });

  // -1. Convert absolute kadastrmap.info links to relative paths
  $('a[href]').each((_: number, a: any) => {
    const href = $(a).attr('href') || '';
    const cleaned = href.replace(/^https?:\/\/kadastrmap\.info/i, '');
    if (cleaned !== href) $(a).attr('href', cleaned || '/');
  });

  // 0. Style h2 headings — green left border + emoji prefix
  $('h2').each((_: number, h2: any) => {
    const inner = $(h2).html() || '';
    const text = $(h2).text();
    // Skip if already has an emoji at the start
    if (/^\p{Emoji}/u.test(text.trim())) return;
    const emoji = pickHeadingEmoji(text);
    $(h2).replaceWith(
      `<h2 style="text-align:left;` +
      `margin:2em 0 0.75em;font-size:1.35em;font-weight:700;line-height:1.3;color:#1a202c;">` +
      `${emoji} ${inner}</h2>`
    );
  });

  // 0b. Style h3 headings — subtle green color + small emoji
  $('h3').each((_: number, h3: any) => {
    const inner = $(h3).html() || '';
    const text = $(h3).text();
    if (/^\p{Emoji}/u.test(text.trim())) return;
    const emoji = pickHeadingEmoji(text);
    $(h3).replaceWith(
      `<h3 style="color:#166534;font-size:1.1em;font-weight:600;margin:1.5em 0 0.5em;">` +
      `${emoji} ${inner}</h3>`
    );
  });

  // 1. Styled <ol> — step-by-step cards
  $('ol').each((_: number, ol: any) => {
    const items = $(ol).find('> li');
    if (items.length === 0) return;
    let stepsHtml = '<div style="margin:1.5em 0;">';
    items.each((idx: number, li: any) => {
      const text = $(li).html() || '';
      stepsHtml +=
        `<div style="display:flex;align-items:flex-start;gap:14px;padding:12px 16px;` +
        `margin-bottom:10px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">` +
        `<span style="flex-shrink:0;min-width:36px;width:36px;height:36px;border-radius:50%;background:#16a34a;` +
        `color:#fff;font-weight:700;font-size:16px;display:inline-flex;align-items:center;justify-content:center;` +
        `text-align:center;line-height:1;">${idx + 1}</span>` +
        `<span style="padding-top:7px;font-size:15px;line-height:1.6;">${text}</span>` +
        `</div>`;
    });
    stepsHtml += '</div>';
    $(ol).replaceWith(stepsHtml);
  });

  // 2. All <ul> → checkmark benefit cards
  $('ul').each((_: number, ul: any) => {
    const items = $(ul).find('> li');
    if (items.length === 0) return;
    let cardsHtml = '<div style="margin:1.5em 0;">';
    items.each((_idx: number, li: any) => {
      const text = $(li).html() || '';
      cardsHtml +=
        `<div style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;` +
        `margin-bottom:8px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;">` +
        `<span style="color:#16a34a;font-size:18px;flex-shrink:0;line-height:1.5;">✓</span>` +
        `<span style="font-size:15px;line-height:1.6;">${text}</span>` +
        `</div>`;
    });
    cardsHtml += '</div>';
    $(ul).replaceWith(cardsHtml);
  });

  // 3. Detect "Важно:" / "Обратите внимание" → yellow info-box
  $('p').each((_: number, p: any) => {
    const text = $(p).text();
    if (/^(важно|обратите внимание|примечание|внимание)[:\s!]/i.test(text.trim())) {
      const inner = $(p).html() || '';
      const box =
        `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;` +
        `padding:12px 16px;margin:1.5em 0;font-size:15px;line-height:1.7;">` +
        `<span style="font-size:18px;margin-right:8px;">⚠️</span>${inner}</div>`;
      $(p).replaceWith(box);
    }
  });

  return ($.root().html() || '').trim();
}

/**
 * Inject CTA buttons into existing HTML after H2 tags (at ~1/3, ~2/3, end)
 */
function injectCtasIntoHtml(
  html: string,
  ctaTexts: string[],
  ctaBlock: (text: string) => string
): string {
  // Split at </h2> to find injection points
  const parts = html.split('</h2>');
  if (parts.length <= 2) {
    // Few headings — inject at end only
    return html + ctaBlock(ctaTexts[2] || ctaTexts[0]);
  }

  const total = parts.length - 1; // number of </h2> occurrences
  const pos1 = Math.max(1, Math.floor(total / 3));
  const pos2 = Math.max(pos1 + 1, Math.floor((total * 2) / 3));

  return parts.reduce((acc, part, i) => {
    if (i === parts.length - 1) return acc + part + ctaBlock(ctaTexts[2] || ctaTexts[0]);
    const closing = '</h2>';
    if (i === pos1 - 1) return acc + part + closing + ctaBlock(ctaTexts[0]);
    if (i === pos2 - 1) return acc + part + closing + ctaBlock(ctaTexts[1] || ctaTexts[0]);
    return acc + part + closing;
  }, '');
}

function plainTextToHtmlWithCTAs(
  text: string,
  ctaTexts: string[],
  ctaBlock: (text: string) => string
): string {
  const blocks = text.split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const t = block.trim();
    if (!t) continue;
    if (t.startsWith('### ')) html.push(`<h3>${t.slice(4)}</h3>`);
    else if (t.startsWith('## ')) html.push(`<h2>${t.slice(3)}</h2>`);
    else if (t.startsWith('# ')) html.push(`<h1>${t.slice(2)}</h1>`);
    else {
      const lines = t.split('\n');
      if (lines.every(l => /^[-*]\s/.test(l))) {
        html.push('<ul>' + lines.map(l => `<li>${l.slice(2)}</li>`).join('') + '</ul>');
      } else if (lines.every(l => /^\d+\.\s/.test(l))) {
        html.push('<ol>' + lines.map(l => `<li>${l.replace(/^\d+\.\s/, '')}</li>`).join('') + '</ol>');
      } else {
        html.push(`<p>${t.replace(/\n/g, '<br>')}</p>`);
      }
    }
  }

  // Inject CTAs at ~1/3, ~2/3, and end
  const total = html.length;
  const pos1 = Math.floor(total / 3);
  const pos2 = Math.floor((total * 2) / 3);

  const result: string[] = [];
  for (let i = 0; i < html.length; i++) {
    result.push(html[i]);
    if (i === pos1 - 1) result.push(ctaBlock(ctaTexts[0]));
    if (i === pos2 - 1) result.push(ctaBlock(ctaTexts[1]));
  }
  result.push(ctaBlock(ctaTexts[2])); // end
  return result.join('\n');
}
