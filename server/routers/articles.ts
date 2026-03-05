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

      // 2. SEO analysis + improved text — parallel
      const seoPrompt = `Ты SEO-эксперт. Проанализируй статью и верни JSON.

Заголовок: ${parsed.title}
Мета-описание: ${parsed.metaDescription || '(отсутствует)'}
Структура заголовков: ${parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ')}
Текст статьи (фрагмент):
${contentForLLM}

Верни ТОЛЬКО валидный JSON без markdown-блоков:
{
  "metaTitle": "оптимизированный title (до 60 символов)",
  "metaDescription": "оптимизированное мета-описание (до 160 символов)",
  "keywords": ["ключевое1", "ключевое2", ...до 8 штук],
  "headingsSuggestions": [
    { "level": "H1", "current": "текущий заголовок", "suggested": "улучшенный заголовок" }
  ],
  "generalSuggestions": ["совет1", "совет2", ...до 5 советов],
  "score": 75
}`;

      const improvePrompt = `Ты редактор-копирайтер. Улучши статью: сделай текст более читаемым, информативным, добавь структуру если нужно. Сохрани смысл и язык оригинала. Верни ТОЛЬКО улучшенный текст без комментариев.

Оригинальный заголовок: ${parsed.title}
Текст:
${contentForLLM}`;

      const [seoResponse, improvedResponse] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: "Ты SEO-эксперт. Отвечай только валидным JSON." },
            { role: "user", content: seoPrompt },
          ],
        }),
        invokeLLM({
          messages: [
            { role: "system", content: "Ты редактор-копирайтер. Улучшай тексты." },
            { role: "user", content: improvePrompt },
          ],
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
          { role: 'system', content: 'Ты эксперт-копирайтер и SEO-специалист. Пишешь полные, структурированные статьи.' },
          { role: 'user', content: `Ключевое слово: "${input.keyword}"

Наша текущая статья:
Заголовок: ${input.originalTitle}
Текст:
${input.originalContent.slice(0, 4000)}

Конкуренты в ТОП-10 поиска:
${competitorList}

Задача: перепиши нашу статью так, чтобы она:
1. Покрывала ВСЕ темы и аспекты которые есть у конкурентов (судя по заголовкам и сниппетам)
2. Была лучше структурирована (подзаголовки H2/H3, списки, таблицы где уместно)
3. Была более полной и информативной чем каждый из конкурентов по отдельности
4. Сохраняла язык и стиль оригинала
5. Начиналась с краткого вводного абзаца отвечающего на главный вопрос пользователя

Верни ТОЛЬКО готовый текст статьи без комментариев и пояснений.` },
        ],
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
});

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
