import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { parseArticleFromUrl, scanCatalog } from "../_core/articleParser";
import { fetchGoogleSerp, fetchYandexSerp } from "../_core/serpParser";
import { invokeLLM } from "../_core/llm";
import { generateDallEImage } from "../_core/imageGen";
import * as wp from "../_core/wordpress";
import { createContentPost } from "../db";
import * as articlesDb from "../articles.db";
import * as wordpressDb from "../wordpress.db";

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
      const parsed = await Promise.race([
        parseArticleFromUrl(r.url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      return {
        position: i + 1,
        domain: r.domain,
        title: parsed.title,
        headings: parsed.headings.map(h => `${h.level}: ${h.text}`).join(' | '),
        content: parsed.content.slice(0, 4000),
        wordCount: parsed.wordCount,
      };
    }),
  );

  return fetched
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);
}

async function analyzeAndSaveArticle(userId: number, url: string): Promise<void> {
  const parsed = await parseArticleFromUrl(url);
  const contentForLLM = parsed.content.slice(0, 6000);
  const serpKeyword = extractKeywordFromTitle(parsed.title);
  const ourDomain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();

  // Step 1: fetch SERP + our article in parallel
  const [googleSerp, yandexSerp] = await Promise.all([
    fetchGoogleSerp(serpKeyword).catch(() => ({ results: [], error: 'fetch failed' })),
    fetchYandexSerp(serpKeyword).catch(() => ({ results: [], error: 'fetch failed' })),
  ]);

  // Step 2: fetch top-3 competitor articles from best SERP
  const bestSerp = (googleSerp.results.length >= yandexSerp.results.length ? googleSerp : yandexSerp).results;
  const competitors = await fetchCompetitorArticles(bestSerp, ourDomain);

  // Step 3: build competitor context for prompts
  const avgCompetitorWords = competitors.length > 0
    ? Math.round(competitors.reduce((s, c) => s + (c.wordCount || 0), 0) / competitors.length)
    : 1500;
  const targetWords = Math.max(1500, avgCompetitorWords + 300);

  const competitorContext = competitors.length > 0
    ? competitors.map((c, i) => `Конкурент #${i + 1} (${c.domain}, ~${c.wordCount} слов):
  Заголовок: ${c.title}
  Структура: ${c.headings || '—'}
  Текст (фрагмент): ${c.content}`).join('\n\n')
    : '(конкуренты недоступны)';

  const ourHeadings = parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ');

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

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов (конкуренты пишут в среднем ${avgCompetitorWords} слов — нужно превзойти)
2. Структура HTML: один H1, 6-10 подзаголовков H2, H3 где уместно, списки <ul>/<ol>, таблицы <table> где есть данные для сравнения
3. Начало: прямой ответ на запрос "${serpKeyword}" в первых 2-3 предложениях (featured snippet)
4. Охват тем: включи ВСЕ темы конкурентов которых нет у нас
5. FAQ-раздел: добавь H2 "Часто задаваемые вопросы" с минимум 5 вопросами-ответами (важно для блока "Люди также спрашивают" в Яндексе)
6. E-E-A-T: добавь конкретные факты, числа, сроки, стоимости, ссылки на законы где уместно
7. Пошаговые инструкции: нумерованные списки для процессов
8. Сохрани тематику: статья про кадастр/недвижимость — упоминай возможность заказать справку онлайн
9. Сохрани язык и стиль оригинала

Верни ТОЛЬКО готовый HTML-текст статьи используя теги: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <td>, <th>, <strong>, <em>. Без <html>/<body>/<head> тегов.`;

  const [seoResponse, improvedResponse] = await Promise.all([
    invokeLLM({ messages: [{ role: 'system', content: 'Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON.' }, { role: 'user', content: seoPrompt }] }),
    invokeLLM({ messages: [{ role: 'system', content: 'Ты SEO-копирайтер. Пишешь длинные полные статьи для топа поиска. Всегда пиши HTML.' }, { role: 'user', content: improvePrompt }], maxTokens: 8192 }),
  ]);

  let seo: SeoAnalysis;
  try {
    const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
      ? seoResponse.choices[0].message.content.trim() : '{}';
    seo = JSON.parse(seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    seo = { metaTitle: parsed.title, metaDescription: parsed.metaDescription, keywords: [], headingsSuggestions: [], generalSuggestions: [], score: 0 };
  }

  const improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
    ? improvedResponse.choices[0].message.content.trim() : parsed.content;

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
    wordCount: parsed.wordCount,
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

      // 2. Fetch SERP + competitors in parallel with SEO analysis
      const [googleSerp, yandexSerp] = await Promise.all([
        fetchGoogleSerp(serpKeyword).catch(() => ({ results: [], error: 'fetch failed' })),
        fetchYandexSerp(serpKeyword).catch(() => ({ results: [], error: 'fetch failed' })),
      ]);

      const bestSerp = (googleSerp.results.length >= yandexSerp.results.length ? googleSerp : yandexSerp).results;
      const competitors = await fetchCompetitorArticles(bestSerp, ourDomain);

      const avgCompetitorWords = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + (c.wordCount || 0), 0) / competitors.length)
        : 1500;
      const targetWords = Math.max(1500, avgCompetitorWords + 300);

      const competitorContext = competitors.length > 0
        ? competitors.map((c, i) => `Конкурент #${i + 1} (${c.domain}, ~${c.wordCount} слов):
  Заголовок: ${c.title}
  Структура: ${c.headings || '—'}
  Текст (фрагмент): ${c.content}`).join('\n\n')
        : '(конкуренты недоступны)';

      const ourHeadings = parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ');

      // 3. SEO analysis + improved text — parallel, with competitor context
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
  "headingsSuggestions": [
    { "level": "H1", "current": "текущий заголовок", "suggested": "улучшенный с ключом" }
  ],
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

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов (конкуренты пишут в среднем ${avgCompetitorWords} слов — нужно превзойти)
2. Структура HTML: один H1, 6-10 подзаголовков H2, H3 где уместно, списки <ul>/<ol>, таблицы <table> где есть данные для сравнения
3. Начало: прямой ответ на запрос "${serpKeyword}" в первых 2-3 предложениях (featured snippet)
4. Охват тем: включи ВСЕ темы конкурентов которых нет у нас
5. FAQ-раздел: добавь H2 "Часто задаваемые вопросы" с минимум 5 вопросами-ответами (важно для блока "Люди также спрашивают" в Яндексе)
6. E-E-A-T: добавь конкретные факты, числа, сроки, стоимости, ссылки на законы где уместно
7. Пошаговые инструкции: нумерованные списки для процессов
8. CTA: упомяни что на kadastrmap.info можно заказать справку на объект (данные из ЕГРН, подходят для проверки при сделках и юридического анализа — это не выписка ЕГРН, но содержит все реальные сведения)
9. Сохрани язык и стиль оригинала

Верни ТОЛЬКО готовый HTML-текст статьи используя теги: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <td>, <th>, <strong>, <em>. Без <html>/<body>/<head> тегов.`;

      const [seoResponse, improvedResponse] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: "Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON." },
            { role: "user", content: seoPrompt },
          ],
        }),
        invokeLLM({
          messages: [
            { role: "system", content: "Ты SEO-копирайтер. Пишешь длинные полные статьи для топа поиска. Всегда пиши HTML." },
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

      const improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
        ? improvedResponse.choices[0].message.content.trim()
        : parsed.content;

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
          wordCount: parsed.wordCount,
          improvedTitle: seo.metaTitle || parsed.title,
          improvedContent,
          metaTitle: seo.metaTitle || null,
          metaDescription: seo.metaDescription || null,
          keywords: JSON.stringify(seo.keywords || []),
          generalSuggestions: JSON.stringify(seo.generalSuggestions || []),
          headings: JSON.stringify(parsed.headings || []),
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
        headings: parsed.headings,
        wordCount: parsed.wordCount,
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
        fetchGoogleSerp(input.keyword),
        fetchYandexSerp(input.keyword),
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
6. E-E-A-T: конкретные факты, числа, сроки, стоимости, нормативные акты
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
      ctaHint:  z.string().default('Вы можете заказать справку на объект недвижимости онлайн — данные реальные из ЕГРН, подходят для проверки объекта, сделок и юридического анализа. Заказать на kadastrmap.info'),
    }))
    .mutation(async ({ input }) => {
      // 1. SERP
      const [googleSerp, yandexSerp] = await Promise.all([
        fetchGoogleSerp(input.keyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
        fetchYandexSerp(input.keyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
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
7. FAQ: H2 "Часто задаваемые вопросы" → минимум 6 вопросов-ответов (для блока "Люди также спрашивают")
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
      content:     z.string(),  // plain text (improved)
      ctaUrl:      z.string().url(),
      generateImage: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Get WP account
      const account = await wordpressDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'WordPress аккаунт не найден' });

      // 2. Extract slug from original URL
      const slug = new URL(input.originalUrl).pathname.replace(/\/$/, '').split('/').pop() || '';
      if (!slug) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Не удалось извлечь slug из URL' });

      // 3. Find post by slug
      const post = await wp.findPostBySlug(account.siteUrl, account.username, account.appPassword, slug);
      if (!post) throw new TRPCError({ code: 'NOT_FOUND', message: `Статья со slug "${slug}" не найдена на сайте` });

      // 4. In parallel: generate CTA texts + optional DALL-E image
      const [ctaResponse, imageUrl] = await Promise.all([
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
        input.generateImage
          ? generateDallEImage(
              `Профессиональная иллюстрация для статьи о "${input.title}". ` +
              `Российская недвижимость, кадастр, документы. Чистый современный стиль, без текста.`
            ).catch((e) => { console.error('[Articles] DALL-E failed:', e.message); return null; })
          : Promise.resolve(null),
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

      // 5. Upload image to WP media if generated
      let featuredMediaId: number | undefined;
      if (imageUrl) {
        try {
          const media = await wp.uploadMediaFromUrl(
            account.siteUrl, account.username, account.appPassword,
            imageUrl, `${slug}.jpg`
          );
          featuredMediaId = media.id;
        } catch (e: any) {
          console.error('[Articles] Media upload failed:', e.message);
        }
      }

      // 6. Convert plain text → HTML + inject CTAs
      const ctaBlock = (text: string) =>
        `\n<div style="text-align:center;margin:2em 0 2.5em;">` +
        `<a href="${input.ctaUrl}" style="display:inline-block;background:#4CAF50;color:#fff;` +
        `padding:16px 48px;border-radius:8px;font-size:16px;font-weight:500;text-decoration:none;">` +
        `${text}</a></div>\n`;

      const htmlContent = plainTextToHtmlWithCTAs(input.content, ctaTexts, ctaBlock);

      // 7. Update WP post
      const updated = await wp.updatePost(
        account.siteUrl, account.username, account.appPassword,
        post.id,
        {
          title: input.title,
          content: htmlContent,
          ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        }
      );

      return {
        success: true,
        link: updated.link,
        imageUploaded: !!featuredMediaId,
        ctaTexts,
      };
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
   * Lightweight SERP position check for one keyword — no AI
   */
  checkPosition: protectedProcedure
    .input(z.object({
      keyword: z.string().min(1),
      domain:  z.string().default('kadastrmap.info'),
    }))
    .mutation(async ({ input }) => {
      const [google, yandex] = await Promise.all([
        fetchGoogleSerp(input.keyword),
        fetchYandexSerp(input.keyword),
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
   * Conversion = likelihood the user will order a document (справка) after reading the article.
   */
  suggestConversionKeywords: protectedProcedure
    .input(z.object({
      seedKeywords: z.array(z.string()).default([]),
      ourTitles:    z.array(z.string()).default([]),
      count:        z.number().min(10).max(150).default(60),
    }))
    .mutation(async ({ input }) => {
      const seedSection = input.seedKeywords.length > 0
        ? `\nСтартовые ключевые слова для расширения:\n${input.seedKeywords.join(', ')}`
        : '';

      const titlesSection = input.ourTitles.length > 0
        ? `\nСтатьи уже есть на нашем сайте (НЕ предлагай эти темы):\n${input.ourTitles.slice(0, 100).join('\n')}`
        : '';

      const prompt = `Ты эксперт по SEO и контент-маркетингу для российского рынка. Анализируй ключевые запросы для сайта kadastrmap.info.

О САЙТЕ:
kadastrmap.info — сервис справок о недвижимости. Пользователь вводит адрес или кадастровый номер и получает справку с данными из ЕГРН:
- кадастровая стоимость объекта
- история владельцев, переходы прав
- обременения, аресты, залоги
- характеристики объекта (площадь, этаж, назначение)
ВАЖНО: это не официальная выписка ЕГРН (её выдаёт только Росреестр), но данные реальные из ЕГРН, пригодны для проверки перед покупкой, сделками, юридическим анализом.

АУДИТОРИЯ: люди, которые:
- покупают/продают недвижимость и хотят проверить объект
- хотят узнать кадастровую стоимость
- проверяют обременения и аресты
- хотят узнать историю собственников
- оформляют ипотеку, наследство, дарение
${seedSection}
${titlesSection}

ЗАДАЧА: придумай ${input.count} ключевых запросов. Для каждого оцени:
- trafficScore (1-10): относительный объём поиска в Яндексе/Google (10 = очень высокий)
- conversionScore (1-10): насколько пользователь с этим запросом скорее всего ЗАКАЖЕТ справку (10 = почти точно закажет: например "кто владелец квартиры узнать онлайн")
- difficulty (1-5): сложность попасть в топ-3 (1 = легко, 5 = очень сложно)
- intent: "transactional" (хочет что-то сделать/заказать) | "informational" (хочет узнать) | "commercial" (сравнивает варианты)
- articleTitle: конкретный заголовок статьи под этот запрос
- reason: 1 предложение — почему высокая конверсия или трафик

Приоритизируй запросы с ВЫСОКОЙ конверсией (conversionScore >= 7):
- "проверить квартиру перед покупкой"
- "узнать владельца недвижимости"
- "кадастровая стоимость онлайн"
- "проверить обременение на квартиру"
- подобные…

Верни ТОЛЬКО валидный JSON-массив без markdown:
[
  {
    "keyword": "проверить квартиру перед покупкой",
    "trafficScore": 9,
    "conversionScore": 10,
    "difficulty": 3,
    "intent": "transactional",
    "articleTitle": "Как проверить квартиру перед покупкой: полная инструкция 2024",
    "reason": "Пользователь готов заказать справку прямо сейчас — ему нужна проверка"
  }
]

Сортируй по убыванию: (trafficScore * 0.35 + conversionScore * 0.65) / difficulty`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: 'Ты SEO-эксперт. Отвечай только валидным JSON-массивом.' },
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

      return { keywords, count: keywords.length };
    }),

});
// ROUTER_END — do not remove this marker

// ── helpers ──────────────────────────────────────────────────────────────────

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
