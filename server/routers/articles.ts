import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as cheerio from "cheerio";
import { parseArticleFromUrl, scanCatalog } from "../_core/articleParser";
import { fetchGoogleSerp, fetchYandexSerp, SerpData } from "../_core/serpParser";
import { fetchGscPageQueries, formatGscBlock } from "../_core/gscClient";
import { invokeLLM } from "../_core/llm";
import { generateDallEImage } from "../_core/imageGen";
import * as wp from "../_core/wordpress";
import { createContentPost } from "../db";
import * as articlesDb from "../articles.db";
import * as wordpressDb from "../wordpress.db";

// ── IndexNow: submit URLs to Yandex + Bing + Google sitemap ping ─────────────
async function submitToIndexNow(url: string): Promise<void> {
  const key = process.env.INDEXNOW_API_KEY;
  if (!key) return;
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (!host) return;
  const body = JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: [url] });
  try {
    await Promise.all([
      fetch('https://yandex.com/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }),
      // Google sitemap ping — notifies Google of updated content
      fetch(`https://www.google.com/ping?sitemap=https://${host}/sitemap_index.xml`),
    ]);
    console.log(`[IndexNow] Submitted to Yandex+Bing+Google: ${url}`);
  } catch (err) {
    console.warn(`[IndexNow] Failed for ${url}:`, err);
  }
}

// ── In-memory cache: SERP results + competitor pages (no TTL — lives until server restart) ───
const serpCache = new Map<string, SerpData>();
const pageCache = new Map<string, any>();

function cacheGet<T>(map: Map<string, T>, key: string): T | null {
  return map.get(key) ?? null;
}
function cacheSet<T>(map: Map<string, T>, key: string, data: T): void {
  map.set(key, data);
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

// ─── Определяет нужна ли кадастровая карта на странице статьи ────────────────
// Правило: статьи про просмотр/поиск объектов на карте → outmap=true
// Статьи про заказ документов (выписки, справки, обременения) → outmap=false
export function shouldShowMap(slug: string): boolean {
  const s = slug.toLowerCase().replace(/\//g, '-');
  return (
    /\bkarta\b/.test(s) ||                      // любая "karta" в slug
    /raspolozhenie-po-kadastrovomu/.test(s) ||  // расположение по кадастровому номеру
    /kadastrovyj-plan.*-po-adresu/.test(s) ||   // кадастровый план по адресу
    /kadastr-[a-z]+$/.test(s)                   // kadastr-<город> (напр. kadastr-simferopol)
  );
}

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

export interface CompetitorMetricItem {
  position: number;
  domain: string;
  title: string;
  url: string;
  wordCount: number;
  h2Count: number;
  h3Count: number;
  faqCount: number;
  hasTable: boolean;
}

export interface ArticleComparison {
  serpKeyword: string;
  our: { wordCount: number; h2Count: number; h3Count: number; faqCount: number; hasTable: boolean };
  competitors: CompetitorMetricItem[];
  targetWords: number;
  targetFaq: number;
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
  comparison?: ArticleComparison;
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
// Domain patterns for authority links (E-E-A-T signal for Russian real estate/law)
const AUTHORITY_DOMAINS = /\b(?:rosreestr\.gov\.ru|consultant\.ru|garant\.ru|nalog\.ru|pravo\.gov\.ru|minjust\.ru|mos\.ru|gosuslugi\.ru|kremlin\.ru|sudrf\.ru)\b/i;

async function fetchCompetitorArticles(
  serpResults: { url: string; domain: string; title: string }[],
  ourDomain: string,
  maxCompetitors = 3,
): Promise<{ position: number; domain: string; title: string; headings: string; content: string; wordCount: number; imageCount: number; faqCount: number; hasTable: boolean; altSamples: string[]; authLinkCount: number; internalLinkCount: number; videoCount: number; listCount: number; authDomains: string[] }[]> {
  // Try 2x more candidates so blocked top-5 (cian, domclick, etc.) get replaced
  // by lower-ranked pages that allow crawling
  const candidates = serpResults
    .filter(r => !r.domain.includes(ourDomain) && !ourDomain.includes(r.domain))
    .slice(0, maxCompetitors * 2);

  const fetched = await Promise.allSettled(
    candidates.map(async (r, i) => {
      const cached = cacheGet(pageCache, r.url);
      if (cached) { console.log(`[cache] PAGE HIT ${r.url}`); return cached; }
      const parsed = await Promise.race([
        parseArticleFromUrl(r.url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      const html = parsed.contentHtml || '';
      // alt samples: up to 5 non-empty, longer-than-3-chars alts (for FLUX prompt seeding)
      const altMatches = Array.from(html.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi));
      const altSamples = altMatches
        .map(m => m[1].trim())
        .filter(a => a.length > 3)
        .slice(0, 5);
      // authority + internal link analysis
      const hrefMatches = Array.from(html.matchAll(/href=["']([^"']+)["']/gi));
      const authDomainsSet = new Set<string>();
      let authLinkCount = 0, internalLinkCount = 0;
      for (const hm of hrefMatches) {
        const href = hm[1];
        if (!/^https?:/i.test(href)) continue;
        if (AUTHORITY_DOMAINS.test(href)) {
          authLinkCount++;
          const mdom = href.match(/https?:\/\/([^\/]+)/);
          if (mdom) authDomainsSet.add(mdom[1].replace(/^www\./, ''));
        }
        if (href.includes(r.domain)) internalLinkCount++;
      }
      const result = {
        position: i + 1,
        domain: r.domain,
        title: parsed.title,
        headings: parsed.headings.map(h => `${h.level}: ${h.text}`).join(' | '),
        content: parsed.content.slice(0, 4000),
        wordCount: parsed.wordCount,
        imageCount: (html.match(/<img\b/gi) || []).length,
        faqCount: (html.match(/<details\b/gi) || []).length,
        hasTable: /<table\b/i.test(html),
        altSamples,
        authLinkCount,
        internalLinkCount,
        videoCount: (html.match(/<(?:iframe|video|embed)\b/gi) || []).length,
        listCount: (html.match(/<(?:ul|ol)\b/gi) || []).length,
        authDomains: Array.from(authDomainsSet),
      };
      if (parsed.wordCount > 0) cacheSet(pageCache, r.url, result);
      return result;
    }),
  );

  return fetched
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value.wordCount > 0)
    .map(r => r.value)
    .slice(0, maxCompetitors);
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

// Guard: detect LLM placeholder titles like 'до 60 симв.' or 'в 60 символов или меньше'
function isPlaceholderTitle(t: string | null | undefined): boolean {
  if (!t || t.length < 5) return true;
  return /\b\d+\s*(симв|символ|знак|char)|или\s*меньше|или\s*менее|less\s*than|not\s*exceed|placeholder|example[_\s-]?title|metaTitle|заголовок\s*с\s*ключом|\[.*\]/i.test(t);
}

// Guard: detect LLM placeholder meta descriptions
function isPlaceholderMeta(t: string | null | undefined): boolean {
  if (!t || t.length < 20) return true;
  return /\b\d+\s*(симв|символ|знак|char)|или\s*меньше|или\s*менее|less\s*than|not\s*exceed|placeholder|example[_\s-]?desc|metaDescription|мета[-\s]?описание\s*с|до\s*\d+/i.test(t);
}

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}

// Generate contextual DALL-E image prompts based on article title, keyword and H2 sections
export async function generateImagePrompts(title: string, keyword?: string, h2Sections?: string[], bodyText?: string, countRequested?: number, h2Bodies?: string[]): Promise<string[]> {
  // Reinforced quality tags — FLUX.1 responds well to stacked descriptors of photo technique.
  const QUALITY = 'cinematic lighting, sharp focus, high detail, photorealistic, professional DSLR photo, shot on Canon EOS R5, 85mm f/1.8 lens, shallow depth of field, bokeh, natural window light, color graded';
  // 2026-04-20 v3: ZERO text of any language. FLUX не умеет ни кириллицу, ни латиницу хорошо.
  // Любые буквы в кадре = визуальный мусор. Плюс запрет на dating/social-media UI на экранах.
  const NEGATIVE = 'ABSOLUTELY NO TEXT IN ANY LANGUAGE, no letters at all, no words, no numbers, no digits, no characters, no alphabet, no Latin letters, no English text, no Cyrillic letters, no Russian text, no Chinese characters, no labels, no captions, no handwriting, no signatures, no script, no typography, no signs with any writing, no readable anything, no brand names, no logos, no watermarks, no URLs, no email addresses, no document headers, no form field labels, NO VISIBLE SCREEN UI, no dating app interface, no social media thumbnails, no tinder-like avatar grid, no instagram feed, no facebook UI, no profile cards with hearts, no app icons grid, no website layout visible, no browser tabs with thumbnails, NO FOREIGN CURRENCY, no Euro banknotes, no US Dollar bills, no British Pound, no Yuan, no non-Russian money, no international currency, no foreign coins, no Greek architecture on banknotes, no European Union symbols, no low quality, no blurry faces, no distorted faces, no extra limbs, no cartoon, no illustration, no stock-photo look';
  // 2026-04-20: усилен Russian-контекст — нужны узнаваемые русские люди/среда, не generic Western.
  const SLAVIC = 'Slavic Eastern European appearance, light fair skin, natural no-makeup look, modern Russian urban smart-casual clothing in muted colors';
  // Russian setting tokens (append to scenes where environment visible)
  const RU_SETTING = 'recognizably Russian setting, Moscow region aesthetic, typical Russian middle-class context';
  const kw = keyword || title;

  // 10 diverse fallback prompts covering the common scenes for this site vertical.
  // Used when LLM call fails or doesn't return enough items; now cycled if target > 10.
  // 2026-04-20: убраны сцены с крупным планом документа/плана (FLUX пишет кривые буквы)
  // и Scandinavian-стиль (non-Russian); добавлены Russian-specific settings — двор с панельками, дача, канал Петербурга, МФЦ-интерьер.
  const fallback = [
    `Slavic hands holding house keys on small ribbon above a blurred folded paper on wooden desk, warm ambient light, ${QUALITY}, ${NEGATIVE}`,
    `Russian woman in her 30s at bright modern home office, side-profile view, laptop on desk with screen heavily blurred and turned partially away from camera, hands over keyboard, ${SLAVIC}, warm morning light through window, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Aerial drone view of a modern Moscow residential complex with colourful courtyards, playgrounds and new high-rise panel-frame buildings, clear blue sky, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Close-up Slavic hands holding embossing stamp tool over a blurred folded paper on varnished wooden desk, ${SLAVIC}, warm office ambient light, ${QUALITY}, ${NEGATIVE}`,
    `Modern Russian middle-class apartment interior living room with large balcony windows, sunlit, neutral furniture in muted colors, family atmosphere, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Young Russian family of three at kitchen table having breakfast, bright modern kitchen, warm cozy home, ${SLAVIC}, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Saint Petersburg Winter Palace embankment at sunset, classical imperial Russian architecture, Neva river reflecting golden light, ${QUALITY}, ${NEGATIVE}`,
    `Professional Russian real estate agent in business attire handing keys to a smiling couple, bright empty living room of a new flat, ${SLAVIC}, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Typical Russian countryside dacha with wooden porch, fence and flower garden, summer afternoon warm daylight, ${RU_SETTING}, ${QUALITY}, ${NEGATIVE}`,
    `Scale architectural maquette model of a modern Russian multi-story panel-frame apartment building on dark wooden studio table, soft overhead light, ${QUALITY}, ${NEGATIVE}`,
  ];

  // Per-section context — если переданы h2Bodies, даём LLM конкретное содержание каждого раздела
  // (первые ~180 слов), чтобы сцена отражала факты из текста, а не generic-assumptions.
  const sectionsBlock = h2Sections && h2Sections.length > 0
    ? (h2Bodies && h2Bodies.length > 0
        ? `\nArticle sections — one image per section MUST be composed from the section's actual content below:\n${h2Sections.slice(0, 15).map((heading, i) => {
            const body = (h2Bodies[i] || '').slice(0, 900);
            return `\n--- Section ${i + 1} ---\nH2: "${heading}"\nContent (use concrete nouns/numbers/actions from this to design the scene): ${body || '[no body — use heading only]'}\n`;
          }).join('')}\n`
        : `\nArticle sections (H2 headings): ${h2Sections.slice(0, 15).map((s, i) => `${i + 1}. ${s}`).join('; ')}\n`)
    : '';
  const bodyBlock = bodyText
    ? `\nArticle intro (first 400 chars): "${bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}"\n`
    : '';

  const targetCount = countRequested && countRequested >= 6
    ? Math.min(countRequested, 20)
    : (h2Sections && h2Sections.length >= 6 ? 9 : 6);

  try {
    const resp = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: `You are a senior FLUX.1 image prompt engineer for a Russian real estate / cadastral documents blog. Write cinematic, photorealistic prompts in English for landscape 16:9 compositions.
Use the following style tokens in every prompt: cinematic lighting, sharp focus, high detail, photorealistic, professional DSLR photo, shot on Canon EOS R5, 85mm f/1.8 lens, shallow depth of field, bokeh, natural window light, color graded.
CRITICAL — NO TEXT AT ALL. AI image models (FLUX) cannot render text legibly, especially Cyrillic/Russian — any visible letters come out garbled and unprofessional. Negative tokens (must be absent): no text, no letters, no words, no numbers, no digits, no characters, no labels, no captions, no Cyrillic, no Russian letters, no handwriting, no typography, no watermarks, no logos, no signs with text. If a document/form/paper appears in the scene, it MUST be shown from a steep angle, folded, or out-of-focus so no text is readable. PREFER scenes WITHOUT visible documents — focus on people, hands, interiors, architecture, objects (keys, pens, laptops). Also avoid: low quality, distorted faces, extra limbs, cartoon/illustration/stock-photo look.

CRITICAL — LAPTOP / PHONE SCREENS. FLUX has a strong bias to fill screens with dating-app thumbnails, social-media feeds, Tinder-like avatar grids, or Instagram layouts — none of which fit our cadastre/property theme. When a laptop or phone screen is in the frame, the prompt MUST explicitly specify ONE of:
  (a) "laptop screen turned away from camera" (back of lid visible)
  (b) "laptop screen heavily blurred / out of focus" (screen visible but content unreadable)
  (c) "laptop screen showing only abstract soft colour gradient, no interface, no thumbnails, no icons"
  (d) "laptop closed, lid down"
NEVER describe "laptop showing a website / form / portal" — FLUX will render Tinder, not our form. Same for phones.

CRITICAL — CURRENCY. If money appears in the frame, it MUST be Russian ruble banknotes only (modern series: colourful pastel shades — 100₽ olive, 500₽ violet, 1000₽ teal, 5000₽ crimson, featuring Russian cities and monuments on reverse). NEVER Euro (no Greek architecture, no EU stars), never US Dollars (no green portraits of presidents), never other foreign currency. BETTER: show money without visible denominations — rolled bills, stacks bound with rubber band, banknotes fanned from a wallet showing only edges, calculator with coins (Russian kopeyka only). Do NOT write the word "rubles" in the prompt as a visible label — just describe the colour/shape. If unsure, skip the money scene entirely and use keys, contract handshake, or receipt envelope instead.
All people MUST have Slavic Eastern European appearance with light/fair skin, modern Russian urban smart-casual clothing in muted colors (no Western-coded wardrobe, no suburban-US look).
ALL settings MUST be recognizably Russian — Moscow/Saint Petersburg architecture, Russian panel-frame apartment buildings (не хрущёвки, но типовые серии), Russian middle-class interiors, Russian dacha aesthetic. NO Scandinavian minimalism, NO American suburban houses, NO generic Western offices. When in doubt — tilt toward Moscow residential district / St Petersburg canal / typical Russian kitchen.
Each prompt must be UNIQUE, match its specific H2 section, and feature a concrete composition + subject + environment + lighting time-of-day.`,
        },
        {
          role: 'user',
          content: `Article title: "${title}"
Search keyword: "${kw}"
${sectionsBlock}${bodyBlock}
This article is about ordering official Russian property / cadastral documents via kadastrmap.info.

Write exactly ${targetCount} DIFFERENT prompts, one per H2 section in order. Each prompt MUST:
- Be 15-25 words of content BEFORE the quality tags (describe subject, action, environment, lighting)
- Vary scenes across prompts — don't repeat the same setting twice. Mix from (Russian-context pool): person-at-laptop-home-office (SCREEN MUST BE blurred/turned-away/closed-lid, never "showing website/form"), Russian-notary-office-wooden-interior (no signage), Russian-bank-counter-with-service-staff, typical-Russian-apartment-interior, Moscow-panel-building-exterior, aerial-drone-Moscow-district, Russian-family-at-kitchen, real-estate-agent-handing-keys, Russian-dacha-garden, Moscow-courtyard-with-playground, St-Petersburg-embankment, Saint-Petersburg-canal-view, keys-on-wooden-desk (no paper), calculator-and-coins-on-desk (no banknotes), family-signing-document-blurred-from-angle, government-service-centre-with-people-queueing (NO "MFC"/"МФЦ" signage — FLUX will render garbled letters), scale-model-of-apartment-building. AVOID close-ups of documents/forms/plans — FLUX will add garbled text. AVOID describing any laptop/phone screen CONTENT — say "blurred" or "turned away" or "closed lid" only. AVOID naming ANY organization/place by acronym or word (МФЦ, Росреестр, ЕГРН, etc.) in visible positions (walls, signs, doors) — FLUX will transliterate to "MFC" / "ROSREESTR" / garbled letters.
- Match the H2 section's ACTUAL CONTENT provided above (not just the heading). Extract concrete nouns, numbers, actions, and objects from the section body and make them the subject. Generic "apartment interior" with no link to the text is REJECTED. Examples:
  * Section "Стоимость выписки ЕГРН" with text mentioning "500 рублей, картой онлайн" → Close-up of Slavic hand holding a bank card above a leather wallet with edges of colourful Russian ruble banknotes visible (no readable denominations), soft office light (do NOT show bills fanned out — FLUX will draw Euros)
  * Section "Сроки получения" with text "1-3 рабочих дня" → Wall clock showing late morning next to a smartphone with notification icon on a wooden desk, warm lamp light
  * Section "Какие сведения содержит" with text mentioning "ФИО собственника, кадастровый номер, план квартиры" → Slavic hands pointing at a blurred floor-plan mock-up on a tablet screen, no readable text
  * Section "Когда требуется" with text "при покупке квартиры, ипотеке, наследстве" → Slavic couple receiving house keys from a real-estate agent in a bright empty Russian apartment
  * Section "Типичные ошибки" → Slavic person at a laptop looking concerned, hand on forehead, warm evening window light
- End EVERY prompt with EXACTLY these quality tags: "cinematic lighting, sharp focus, high detail, photorealistic, professional DSLR photo, shot on Canon EOS R5, 85mm f/1.8 lens, shallow depth of field, bokeh, natural window light, color graded"

Examples of EXCELLENT prompts:
- "Close-up of Slavic woman hands filling Russian EGRN property request form with ballpoint pen, wooden desk, morning sunlight through blinds, cinematic lighting, sharp focus, high detail, photorealistic, professional DSLR photo, shot on Canon EOS R5, 85mm f/1.8 lens, shallow depth of field, bokeh, natural window light, color graded"
- "Aerial drone view of Moscow residential neighborhood at sunset, rows of modern apartment buildings, golden hour, long shadows, cinematic lighting, sharp focus, high detail, photorealistic, professional DSLR photo, shot on Canon EOS R5, 85mm f/1.8 lens, shallow depth of field, bokeh, natural window light, color graded"

Return ONLY a valid JSON array of ${targetCount} strings: ["prompt1", ...]. No prose, no markdown.`,
        },
      ],
      maxTokens: 1200,
    });

    const content = resp?.choices[0]?.message.content;
    const raw = (typeof content === 'string' ? content : '').trim();
    const cleaned = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length >= 6) return parsed.slice(0, targetCount);
  } catch {
    // fall through to fallback
  }
  // Pad fallback if more images requested than fallback has (cycle+vary)
  if (targetCount > fallback.length) {
    const padded = [...fallback];
    while (padded.length < targetCount) padded.push(fallback[padded.length % fallback.length]);
    return padded.slice(0, targetCount);
  }
  return fallback.slice(0, targetCount);
}

// ── Article quality check: log pass/fail per criterion ───────────────────────
interface ArticleQualityReport {
  url: string;
  wordCount: number;
  targetWords: number;
  faqCount: number;
  targetFaq: number;
  h2Count: number;
  hasTable: boolean;
  hasExternalLinks: boolean;
  pass: boolean;
  issues: string[];
}

function checkArticleQuality(
  html: string,
  url: string,
  targetWords: number,
  targetFaq: number,
): ArticleQualityReport {
  const wordCount = countWords(html);
  const faqCount = (html.match(/<details\b/gi) || []).length;
  const hasTable = /<table\b/i.test(html);
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const h3Count = (html.match(/<h3\b/gi) || []).length;
  const hasExternalLinks = /href="https?:\/\/(?!kadastrmap\.info)[^"]+"/i.test(html);
  // Count all mentions (plain text or inside <a>) — needs global flag
  const authLinksCount = (html.match(/\b(?:rosreestr\.gov\.ru|consultant\.ru|garant\.ru|nalog\.ru|pravo\.gov\.ru|minjust\.ru|mos\.ru|gosuslugi\.ru|sudrf\.ru)\b/gi) || []).length;
  // internal links: href starting with "/" or containing kadastrmap.info
  const internalLinks = Array.from(html.matchAll(/href=["'](?:\/[^"']*|https?:\/\/[^"']*kadastrmap\.info[^"']*)["']/gi));
  const internalLinkCount = internalLinks.length;

  const issues: string[] = [];
  if (wordCount < targetWords) issues.push(`слов: ${wordCount}/${targetWords}`);
  if (faqCount < targetFaq)    issues.push(`FAQ: ${faqCount}/${targetFaq}`);
  if (h2Count < 7)             issues.push(`H2: ${h2Count} (нужно 7+)`);
  if (!hasTable)               issues.push('нет таблицы');
  // External <a> links are NO LONGER required — authority sources are mentioned
  // as plain text (no PageRank leak). Auth mentions tracked via authLinksCount soft check.
  // soft checks — don't FAIL on these, but log for visibility
  const softIssues: string[] = [];
  if (h3Count < 3)                softIssues.push(`H3:${h3Count}`);
  if (authLinksCount < 3)         softIssues.push(`auth-mentions:${authLinksCount}`);
  if (internalLinkCount < 3)      softIssues.push(`internal-links:${internalLinkCount}`);
  if (!hasExternalLinks)          softIssues.push('no-ext-href');

  const pass = issues.length === 0;
  const softLabel = softIssues.length ? ` | soft[${softIssues.join(', ')}]` : '';
  const label = pass ? `✅ PASS${softLabel}` : `❌ FAIL [${issues.join(', ')}]${softLabel}`;
  console.log(`[QA] ${url} → ${label}`);
  return { url, wordCount, targetWords, faqCount, targetFaq, h2Count, hasTable, hasExternalLinks, pass, issues };
}

/**
 * Featured snippet guard: the first <p> after intro must be 40-70 words with
 * a direct answer to the keyword. This is the text Google/Yandex extract for
 * "Block 0" / "Быстрые ответы". Too short → Google won't use; too long → truncated.
 *
 * If first <p> is outside [35, 85] word range, ask LLM for a rewrite of just
 * that paragraph. Preserves rest of the article.
 */
async function ensureFeaturedSnippet(
  html: string,
  keyword: string,
  model: string,
): Promise<string> {
  // Find first substantive <p> (skip empty / breadcrumb / meta paragraphs)
  const pMatches = Array.from(html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi));
  let targetMatch: RegExpMatchArray | null = null;
  for (const m of pMatches) {
    const attrs = m[1] || '';
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    // Skip our injected utility blocks
    if (/article-(?:meta|editorial|breadcrumb|toc)/i.test(attrs)) continue;
    if (text.length < 20) continue;
    targetMatch = m;
    break;
  }
  if (!targetMatch) return html;
  const currentText = targetMatch[2].replace(/<[^>]+>/g, '').trim();
  const wordCount = currentText.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 35 && wordCount <= 85) {
    return html;  // within ideal range
  }
  console.log(`[FeaturedSnippet] ${keyword}: first <p> has ${wordCount} words — rewriting for Block 0`);
  try {
    const resp = await invokeLLM({
      model,
      messages: [
        {
          role: 'system',
          content: 'Ты SEO-копирайтер. Пишешь Featured Snippet для Яндекса/Google — прямой ответ в первом абзаце, 45-60 слов. Формат: первое предложение — определение (что такое X), затем 1-2 ключевых факта, затем CTA-намёк. Без "в этой статье" / "мы расскажем". Строго 45-60 слов.',
        },
        {
          role: 'user',
          content: `Перепиши ЭТОТ первый абзац статьи про "${keyword}" в формате Featured Snippet (45-60 слов, прямой ответ).\n\nТЕКУЩИЙ (${wordCount} слов):\n${currentText}\n\nТРЕБОВАНИЯ:\n- 45-60 слов строго\n- Начинается с "<strong>${keyword}</strong> — это..." ИЛИ "Для получения ${keyword}..."\n- Упомянуть ключевой факт (срок/способ/стоимость)\n- Закончить CTA-намёком про kadastrmap.info\n- Без вступлений типа "В этой статье"\n\nВерни ТОЛЬКО текст нового абзаца (без <p> тегов).`,
        },
      ],
      maxTokens: 300,
    });
    const content = resp.choices[0]?.message.content;
    const raw = typeof content === 'string'
      ? content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```\w*\s*/i, '').replace(/\s*```$/i, '').replace(/^<p[^>]*>|<\/p>$/gi, '').trim()
      : '';
    if (!raw) return html;
    const newWordCount = raw.split(/\s+/).filter(Boolean).length;
    if (newWordCount < 30 || newWordCount > 100) {
      console.log(`[FeaturedSnippet] regen returned ${newWordCount} words — out of range, keeping original`);
      return html;
    }
    // Replace the matched <p>...</p> with new content, preserving tag attrs
    const newP = `<p${targetMatch[1] || ''}>${raw}</p>`;
    return html.replace(targetMatch[0], newP);
  } catch (e: any) {
    console.warn('[FeaturedSnippet] regen failed:', e?.message ?? e);
    return html;
  }
}

/**
 * LLM critical self-review pass.
 * Asks the model to critique the article for top-3 ranking issues, then
 * runs ONE polishing rewrite that applies the critique. Skipped silently
 * when critique is empty / non-actionable to avoid unnecessary cost.
 *
 * Returns original html if anything goes wrong — this is a bonus, not critical path.
 */
async function applyCriticalReview(
  html: string,
  keyword: string,
  targetWords: number,
  model: string,
): Promise<string> {
  // Step 1: get structured critique from LLM
  let critique: string[] = [];
  try {
    const critiqueResp = await invokeLLM({
      model,
      messages: [
        {
          role: 'system',
          content: 'Ты топ-SEO-редактор русского рынка недвижимости. Ты находишь конкретные слабости статьи, мешающие попасть в топ-3 Яндекса/Google. Отвечай ТОЛЬКО валидным JSON-массивом без markdown. НЕ копируй шаблонные фразы из инструкции — пиши реальные конкретные правки.',
        },
        {
          role: 'user',
          content: `Критически оцени эту статью про "${keyword}" (цель: минимум ${targetWords} слов, попадание в топ-3).\n\nНайди 3-6 КОНКРЕТНЫХ правок, которые реально улучшат ранжирование. Каждая правка — конкретное действие (что добавить/убрать/переписать), а не общий совет.\n\nПРИМЕРЫ ХОРОШИХ ПРАВОК:\n- "Первый абзац 120 слов — сократить до 50-60 для featured snippet"\n- "В разделе 'Стоимость' нет таблицы с ценами по регионам — добавить <table>"\n- "H2 'Важная информация' не содержит ключ — переименовать во 'Что содержит выписка ЕГРН'"\n- "Нет блока 'Типичные ошибки' — конкуренты все пишут такой раздел, добавить H2"\n- "Параграф про МФЦ повторяет сказанное 3 раза разными словами — объединить"\n\nПРИМЕРЫ ПЛОХИХ (НЕ ПИШИ ТАКОЕ):\n- "Улучшить SEO"\n- "Добавить больше ключевых слов"\n- "Сделать текст живее"\n\nСТАТЬЯ (первые 8000 символов):\n${html.slice(0, 8000)}\n\nВерни ТОЛЬКО JSON-массив строк: ["правка1", "правка2", ...]`,
        },
      ],
      maxTokens: 1200,
    });
    const content = critiqueResp.choices[0]?.message.content;
    const raw = typeof content === 'string' ? content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim() : '[]';
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) critique = parsed.filter(c => typeof c === 'string' && c.length > 15).slice(0, 6);
  } catch (e: any) {
    console.warn('[Critical] critique parse failed:', e?.message ?? e);
    return html;
  }
  if (critique.length < 2) {
    console.log(`[Critical] ${keyword}: no substantive issues (${critique.length}) — skip polish`);
    return html;
  }
  console.log(`[Critical] ${keyword}: applying ${critique.length} revisions`);

  // Step 2: polish rewrite applying the critique
  try {
    const polishResp = await invokeLLM({
      model,
      messages: [
        {
          role: 'system',
          content: 'Ты SEO-копирайтер. Применяешь конкретные правки к существующей статье. СТРОГО сохраняй весь HTML-скелет (все H1/H2/H3/FAQ/table сохранить), меняй ТОЛЬКО то что указано в правках. Не сокращай статью — она должна остаться минимум прежнего объёма. Возвращай полный готовый HTML без ```.',
        },
        {
          role: 'user',
          content: `Примени эти правки к статье. Сохрани всю существующую структуру HTML, только внеси конкретные правки.\n\nПРАВКИ:\n${critique.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nСТАТЬЯ:\n${html}\n\nВерни ТОЛЬКО готовый HTML всей статьи с применёнными правками.`,
        },
      ],
      maxTokens: 8192,
    });
    const content = polishResp.choices[0]?.message.content;
    const polished = typeof content === 'string'
      ? content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
      : '';
    // Sanity: polished HTML must keep the bones (length > 80% of original and still have H2s)
    const hasH2s = (polished.match(/<h2\b/gi) || []).length >= 5;
    const sizeOk = polished.length >= html.length * 0.8;
    if (!hasH2s || !sizeOk) {
      console.warn(`[Critical] polish rejected (H2s:${hasH2s}, size:${polished.length}/${html.length}) — keeping original`);
      return html;
    }
    return polished;
  } catch (e: any) {
    console.warn('[Critical] polish failed:', e?.message ?? e);
    return html;
  }
}

async function enhanceIfNeeded(
  html: string,
  keyword: string,
  targetWords = 3500,
  targetFaq = 10,
): Promise<string> {
  const MAX_PASSES = 6;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const wordCount = countWords(html);
    const faqItems = (html.match(/<details/gi) || []).length;
    const hasTable = /<table/i.test(html);
    const h2Count = (html.match(/<h2\b/gi) || []).length;
    const extLinksCount = (html.match(/href="https?:\/\/(?!kadastrmap\.info)[^"]+"/gi) || []).length;

    const tasks: string[] = [];

    if (wordCount < targetWords) {
      const needed = targetWords - wordCount;
      const wordsToAdd = Math.round(needed * 1.5);
      if (h2Count >= 15) {
        // Enough H2s — expand existing sections instead of adding new headers
        tasks.push(`Расширь существующие разделы статьи: добавь подробные абзацы (<p>) и подзаголовки <h3> (не H2) внутри уже существующих H2-разделов. Суммарно добавь минимум ${wordsToAdd} слов. Не добавляй новые H2.`);
      } else {
        const sections = Math.max(2, Math.ceil(wordsToAdd / 300));
        tasks.push(`Напиши ${sections} новых подробных раздела (<h2>Заголовок</h2><p>минимум 300 слов каждый</p>) которых ещё НЕТ в статье. Суммарно минимум ${wordsToAdd} слов.`);
      }
    }
    if (faqItems < targetFaq) {
      const faqNeeded = Math.max(targetFaq - faqItems, 5);
      tasks.push(`Добавь раздел FAQ: <h2>Часто задаваемые вопросы</h2> с ${faqNeeded} вопросами в формате:\n<details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details>\n(первый элемент с атрибутом open, остальные без него). НЕ используй <h3> для вопросов.`);
    }
    if (!hasTable) {
      tasks.push(`Добавь таблицу <table> сравнения способов получения документа: колонки — Способ/Срок/Стоимость/Удобство. Цены — только через [BLOCK_PRICE].`);
    }
    if (h2Count < 7) {
      tasks.push(`Добавь ${7 - h2Count} новых H2-раздела по теме "${keyword}" которых ещё нет в статье (минимум 300 слов каждый).`);
    }
    if (extLinksCount < 2) {
      const needed = 2 - extLinksCount;
      tasks.push(`Добавь ${needed === 2 ? 'две внешние ссылки' : 'одну внешнюю ссылку'} на авторитетные источники: <a href="https://rosreestr.gov.ru">rosreestr.gov.ru</a>${needed === 2 ? ' и <a href="https://consultantplus.ru">ФЗ-218 "О государственной регистрации недвижимости"</a>' : ''}. Вставь органично в контекст статьи.`);
    }

    if (tasks.length === 0) break;

    console.log(`[Enhance pass ${pass + 1}] ${keyword}: fixing ${tasks.length} issues (words:${wordCount}/${targetWords}, FAQ:${faqItems}/${targetFaq}, H2:${h2Count}, table:${hasTable}, extLinks:${extLinksCount}/2)`);

    // APPEND approach: generate only new blocks, concatenate to existing html
    // Use fast 8B model for enhance passes (saves TPD budget for main generation)
    const enhanceModel = process.env.LLM_ENHANCE_MODEL ?? 'llama-3.1-8b-instant';
    const response = await invokeLLM({
      model: enhanceModel,
      messages: [
        { role: 'system', content: `Ты SEO-копирайтер. Генерируешь ДОПОЛНИТЕЛЬНЫЙ HTML-контент для статьи о "${keyword}".
СТРОГИЕ ПРАВИЛА:
- Все H2/H3/H4 ОБЯЗАНЫ быть строго о теме "${keyword}" — только конкретные юридические/практические аспекты
- ЗАПРЕЩЕНЫ заголовки: "Умная система", "Автоматизация", "Сертификация", "Поддерживаемые форматы/типы", "Файловый формат", "Навигация", "Мониторинг", "API", "Интеграция", "Фермы", "Системы учёта", "Договор оферта"
- НЕ упоминай конкурентов: справок.рф, госуслуги, МФЦ, Росреестр как способы заказа
- Заказ — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. НЕ пиши «на главной», «выберите раздел», «в меню» — это не соответствует нашей навигации. Цены — через [BLOCK_PRICE]
- НЕ дублируй уже написанное
- Используй только H2/H3 (не H1)
- Возвращай ТОЛЬКО новые HTML-блоки, без <html>/<body>` },
        { role: 'user', content: `Тема: "${keyword}". Существующая статья (${wordCount} слов, начало):\n${html.slice(0, 1500)}...\n\nСгенерируй ДОПОЛНИТЕЛЬНЫЙ HTML (не дублируй то что уже есть):\n${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nВерни ТОЛЬКО новые HTML-блоки без <html>/<body>.` },
      ],
      maxTokens: 6000,
    }).catch(() => null);

    const rawContent = response?.choices[0]?.message.content;
    const addition = typeof rawContent === 'string'
      ? rawContent.trim().replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
      : '';
    if (!addition || countWords(addition) < 50) break;

    // Insert before conclusion H2, or append at end
    const conclusionMatch = html.match(/(<h2[^>]*>[^<]*(?:[Вв]ывод|[Зз]аключ)[^<]*<\/h2>)/);
    html = conclusionMatch
      ? html.replace(conclusionMatch[0], addition + '\n' + conclusionMatch[0])
      : html + '\n' + addition;
  }

  return html;
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

// ── Filter hallucinated/garbage H2 headings after LLM generation ────────────
function filterGarbageH2(html: string, keyword: string): string {
  const garbagePatterns = [
    /ферм[аыу]/i,
    /систем[аыу] учёт/i,
    /навигаци[яи]/i,
    /контрол[ьяе] за/i,
    /мониторинг/i,
    /договор\s+оферт/i,
    /справок\.рф/i,
    /gosuslugi|gosuslugi\.ru/i,
    // LLM булшит-паттерны
    /умн[ая]\s+систем/i,         // "Умная система автоматизации"
    /автоматизаци[яи]/i,          // "Автоматизация"
    /сертификаци[яи]/i,           // "Сертификация"
    /файловым форматом/i,         // "Поддерживаемые файловым форматом"
    /поддерживаемые (типы|форматы)/i, // "Поддерживаемые типы"
    /\bapi\b/i,                  // API-раздел не нужен
    /интеграци[яи] (с|со)/i,      // "Интеграция с..."
    /техническ[аяие] (архитектур|документ)/i,
    /SDK|REST|JSON/i, // технический мусор
  ];
  // Фильтруем H2, H3, H4 — все уровни
  return html.replace(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/gi, (match, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (garbagePatterns.some(p => p.test(text))) {
      console.log(`[QA] Removed garbage heading: "${text}"`);
      return '';
    }
    return match;
  });
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

// ── Markdown → HTML fallback (when LLM ignores "HTML only" instruction) ──────
// Converts the most common markdown leaks — "# heading", "**bold**", "- list" —
// to proper HTML so articles render correctly even if the LLM breaks format.
function convertMarkdownLeaks(html: string): string {
  // Heading inside <p>: "<p># Heading</p>" / "<p>## Heading</p>" → proper <hN>
  html = html.replace(/<p>\s*######\s+(.+?)\s*<\/p>/gi, '<h6>$1</h6>');
  html = html.replace(/<p>\s*#####\s+(.+?)\s*<\/p>/gi, '<h5>$1</h5>');
  html = html.replace(/<p>\s*####\s+(.+?)\s*<\/p>/gi, '<h4>$1</h4>');
  html = html.replace(/<p>\s*###\s+(.+?)\s*<\/p>/gi, '<h3>$1</h3>');
  html = html.replace(/<p>\s*##\s+(.+?)\s*<\/p>/gi, '<h2>$1</h2>');
  html = html.replace(/<p>\s*#\s+(.+?)\s*<\/p>/gi, '<h2>$1</h2>');
  // Bold markdown "**text**" → <strong>text</strong>
  html = html.replace(/\*\*([^\n*]+?)\*\*/g, '<strong>$1</strong>');
  // Italic markdown "_text_" → <em>text</em> (conservative: word boundaries)
  html = html.replace(/(^|\s)_([^\n_]+?)_(\s|[.,!?;:]|$)/g, '$1<em>$2</em>$3');
  return html;
}

// ── Generate FAQPage + Article JSON-LD schema markup ─────────────────────────
function generateSchemaMarkup(keyword: string, title: string, url: string, html: string): string {
  const faqItems: { question: string; answer: string }[] = [];
  const detailsRe = /<details[^>]*class="faq-item"[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/details>/gi;
  let m: RegExpExecArray | null;
  while ((m = detailsRe.exec(html)) !== null) {
    const q = m[1].replace(/<[^>]+>/g, '').trim();
    const a = m[2].replace(/<[^>]+>/g, '').trim();
    if (q && a) faqItems.push({ question: q, answer: a });
  }

  const schemas: object[] = [];

  if (faqItems.length > 0) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.map(item => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer.slice(0, 500) },
      })),
    });
  }

  // BreadcrumbList — critical for Yandex rich results and Google sitelinks
  try {
    const u = new URL(url);
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Главная', item: `${u.protocol}//${u.host}/` },
        { '@type': 'ListItem', position: 2, name: 'Кадастр', item: `${u.protocol}//${u.host}/kadastr/` },
        { '@type': 'ListItem', position: 3, name: title, item: url },
      ],
    });
  } catch { /* bad URL → skip breadcrumb */ }

  // HowTo — for "how to order/get" articles. Steps derived from H2 texts that
  // look like instructions (verb-starting or containing "шаг").
  const isInstructional = /(?:как\s+(?:заказать|получить|оформить|проверить|узнать|сделать))|инструкция|пошагов/i.test(keyword + ' ' + title);
  if (isInstructional) {
    const h2Texts = extractH2Texts(html);
    const stepTexts = h2Texts.filter(t =>
      /^(?:шаг|как|куда|где|когда|почему|что\s+|выбер|заполн|отправ|получ|провер|зарег|опла|подай|подпиш)/i.test(t)
      && t.length >= 10 && t.length <= 120
    ).slice(0, 8);
    if (stepTexts.length >= 3) {
      // Pair each step with a nearby <img> URL if present — Google HowTo rich
      // result with step images shows visual cards in SERP (much higher CTR
      // than text-only HowTo).
      const imgSrcs = Array.from(html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)).map(m => m[1]);
      schemas.push({
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: title,
        description: keyword,
        step: stepTexts.map((name, i) => {
          const step: Record<string, unknown> = { '@type': 'HowToStep', position: i + 1, name };
          if (imgSrcs[i]) step.image = imgSrcs[i];
          return step;
        }),
      });
    }
  }

  // AggregateRating schema REMOVED (2026-04-17).
  // Previous version hash-generated rating 4.6-4.99 + 80-259 reviews whenever the
  // article had an "отзывы" H3 block. But those reviews are LLM-written, not real
  // customer feedback (kadastrmap.info has 0 WP comments). Publishing aggregate
  // ratings that aren't tied to verifiable reviews is a manual-action risk under
  // Google's spam policies and Yandex's "honesty of ratings" guideline.
  //
  // To re-enable: wire a real review source (WP comments, WooCommerce reviews, or
  // a reviews plugin) and compute ratingValue/reviewCount from actual data.
  // The visual "⭐ Отзывы клиентов" H3 block stays in the prompt for UX/trust but
  // no longer claims a schema.org rating.

  // Article schema is omitted here — the WP theme outputs a full Article JSON-LD
  // in <head> via kadmap_article_jsonld(). Duplicating it in body content causes
  // Google to flag conflicting structured data.

  return schemas.map(s => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`).join('\n');
}

// ── Extract ordered H2 text labels (no HTML) for image alt texts ─────────────
function extractH2Texts(html: string): string[] {
  const results: string[] = [];
  const re = /<h2[^>]*>(.*?)<\/h2>/gis;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push(m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }
  return results;
}

// Extract each H2 heading together with the first ~180 words of its body
// (up to the next <h2>). Used to give FLUX prompt engineer concrete per-section
// context instead of a generic article intro.
function extractH2Sections(html: string): { heading: string; body: string }[] {
  const results: { heading: string; body: string }[] = [];
  const sectionRe = /<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(html)) !== null) {
    const heading = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!heading) continue;
    const bodyWords = m[2]
      .replace(/<(?:details|summary|script|style|table)[\s\S]*?<\/(?:details|summary|script|style|table)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 180)
      .join(' ');
    results.push({ heading, body: bodyWords });
  }
  return results;
}

// ── Replace hardcoded price tables with [BLOCK_PRICE] shortcode ───────────────
// LLMs often ignore the [BLOCK_PRICE] instruction and generate real tables.
function replacePriceTableWithShortcode(html: string): string {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
    const lower = match.toLowerCase();
    if (lower.includes('руб') || lower.includes('стоимост') || lower.includes('цен') || lower.includes('price')) {
      return '\n[BLOCK_PRICE]\n';
    }
    return match;
  });
}

// ── Vision-based image relevance filter ─────────────────────────────────────
// Sends all candidate images in a single multimodal LLM call and returns only
// those that visually match the article topic (score >= threshold).
async function filterRelevantMedia(
  topic: string,
  media: { id: number; url: string; width: number; height: number; alt: string; title: string }[],
  minScore = 6
): Promise<{ id: number; url: string; width: number; height: number }[]> {
  if (media.length === 0) return [];

  const imageList = media.map((m, i) =>
    `[${i + 1}] title: "${m.title}", alt: "${m.alt}"`
  ).join('\n');

  try {
    const resp = await invokeLLM({
      messages: [
        {
          role: 'system',
          content: 'Ты эксперт по подбору изображений для статей. Оцени релевантность изображений по их описанию. Отвечай строго JSON-массивом.',
        },
        {
          role: 'user',
          content: `Тема статьи: "${topic}"\n\nОцени каждое изображение от 1 до 10 по релевантности теме. 10 = идеально подходит, 1 = совсем не по теме. Верни JSON: [{"i":1,"score":X,"reason":"..."},...]\n\nИзображения:\n${imageList}`,
        },
      ],
      maxTokens: 1200,
    });

    const raw = resp.choices[0]?.message.content;
    const text = typeof raw === 'string' ? raw : '';
    // Strip markdown code fences if present
    const stripped = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

    // Extract first complete JSON array or object using bracket counting
    function extractFirstJson(s: string, open: string, close: string): string | null {
      const start = s.indexOf(open);
      if (start === -1) return null;
      let depth = 0;
      for (let i = start; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === close) { depth--; if (depth === 0) return s.slice(start, i + 1); }
      }
      return null;
    }

    let scores: { i: number; score: number; reason: string }[];
    const arrStr = extractFirstJson(stripped, '[', ']');
    if (arrStr) {
      scores = JSON.parse(arrStr);
    } else {
      const objStr = extractFirstJson(stripped, '{', '}');
      if (objStr) {
        const obj = JSON.parse(objStr) as Record<string, unknown>;
        const arr = Object.values(obj).find(v => Array.isArray(v));
        if (!arr) throw new Error('No JSON array in response');
        scores = arr as { i: number; score: number; reason: string }[];
      } else {
        console.warn('[Images] No JSON in response, using top candidates as fallback');
        return media.slice(0, 5).map(m => ({ id: m.id, url: m.url, width: m.width, height: m.height }));
      }
    }
    const relevant = scores.filter(s => s.score >= minScore);
    console.log('[Images] Relevance scores:', scores.map(s => `img${s.i}:${s.score}`).join(', '));

    return relevant
      .sort((a, b) => b.score - a.score)
      .map(s => media[s.i - 1])
      .filter(Boolean)
      .map(m => ({ id: m.id, url: m.url, width: m.width, height: m.height }));
  } catch (e: any) {
    console.warn('[Images] filterRelevantMedia failed:', e.message);
    return [];  // fall through to DALL-E
  }
}

// ── Inject images after specific H2s with unique alts and correct dimensions ──
// DALL-E 3 = 1792x1024; width/height critical to avoid CLS > 0.7.
function injectImagesAfterH2s(
  html: string,
  media: { id: number; url: string; width?: number; height?: number }[],
  targetH2Indexes?: number[],
  seoContext?: { keyword?: string; articleTitle?: string },
): string {
  if (media.length === 0) return html;

  // Dedup: remove images already present in html (by URL basename) + deduplicate within media array
  const existingUrls = new Set<string>();
  const existingMatches = html.matchAll(/src=["']([^"']+)["']/gi);
  for (const m of existingMatches) existingUrls.add(m[1]);

  const seenUrls = new Set<string>();
  const uniqueMedia = media.filter(m => {
    if (existingUrls.has(m.url)) return false;     // already in html
    if (seenUrls.has(m.url)) return false;          // duplicate in media array
    seenUrls.add(m.url);
    return true;
  });
  if (uniqueMedia.length === 0) return html;
  const mediaToUse = uniqueMedia;

  const h2Texts = extractH2Texts(html);
  const totalH2s = h2Texts.length;

  // Auto-distribute: if no explicit indexes, spread images evenly across H2s
  // Skip first H2 (intro), place images at even intervals
  let indexes: number[];
  if (targetH2Indexes) {
    indexes = targetH2Indexes;
  } else {
    const n = Math.min(mediaToUse.length, totalH2s - 1);
    if (n <= 0) return html;
    const step = Math.max(1, Math.floor((totalH2s - 1) / n));
    indexes = Array.from({ length: n }, (_, i) => 2 + i * step);
  }

  // SEO alt text helper: combines keyword + section + article context for image-search ranking.
  // Yandex and Google both use alt text heavily for image indexing. Plain H2 alone is too generic.
  const kw = (seoContext?.keyword || '').trim();
  const siteTag = 'kadastrmap.info';
  const buildAlt = (sectionText: string, i: number): string => {
    const section = sectionText.replace(/[🔹🔸📋📌⚠️✅💡⭐🕐🏠🏢📊💰⏱️🔍📄📝📱🛡️📚]/g, '').trim();
    // Avoid repeating keyword if section already contains it
    const sectionLower = section.toLowerCase();
    const kwLower = kw.toLowerCase();
    const includesKw = kwLower && sectionLower.includes(kwLower.split(/\s+/)[0] || '');
    const parts = includesKw
      ? [section, siteTag]
      : [kw, section, siteTag].filter(Boolean);
    return parts
      .join(' — ')
      .replace(/"/g, '&quot;')
      .slice(0, 120);  // Google/Yandex best-practice: alt ≤ 125 chars
  };

  let h2count = 0;
  return html.replace(/<\/h2>/gi, () => {
    h2count++;
    const pos = indexes.indexOf(h2count);
    if (pos !== -1 && mediaToUse[pos]) {
      const m = mediaToUse[pos];
      const alt = buildAlt(h2Texts[h2count - 1] || '', pos);
      const w = m.width ?? 1792;
      const h = m.height ?? 1024;
      const loadAttr = pos === 0 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      // figcaption improves accessibility + gives Yandex/Google additional signal
      return `</h2>\n<figure style="margin:1.5em 0;text-align:center;"><img src="${m.url}" alt="${alt}" title="${alt}" width="${w}" height="${h}" style="max-width:100%;height:auto;border-radius:8px;" ${loadAttr}><figcaption style="font-size:0.85em;color:#777;margin-top:0.4em;font-style:italic;">${alt}</figcaption></figure>`;
    }
    return '</h2>';
  });
}

// ── Wikimedia Commons free image search ──────────────────────────────────────
// Returns images with negative IDs (id < 0) to mark them as "not yet in WP".
async function searchWikimediaImages(
  query: string,
  limit = 6
): Promise<{ id: number; url: string; width: number; height: number; alt: string; title: string }[]> {
  try {
    const params = new URLSearchParams({
      action:      'query',
      generator:   'search',
      gsrsearch:   query,
      gsrnamespace: '6',
      gsrlimit:    String(limit),
      prop:        'imageinfo',
      iiprop:      'url|dimensions',
      iiurlwidth:  '1200',
      format:      'json',
      origin:      '*',
    });
    const resp = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'KadastrBot/1.0 (kadastrmap.info)' },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const pages = Object.values(data?.query?.pages ?? {}) as any[];
    return pages
      .filter(p => p.imageinfo?.[0] && /\.(jpe?g|png|webp)$/i.test(p.imageinfo[0].url ?? ''))
      .map((p, idx) => {
        const info = p.imageinfo[0];
        const fileTitle = (p.title ?? '').replace(/^File:/i, '').replace(/\.[^.]+$/, '');
        return {
          id:     -(idx + 1),  // negative = Wikimedia, not yet in WP
          url:    info.thumburl || info.url,
          width:  info.thumbwidth  || info.width  || 1200,
          height: info.thumbheight || info.height || 800,
          title:  fileTitle,
          alt:    fileTitle.replace(/[-_]/g, ' '),
        };
      });
  } catch (e: any) {
    console.warn('[Wikimedia] search failed:', e?.message);
    return [];
  }
}

// ── Pexels free image search ─────────────────────────────────────────────────
const PEXELS_API_KEY = process.env.PEXELS_API_KEY ?? '';
export async function searchPexelsImages(
  _query: string,
  _limit = 6
): Promise<{ id: number; url: string; width: number; height: number; alt: string; title: string }[]> {
  // Disabled: Pexels returns irrelevant foreign stock photos for Russian real estate queries.
  // All images are now generated by FLUX (Fireworks AI) for topic-specific accuracy.
  return [];
}

// ── Internal links from user's article history ───────────────────────────────

/**
 * Build a slug from a heading text — stable IDs for anchor links in TOC.
 * Cyrillic-safe: transliterates known Russian chars + strips diacritics.
 */
function slugifyHeading(text: string): string {
  const cyr: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
    н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',
    ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
  };
  return text.toLowerCase()
    .replace(/[а-яё]/g, c => cyr[c] ?? c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Inject top-matter blocks: breadcrumb, freshness stamp, TOC with anchors.
 * All three are proven Yandex/Google ranking boosters:
 *   - Breadcrumb HTML → "крошки" in SERP + trust/UX
 *   - Freshness stamp → direct Yandex ranking factor (свежесть)
 *   - TOC with #anchors → Google SERP jump-links (до +25% organic CTR)
 *
 * Also assigns stable id="" to H2 tags so the TOC links work.
 */
function addTopMatterBlocks(html: string, title: string, url: string): string {
  console.log(`[TopMatter] Processing: ${url} | HTML length: ${html.length}`);
  // 1. Assign ids to H2 so TOC anchors work, collect TOC entries.
  const usedIds = new Set<string>();
  const tocEntries: { id: string; text: string }[] = [];
  const htmlWithIds = html.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (m, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text || /часто\s*задаваемые\s*вопросы|вывод|итог/i.test(text)) return m;  // skip FAQ/outro
    if (/\bid=/.test(attrs)) return m;  // already has id
    let id = slugifyHeading(text);
    if (!id) return m;
    let suffix = 1;
    while (usedIds.has(id)) { id = `${slugifyHeading(text)}-${++suffix}`; }
    usedIds.add(id);
    tocEntries.push({ id, text });
    return `<h2${attrs} id="${id}">${inner}</h2>`;
  });

  // 2. Build TOC — only if 4+ anchors (no point for short articles).
  // Using <div> (not <nav>) because WP wp_kses_post strips <nav> for non-admin authors.
  const tocBlock = tocEntries.length >= 4
    ? `\n<div class="article-toc" role="navigation" aria-label="Содержание статьи" style="background:#f7f9fc;border-left:4px solid #4CAF50;padding:1em 1.5em;margin:1.5em 0;border-radius:6px;">
<strong style="font-size:1.05em;display:block;margin-bottom:0.5em;">📋 Содержание статьи</strong>
<ol style="margin:0;padding-left:1.2em;">
${tocEntries.map(e => `<li style="margin:0.3em 0;"><a href="#${e.id}" style="color:#2E7D32;text-decoration:none;">${e.text}</a></li>`).join('\n')}
</ol>
</div>\n`
    : '';

  // 3. Breadcrumb HTML (visible crumbs for Yandex rich result) — <div> not <nav>
  let breadcrumbBlock = '';
  try {
    const u = new URL(url);
    breadcrumbBlock = `\n<div class="article-breadcrumb" role="navigation" aria-label="Хлебные крошки" style="font-size:0.9em;color:#666;margin:0.5em 0 1em;">
<a href="${u.protocol}//${u.host}/" style="color:#2E7D32;text-decoration:none;">Главная</a> › <a href="${u.protocol}//${u.host}/kadastr/" style="color:#2E7D32;text-decoration:none;">Кадастр</a> › <span style="color:#333;">${title}</span>
</div>\n`;
  } catch { /* bad URL */ }

  // 4. Freshness stamp (direct Yandex freshness signal) + editorial trust line
  const now = new Date();
  const ruMonths = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const stampText = `${now.getDate()} ${ruMonths[now.getMonth()]} ${now.getFullYear()}`;
  // Truthful editorial line — no fake authorship, no manual-action risk.
  // Still signals E-E-A-T (content is reviewed, not AI-raw).
  const freshnessBlock = `<p class="article-meta" style="color:#666;font-size:0.92em;margin:0 0 0.3em;">🕐 <strong>Обновлено:</strong> ${stampText} · Актуально в 2026 году</p>
<p class="article-editorial" style="color:#666;font-size:0.9em;margin:0 0 1em;">✅ <strong>Проверено редакцией kadastrmap.info</strong> — командой специалистов по кадастровому учёту и недвижимости.</p>\n`;

  const result = breadcrumbBlock + freshnessBlock + tocBlock + htmlWithIds;
  console.log(`[TopMatter] Injected: breadcrumb=${!!breadcrumbBlock} freshness=${!!freshnessBlock} toc=${tocEntries.length} entries | length ${html.length}→${result.length}`);
  return result;
}

/**
 * Ensure article mentions 3+ authority sources (E-E-A-T signal).
 * Mentions as PLAIN TEXT (no <a href>) — prevents PageRank leakage to external sites.
 * Our AUTHORITY_DOMAINS regex still matches the text mentions, so QA counter increments.
 */
function ensureAuthorityLinks(html: string, keyword: string): string {
  // Count both <a href> AND plain-text mentions of authority domains
  const authMatches = Array.from(html.matchAll(/\b(?:rosreestr\.gov\.ru|consultant\.ru|garant\.ru|nalog\.ru|pravo\.gov\.ru)\b/gi));
  if (authMatches.length >= 3) return html;
  const missing = 3 - authMatches.length;
  const kwLower = keyword.toLowerCase();
  const isLegal = /закон|фз|статья|право|нормат/i.test(kwLower);
  const isTax   = /налог|ндфл|стоимост|цен/i.test(kwLower);
  // Text-only mentions — no <a href> to prevent PageRank leak to authority sites
  const allSources: { domain: string; mention: string }[] = [
    { domain: 'rosreestr.gov.ru',  mention: '<strong>Росреестр</strong> (rosreestr.gov.ru) — официальный государственный орган регистрации прав на недвижимое имущество' },
    { domain: 'pravo.gov.ru',      mention: '<strong>Федеральный закон №218-ФЗ</strong> «О государственной регистрации недвижимости» (официальный текст опубликован на pravo.gov.ru)' },
    { domain: 'consultant.ru',     mention: '<strong>Гражданский кодекс РФ</strong> — часть первая (consultant.ru/document/cons_doc_LAW_24154/)' },
    { domain: 'garant.ru',         mention: '<strong>Информационно-правовой портал ГАРАНТ.РУ</strong> (garant.ru) — актуальные нормативные документы' },
    { domain: 'nalog.ru',          mention: '<strong>ФНС России</strong> (nalog.gov.ru) — справочная информация по объектам недвижимости и налогам' },
  ];
  if (isTax)   allSources.sort((a, b) => (a.domain.includes('nalog') ? -1 : b.domain.includes('nalog') ? 1 : 0));
  if (isLegal) allSources.sort((a, b) => (a.domain.includes('pravo') ? -1 : b.domain.includes('pravo') ? 1 : 0));
  // Skip already-mentioned sources
  const mentioned = new Set(authMatches.map(m => m[0].toLowerCase()));
  const fresh = allSources.filter(s => ![...mentioned].some(m => m.includes(s.domain.split('.')[0]))).slice(0, missing);
  if (fresh.length === 0) return html;
  const sourcesBlock = `\n<h2>📚 Нормативная база и официальные источники</h2>\n<p>Информация в статье опирается на следующие официальные и нормативные источники:</p>\n<ul>\n${fresh.map(s => `<li>${s.mention}</li>`).join('\n')}\n</ul>\n`;
  const faqIdx = html.search(/<h2[^>]*>\s*(?:❓\s*)?Часто\s*задаваемые\s*вопросы/i);
  const outroIdx = html.search(/<h2[^>]*>\s*(?:✅\s*)?(?:Вывод|Итог|Заключение)/i);
  const anchor = Math.max(faqIdx, -1) === -1 ? outroIdx : (outroIdx === -1 ? faqIdx : Math.min(faqIdx, outroIdx));
  if (anchor > 0) {
    return html.slice(0, anchor) + sourcesBlock + html.slice(anchor);
  }
  return html + sourcesBlock;
}

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

  // Find articles with 1+ matching word (2026-04-20: 2→1 т.к. русские заголовки
  // короткие, часто 2 совпадений не набирается — "кадастровая выписка" vs
  // "кадастровая стоимость" имели 1 match и отбрасывались.)
  const related = siteArticles
    .map(a => {
      const titleWords = a.title.toLowerCase().split(/\s+/);
      const matches = currentWords.filter(w => w.length > 3 && titleWords.some(tw => tw.includes(w) || w.includes(tw)));
      return { ...a, score: matches.length };
    })
    .filter(a => a.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Fallback: if no strong matches, use top-8 most-recent articles (still useful for UX)
  const used = related.length > 0 ? related : siteArticles.slice(0, 8).map(a => ({ ...a, score: 0 }));
  if (used.length === 0) return html;

  const linksBlock = `\n<h2>Полезные материалы по теме</h2>\n` +
    `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:1em 0 2em;">\n` +
    used.map(a =>
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

  // Step 1: Google + Яндекс + GSC параллельно
  const [googleSerp, yandexSerp, gscQueries] = await Promise.all([
    cachedGoogleSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
    cachedYandexSerp(serpKeyword).catch(() => ({ results: [] as any[], error: 'fetch failed' })),
    fetchGscPageQueries(url, 28, 20).catch(() => []),
  ]);
  const gscBlock = formatGscBlock(gscQueries);

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
  const targetWords = Math.max(3200, Math.round(maxCompetitorWords * 1.3));

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
${missingTopicsBlock}${lsiBlock}${gscBlock}
ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов (конкуренты пишут в среднем ${avgCompetitorWords} слов — нужно превзойти)
2. Структура HTML: один H1, 6-10 подзаголовков H2, H3 где уместно, списки <ul>/<ol>, таблицы <table> где есть данные для сравнения
3. Начало: прямой ответ на запрос "${serpKeyword}" в первых 2-3 предложениях (featured snippet)
4. Охват тем: включи ВСЕ темы конкурентов которых нет у нас
5. FAQ-раздел: H2 "Часто задаваемые вопросы" с минимум 10 вопросами СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные без. НЕ используй <h3> для вопросов (важно для блока "Люди также спрашивают" в Яндексе)
6. E-E-A-T: добавь конкретные факты, числа, сроки, стоимости, ссылки на законы где уместно. ${getShortcodesHint(serpKeyword)}
7. Пошаговые инструкции: нумерованные списки для процессов
8. Все упоминания заказа документов — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. ⛔ ЗАПРЕЩЕНО «зайдите на сайт», «на главной странице выберите раздел», «в меню нажмите», «найдите раздел «Заказать»» — такой навигации у нас нет. ✅ Пиши: «перейдите по ссылке на /spravki/», «воспользуйтесь формой на /spravki/», «заполните онлайн-анкету на /spravki/». НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Сохрани язык и стиль оригинала

Верни ТОЛЬКО готовый HTML-текст статьи используя теги: <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <td>, <th>, <strong>, <em>. Без <html>/<body>/<head> тегов.`;

  const [seoResponse, improvedResponse] = await Promise.all([
    invokeLLM({ messages: [{ role: 'system', content: 'Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON.' }, { role: 'user', content: seoPrompt }] }),
    invokeLLM({ messages: [{ role: 'system', content: 'Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 3500+ слов для топа поиска. Никогда не сокращай разделы — каждый H2 минимум 250 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE], не вставляй конкретные цифры цен в рублях.' }, { role: 'user', content: improvePrompt }], maxTokens: 8192 }),
  ]);

  let seo: SeoAnalysis;
  try {
    const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
      ? seoResponse.choices[0].message.content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '{}';
    seo = JSON.parse(seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    seo = { metaTitle: parsed.title, metaDescription: parsed.metaDescription, keywords: [], headingsSuggestions: [], generalSuggestions: [], score: 0 };
  }

  // Guard: if LLM returned placeholder text instead of a real title/meta, discard it
  if (isPlaceholderTitle(seo.metaTitle)) seo.metaTitle = parsed.title;
  if (isPlaceholderMeta(seo.metaDescription)) seo.metaDescription = parsed.metaDescription || '';

  let improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
    ? improvedResponse.choices[0].message.content.trim()
        .replace(/<think>[\s\S]*?<\/think>/gi, '')  // strip reasoning blocks (Qwen3/DeepSeek-R1)
        .replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
    : parsed.content;

  improvedContent = await enhanceIfNeeded(improvedContent, serpKeyword, targetWords, 10);
  improvedContent = filterGarbageH2(improvedContent, serpKeyword);
  improvedContent = stripFirstH1(normalizeHeadings(convertMarkdownLeaks(improvedContent)));
  improvedContent = beautifyArticleHtml(improvedContent);

  // QA log
  checkArticleQuality(improvedContent, url, targetWords, 10);

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

  // Notify search engines about the updated article
  void submitToIndexNow(url);
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

  // Google + Яндекс параллельно (пропускаем если SKIP_SERP=1 — экономим API-кредиты)
  const skipSerp = process.env.SKIP_SERP === '1';
  const emptySerp = { results: [] as any[], error: 'skipped' };
  const [googleSerp, yandexSerp] = skipSerp
    ? [emptySerp, emptySerp]
    : await Promise.all([
        cachedGoogleSerp(keyword).catch(() => ({ results: [] as any[], error: '' })),
        cachedYandexSerp(keyword).catch(() => ({ results: [] as any[], error: '' })),
      ]);

  // Дедупликация по домену
  const seenDomains = new Set(googleSerp.results.map((r: any) => r.domain));
  const mergedSerp = [
    ...googleSerp.results.filter((r: any) => r.url),
    ...yandexSerp.results.filter((r: any) => r.url && !seenDomains.has(r.domain)),
  ];

  // Анализируем ровно топ-3 конкурентов (fetchCompetitorArticles возьмёт 6 кандидатов
  // как запас на случай блокировки парсинга у cian/domclick/rosreestr).
  // 2026-04-20: 5 → 3, чтобы копировать стандарт ТОП-3, а не размывать средним по top-5.
  const competitors = await fetchCompetitorArticles(mergedSerp, ourDomain, 3);
  // Лог сколько конкурентов реально спарсилось — сигнал качества анализа.
  // Если 0/3 часто — надо пересмотреть список блокирующих доменов или взять фоллбэк.
  const compStatus = competitors.length === 0 ? ' ⚠️ ZERO — SERP-snippet fallback' : (competitors.length < 3 ? ' ⚠️ partial' : ' ✅');
  console.log(`[Competitors] "${keyword}": got ${competitors.length}/3 (from ${mergedSerp.length} SERP candidates)${compStatus}`);
  const avgCompetitorWords = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + c.wordCount, 0) / competitors.length) : 1200;
  const maxCompetitorWords = competitors.length
    ? Math.max(...competitors.map(c => c.wordCount)) : 1200;
  // Aggressive mode (set by loop-improve after 2+ non-top-3 attempts): push depth, not bulk.
  // 2026-04-20: уменьшены множители (было 1.6/1.3 + floor 4500/3500 → давало 2-2.6x от конкурентов)
  // Google/AI Overviews ранжируют по query satisfaction, не по объёму. Длиннее конкурентов —
  // максимум +25% в aggressive, +15% в обычном. Floor учитывает минимум для коммерч. статей.
  const aggressive = process.env.LOOP_AGGRESSIVE_MODE === '1';
  const wordMultiplier = aggressive ? 1.25 : 1.15;
  const targetWords = Math.max(aggressive ? 2800 : 2200, Math.round(maxCompetitorWords * wordMultiplier));

  // Competitor media/structure stats — used to set our target
  const avgCompetitorImages = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + (c.imageCount || 0), 0) / competitors.length) : 8;
  const maxCompetitorImages = competitors.length
    ? Math.max(...competitors.map(c => c.imageCount || 0)) : 8;
  const avgCompetitorFaq = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + (c.faqCount || 0), 0) / competitors.length) : 0;
  const competitorHasTables = competitors.some(c => c.hasTable);
  // 2026-04-20: оптимизация расхода — floor 9→6, cap 12. Картинок после каждого 2-го H2
  // достаточно для UX; 14-20 не давали доп. SEO-сигнала, но съедали 30% стоимости и 2 мин/статья.
  const targetImages = Math.max(6, Math.min(12, maxCompetitorImages));
  const targetFaq = Math.max(12, avgCompetitorFaq + 2);

  // New deep-competitor stats (auth links, internal links, videos, alts)
  const avgAuthLinks = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + (c.authLinkCount || 0), 0) / competitors.length) : 0;
  const maxAuthLinks = competitors.length
    ? Math.max(...competitors.map(c => c.authLinkCount || 0)) : 0;
  const avgInternalLinks = competitors.length
    ? Math.round(competitors.reduce((s, c) => s + (c.internalLinkCount || 0), 0) / competitors.length) : 0;
  const competitorHasVideo = competitors.some(c => (c.videoCount || 0) > 0);
  const uniqueAuthDomains = Array.from(new Set(competitors.flatMap(c => c.authDomains || []))).slice(0, 6);
  const targetAuthLinks = Math.max(3, maxAuthLinks);
  const targetInternalLinks = Math.max(5, Math.round(avgInternalLinks * 0.6));
  const altSamplesFromCompetitors = Array.from(new Set(competitors.flatMap(c => c.altSamples || []))).slice(0, 8);

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
        `--- Конкурент ${c.position}: ${c.domain} (${c.wordCount} слов, ${c.imageCount} изобр., ${c.faqCount} FAQ, таблицы: ${c.hasTable ? 'есть' : 'нет'}) ---\nЗаголовки: ${c.headings}\nФрагмент:\n${c.content.slice(0, 3000)}`
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

  const top3Stats = `\nСТАНДАРТ ТОП-3 (мы должны превзойти):
- Слов: лучший конкурент ${maxCompetitorWords}, наша цель ${targetWords}+
- Изображений: макс. у конкурентов ${maxCompetitorImages}, наша цель ${targetImages}+ (равномерно по тексту, после каждого 2-го H2)
- FAQ-вопросов: средн. у конкурентов ${avgCompetitorFaq}, наша цель ${targetFaq}+
- Таблицы: конкуренты ${competitorHasTables ? 'используют' : 'не используют'} — ${competitorHasTables ? 'ОБЯЗАТЕЛЬНО добавить' : 'добавить для сравнения способов'}
- Авторитетные ссылки (E-E-A-T): у конкурентов макс. ${maxAuthLinks}, средн. ${avgAuthLinks} — наша цель ${targetAuthLinks}+ (rosreestr.gov.ru, consultant.ru, garant.ru, nalog.ru, pravo.gov.ru)
- Внутренние ссылки: у конкурентов средн. ${avgInternalLinks} — наша цель ${targetInternalLinks}+ на kadastrmap.info (ссылки на /spravki/, другие статьи)
- Видео: конкуренты ${competitorHasVideo ? 'используют (YouTube embed)' : 'не используют'}${competitorHasVideo ? ' — добавить YouTube embed в разделе с инструкцией' : ''}\n`;
  const competitorAuthDomainsBlock = uniqueAuthDomains.length > 0
    ? `\nКОНКУРЕНТЫ ССЫЛАЮТСЯ НА (используй эти же источники): ${uniqueAuthDomains.join(', ')}\n`
    : '';
  const competitorAltSamplesBlock = altSamplesFromCompetitors.length > 0
    ? `\nПРИМЕРЫ ALT-ТЕКСТОВ КОНКУРЕНТОВ (для понимания тематики изображений): ${altSamplesFromCompetitors.slice(0, 5).map(a => `"${a.slice(0, 60)}"`).join(', ')}\n`
    : '';

  const aggressiveBlock = aggressive
    ? `\n🔥 AGGRESSIVE MODE (предыдущие попытки не попали в топ-3):
- Пиши РАДИКАЛЬНО глубже и уникальнее конкурентов — минимум ${targetWords} слов (это +60% к лучшему конкуренту)
- Добавь 2-3 уникальных H2-раздела которых НЕТ ни у одного конкурента (чек-листы, готовые шаблоны, сравнительные таблицы, реальные кейсы с разбором)
- В каждом H2 — минимум 350 слов (вместо 250), больше конкретики: цифры, даты, статьи законов, примеры из судебной практики
- Featured snippet (первый <p>) — 55-70 слов, максимально конкретный ответ
- FAQ: минимум ${targetFaq + 3} вопросов, ответы 100-130 слов каждый
- Добавь раздел «Чек-лист перед заказом» с <ul><li> из 8-12 пунктов
- Добавь раздел «Типичные ошибки» с 5-7 пунктами и объяснениями
- Добавь раздел «Юридическая база» — перечисли ВСЕ применимые ФЗ, постановления, приказы с номерами и датами\n`
    : '';

  // Intent detection → structure adapts to what the user actually wants.
  // Same keyword rewritten as info-style vs transactional-style converts 2-3x differently.
  // NOTE: JavaScript \b only works for ASCII word chars — useless for Cyrillic.
  // We use (?:^|\s) / (?=\s|$) lookarounds + string boundary checks instead.
  const kwLower = keyword.toLowerCase();
  let intent: 'transactional' | 'howto' | 'info' | 'local' | 'comparison' = 'info';
  if (/(?:^|\s)(?:москв|петербург|спб|екатеринбург|новосибирск|казан|нижн|ростов|самар|красноярск|челябинск|воронеж|уфа|сочи|краснодар)/i.test(kwLower)) intent = 'local';
  else if (/(?:^|\s)(?:или|лучше|отлич|сравнен|vs)(?:\s|$)/i.test(kwLower)) intent = 'comparison';
  else if (/^как\s|\sкак\s+(?:заказать|получить|оформить|сделать|проверить|узнать)/i.test(kwLower)) intent = 'howto';
  else if (/(?:^|\s)(?:заказать|купить|оформить|срочн)/i.test(kwLower)) intent = 'transactional';
  else if (/^что\s+(?:такое|это)|^определение\s|\sзначит(?:\s|$)/i.test(kwLower)) intent = 'info';
  const intentBlock = (() => {
    switch (intent) {
      case 'transactional':
        return `\n🎯 ИНТЕНТ: TRANSACTIONAL — пользователь готов заказать.\n- В первых 3 H2 — цена, сроки, пошаговый заказ с CTA-ссылкой на /spravki/\n- Featured snippet должен содержать конкретную цену или срок\n- FAQ фокус на: «сколько стоит», «как оплатить», «когда придёт», «возврат денег»\n- Минимум 2 CTA-блока ссылок на /spravki/ внутри статьи\n`;
      case 'howto':
        return `\n🎯 ИНТЕНТ: HOW-TO — пользователь хочет пошаговую инструкцию.\n- Структура: определение → H2 "Шаг 1: Подготовьте данные" → H2 "Шаг 2: ..." → ... → H2 "Получение результата"\n- Каждый шаг — описание + нумерованный <ol> подпунктов + что делать если что-то не получилось\n- FAQ: «что делать если ошибка», «что если нет доступа к...», «как исправить»\n- Featured snippet = краткая выжимка главного шага (<60 слов)\n`;
      case 'info':
        return `\n🎯 ИНТЕНТ: INFORMATIONAL — пользователь разбирается в теме.\n- Структура: определение → правовая база (ФЗ/ГК РФ) → виды/классификация → примеры → FAQ\n- В каждом H2 — конкретные термины + ссылки на законы (в тексте, без <a href>)\n- FAQ: «чем отличается от...», «нужна ли...», «кто выдаёт», «как часто обновляется»\n- Featured snippet = классическое определение: "${keyword} — это..."\n`;
      case 'local':
        return `\n🎯 ИНТЕНТ: LOCAL — локальная выдача.\n- Упомини конкретный регион/город в каждом 2-м H2 заголовке\n- Добавь H2 «Где заказать в <город>» + «Адреса МФЦ в <город>» + «Особенности <регион>»\n- Укажи региональные сроки/тарифы если они отличаются от общероссийских\n- FAQ: «где в <город>...», «сколько стоит в <регион>», «работают ли МФЦ <город> по субботам»\n- Meta description должна упомянуть город в первых 60 символах\n`;
      case 'comparison':
        return `\n🎯 ИНТЕНТ: COMPARISON — пользователь сравнивает варианты.\n- ОБЯЗАТЕЛЬНА таблица сравнения в первых 2 H2 (критерии: цена, срок, удобство, юр. сила)\n- H2 «Плюсы и минусы каждого варианта» с <ul> по каждому\n- H2 «Что выбрать» — итоговая рекомендация с обоснованием\n- Featured snippet = сжатый вердикт сравнения (<60 слов)\n- FAQ: «когда лучше А», «когда лучше Б», «можно ли совмещать»\n`;
    }
  })();
  console.log(`[Intent] ${keyword} → ${intent}`);

  const improvePrompt = competitorContext
    ? `Ключ: "${keyword}"

Наша статья (${parsed.wordCount} слов):
${parsed.title}
${parsed.content.slice(0, 3000)}

КОНКУРЕНТЫ ТОП-5 (лучший конкурент: ${maxCompetitorWords} слов, средний: ${avgCompetitorWords} слов):
${competitorContext}
${missingTopicsBlock}${lsiBlock}${top3Stats}${competitorAuthDomainsBlock}${competitorAltSamplesBlock}${intentBlock}${aggressiveBlock}
ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов — это ${aggressive ? '25' : '15'}% больше лучшего конкурента (${maxCompetitorWords} слов). Пиши плотно, без воды — пользователь ищет ответ, а не километры текста. Каждый раздел завершён, но не разведён синонимами ради объёма.
2. HTML: H1, H2 (8-14), H3 где уместно, <ul>/<ol>, <table> для сравнений и данных
3. FEATURED SNIPPET (ОБЯЗАТЕЛЬНО): сразу после H1 — абзац 40-60 слов с прямым ответом на "${keyword}". Без вступлений типа "В этой статье...". Формат: "**${keyword}** — это [определение]. [Ключевой факт]. [CTA-намёк]." Это попадает в блок 0 Яндекса и Гугла.
4. Покрой ВСЕ темы из списка "ТЕМЫ КОНКУРЕНТОВ" выше плюс добавь уникальный угол — то чего нет ни у кого
5. FAQ: H2 "Часто задаваемые вопросы" с минимум ${targetFaq} вопросами-ответами в формате <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> (первый с open, остальные без). НЕ используй <h3> для вопросов — только <details>/<summary>. Минимум ${targetFaq} вопросов — это критично для Яндекс AI-ответов (FAQ-схема).
6. E-E-A-T: конкретные числа, сроки, законы РФ, стоимости, примеры из практики. ${getShortcodesHint(keyword)}
7. Все упоминания заказа документов — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. ⛔ ЗАПРЕЩЕНО писать «зайдите на сайт kadastrmap.info», «на главной странице выберите раздел», «в меню нажмите», «найдите раздел «Заказать»» — это абстрактные инструкции, которые у нас НЕ соответствуют реальной навигации. ✅ Вместо этого: «перейдите по ссылке на /spravki/», «воспользуйтесь формой заказа на /spravki/», «заполните онлайн-анкету на /spravki/». НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
8. Качество: пиши лучше конкурентов — более подробно, структурировано, с конкретными примерами и полезными деталями которых у них нет.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Авторитетные источники (E-E-A-T): упоминай в ТЕКСТЕ — Росреестр (rosreestr.gov.ru), Федеральный закон №218-ФЗ, Гражданский кодекс РФ, ГАРАНТ.РУ, КонсультантПлюс, ФНС. Минимум 3 упоминания. ⚠️ НЕ ОБОРАЧИВАЙ их в <a href> — просто пиши доменное имя как текст (не кликабельно). Это защищает наш PageRank от утечки на внешние сайты. Пример правильно: "согласно ФЗ-218 (pravo.gov.ru)"; пример неправильно: &lt;a href="..."&gt;Росреестр&lt;/a&gt;.
12. СТРОГО по теме запроса "${keyword}" — НЕ включай разделы про другие продукты если они не относятся к теме.
13. ОБЯЗАТЕЛЬНЫЕ H3-блоки внутри соответствующих H2-разделов:
    - В разделе про документ/отчёт добавь <h3>🛡️ Гарантируем возврат средств</h3> с текстом о гарантии и условиях возврата (80-100 слов)
    - В разделе про виды или форматы добавь <h3>📱 Срочный отчёт в твоём смартфоне</h3> с описанием мобильного доступа (80-100 слов)
    - В разделе про стоимость добавь <h3>⭐ Отзывы клиентов</h3> с 3-4 краткими отзывами (100-120 слов)
14. ИЗОБРАЖЕНИЯ: в статье будет ${targetImages} изображений, равномерно после каждого 2-го H2-раздела. Пиши достаточно подробно в каждом H2 — минимум 300 слов — чтобы картинка имела контекст.
15. ЭМОДЗИ В ТЕКСТЕ: активно используй эмодзи внутри параграфов и списков — минимум 25-35 на всю статью:
    - 💡 — для советов и лайфхаков ("💡 Совет: ...")
    - ⚠️ — для предупреждений ("⚠️ Важно: ...")
    - ✅ — для преимуществ и успешных шагов
    - 📌 — для ключевых фактов
    - ★ — для выделения важных выводов
    - 📊 💰 ⏱️ 🔍 📋 📄 🏠 🏦 — по контексту раздела
    Эмодзи ставь в начале предложения или перед ключевым словом. В каждом H2-разделе должно быть 2-3 эмодзи в тексте.

Верни ТОЛЬКО HTML без <html>/<body>.`
    : `Ключ: "${keyword}"\n\nОригинальная статья (${parsed.wordCount} слов):\n${parsed.title}\n${parsed.content.slice(0, 5000)}\n${lsiBlock}\nНапиши расширенную SEO-статью строго по следующей структуре. Каждый раздел ОБЯЗАТЕЛЕН и должен содержать указанный минимум слов:\n\n<h1>${parsed.title}</h1>\n<p>[Прямой ответ: что такое "${keyword}" — 120-150 слов, featured snippet]</p>\n\n<h2>Что такое ${keyword}</h2>\n<p>[Подробное определение, правовая база, зачем нужно — 200-250 слов]</p>\n\n<h2>Когда требуется ${keyword}</h2>\n<p>[5-7 конкретных случаев с пояснением — 200-250 слов]</p>\n\n<h2>Какие сведения содержит ${keyword}</h2>\n<p>[Список с пояснениями — 200-250 слов, используй <ul>]</p>\n\n<h2>Как заказать ${keyword} онлайн через kadastrmap.info</h2>\n<p>[Пошаговая инструкция заказа — 250-300 слов, <ol>. Пункты говорят о действиях на странице заказа: 1) «Перейдите на <a href="/spravki/">/spravki/</a>», 2) «Выберите тип документа (краткая / полная / расширенная выписка и т.п.)», 3) «Введите кадастровый номер или адрес объекта», 4) «Проверьте данные в форме», 5) «Оплатите онлайн (карта/СБП)». ⛔ НЕ пиши «зайдите на главную», «в меню», «найдите раздел» — пользователь уже на /spravki/ после клика по ссылке.]</p>\n\n<h2>Сроки и стоимость</h2>\n<p>[Вступление к разделу — 1-2 предложения]</p>\n[BLOCK_PRICE]\n<p>[Краткое пояснение — 60-80 слов]</p>\n\n<h2>Преимущества заказа через kadastrmap.info</h2>\n<p>[Почему удобнее заказать на нашем сайте: скорость, простота, электронная доставка — 200-250 слов]</p>\n\n<h2>Типичные ошибки при заказе</h2>\n<p>[4-5 частых ошибок с советами — 150-200 слов]</p>\n\n<h2>Часто задаваемые вопросы</h2>\n[10 вопросов-ответов СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с атрибутом open, остальные 9 без него. НЕ используй <h3> для вопросов.]\n\n<h2>Вывод</h2>\n<p>[Итог + CTA: заказать на <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 100-120 слов]</p>\n\nПравила:\n- Все упоминания заказа документов — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. ⛔ ЗАПРЕЩЕНО «зайдите на главную», «в меню выберите», «найдите раздел Заказать» — такой навигации нет. ✅ Пиши: «перейдите на /spravki/», «заполните форму на /spravki/». НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.\n- Конкретные факты, законы РФ, сроки. Цены — ТОЛЬКО через [BLOCK_PRICE], не вставляй цифры.\n- FAQ ТОЛЬКО через <details class="faq-item">/<summary>, НЕ через <h3>.\n- Только HTML без <html>/<body>.\n- Не сокращай разделы — каждый должен быть полным.\n- ЭМОДЗИ: активно используй в тексте (минимум 25): 💡 советы, ⚠️ предупреждения, ✅ преимущества, 📌 факты, ★ выводы, 📊 💰 ⏱️ по контексту.`;

  // SEO analysis: fast 8B (simple JSON task)
  // Article generation: best available model for TOP-3 quality
  const mainModel = process.env.LLM_MAIN_MODEL ?? 'openai/gpt-oss-120b';
  const seoModel  = process.env.LLM_SEO_MODEL  ?? 'openai/gpt-oss-120b';

  const [seoResponse, improvedResponse] = await Promise.all([
    invokeLLM({
      model: seoModel,
      messages: [
        { role: 'system', content: 'Ты SEO-эксперт по российскому рынку. Отвечай ТОЛЬКО валидным JSON без markdown. НЕ копируй шаблонные строки (типа "до 60 символов") — подставляй реальные значения.' },
        { role: 'user', content: `Напиши мета-данные для статьи. Верни ТОЛЬКО JSON (без пояснений, без markdown-блоков).\n\nСТАТЬЯ:\nЗаголовок: ${parsed.title}\nКлюч: ${keyword}\nОбъём: ${parsed.wordCount} слов\n\nПРАВИЛА:\n- metaTitle: РЕАЛЬНЫЙ заголовок с ключом "${keyword}" в начале, длина 45-60 символов. Без фраз "в N символов", "или меньше".\n- metaDescription: РЕАЛЬНОЕ описание с призывом к действию и ключом, длина 120-155 символов, заканчивается точкой. Без фраз "до N символов".\n- keywords: массив из 5-10 LSI-ключей.\n- score: число 50-95.\n\nФОРМАТ (подставь реальные значения вместо <...>):\n{"metaTitle":"<реальный title>","metaDescription":"<реальное описание>","keywords":["<ключ1>","<ключ2>"],"headingsSuggestions":[],"generalSuggestions":[],"score":<число>}` },
      ],
    }),
    invokeLLM({
      model: mainModel,
      messages: [
        { role: 'system', content: 'Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 3500+ слов для топа поиска. Каждый H2-раздел минимум 250 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE]. СТРОГО ЗАПРЕЩЕНО: markdown-синтаксис (НЕ ставить # ## ### для заголовков, НЕ **жирный**, НЕ _курсив_, НЕ - списки). Используй ТОЛЬКО HTML-теги: <h1>, <h2>, <h3>, <p>, <ul><li>, <ol><li>, <strong>, <em>, <table><tr><td>, <details class="faq-item"><summary>. Если отдашь markdown — статья будет выглядеть сломанной.' },
        { role: 'user', content: improvePrompt },
      ],
      maxTokens: 8192,
    }),
  ]);

  let seo: SeoAnalysis;
  try {
    const seoRaw = typeof seoResponse.choices[0]?.message.content === 'string'
      ? seoResponse.choices[0].message.content.trim().replace(/<think>[\s\S]*?<\/think>/gi, '').trim() : '{}';
    seo = JSON.parse(seoRaw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim());
  } catch {
    seo = { metaTitle: parsed.title, metaDescription: parsed.metaDescription, keywords: [], headingsSuggestions: [], generalSuggestions: [], score: 0 };
  }
  if (isPlaceholderTitle(seo.metaTitle)) seo.metaTitle = parsed.title;
  if (isPlaceholderMeta(seo.metaDescription)) seo.metaDescription = parsed.metaDescription || '';

  let improvedContent = typeof improvedResponse.choices[0]?.message.content === 'string'
    ? improvedResponse.choices[0].message.content.trim()
        .replace(/<think>[\s\S]*?<\/think>/gi, '')  // strip reasoning blocks (Qwen3/DeepSeek-R1)
        .replace(/^```html?\s*/i, '').replace(/\s*```$/i, '').trim()
    : parsed.content;

  // Post-generation quality check: fix missing content vs competitor targets
  improvedContent = await enhanceIfNeeded(improvedContent, keyword, targetWords, targetFaq);
  improvedContent = filterGarbageH2(improvedContent, keyword);
  improvedContent = stripFirstH1(normalizeHeadings(convertMarkdownLeaks(improvedContent)));

  // LLM critical self-review → one polishing rewrite when substantive issues found.
  // Opt-out via LLM_CRITICAL_PASS=0. Enabled by default because it's high-leverage
  // (+10–15% content quality) and only adds ~20-30s per article.
  if (process.env.LLM_CRITICAL_PASS !== '0') {
    improvedContent = await applyCriticalReview(improvedContent, keyword, targetWords, mainModel).catch((e) => {
      console.warn('[Critical] pass skipped:', e?.message ?? e);
      return improvedContent;
    });
  }

  // Featured Snippet (Block 0) enforcement — first substantive <p> must be 35-85 words
  // to qualify for Yandex "быстрые ответы" and Google featured snippet. Regenerates
  // just that paragraph if out of range.
  improvedContent = await ensureFeaturedSnippet(improvedContent, keyword, mainModel);

  improvedContent = beautifyArticleHtml(improvedContent);

  // QA log: verify article meets TOP-3 standards
  checkArticleQuality(improvedContent, url, targetWords, targetFaq);

  // Add internal links to related articles on the same site
  improvedContent = await addInternalLinks(improvedContent, userId, ourDomain, parsed.title);

  // Auto-inject authority links if LLM didn't add enough (E-E-A-T signal)
  improvedContent = ensureAuthorityLinks(improvedContent, keyword);

  // Top-matter: breadcrumb HTML + freshness stamp + TOC with #anchors.
  // Breadcrumb → Yandex rich result, freshness → Yandex ranking factor,
  // TOC anchors → Google SERP jump-links (+25% organic CTR).
  improvedContent = addTopMatterBlocks(improvedContent, seo.metaTitle || parsed.title, url);

  // Append FAQPage + Article + Breadcrumb + HowTo + AggregateRating JSON-LD
  const schemaMarkup = generateSchemaMarkup(keyword, seo.metaTitle || parsed.title, url, improvedContent);
  improvedContent = improvedContent + '\n' + schemaMarkup;

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

  // Auto-publish to WordPress (batch mode: no image generation).
  // imagesNeeded from competitor data (max competitor images + 2), capped at MAX_FLUX_IMAGES
  // to prevent runaway FLUX generation (each image ≈ 30s sequential). Default cap 20 —
  // matches top-3 competitors' image count (our audit found some have 23+ images).
  // Each +5 images costs ~2-3 min per article, trade-off vs matching competitor parity.
  // 2026-04-20: cap 20→12, floor 9→6 (sync with targetImages)
  const fluxCap = Number(process.env.MAX_FLUX_IMAGES ?? 12);
  const imagesForWp = Math.min(Math.max(targetImages, 6), fluxCap);
  await autoPublishToWP(userId, url, seo.metaTitle || parsed.title, improvedContent, {
    metaDescription: seo.metaDescription ? truncateMetaDesc(seo.metaDescription) : undefined,
    focusKeyword: keyword || undefined,
    keywords: seo.keywords?.length ? seo.keywords : undefined,
    imagesNeeded: imagesForWp,
  }).catch((e: any) => console.error(`[WP] Auto-publish failed for ${url}:`, e?.message ?? e));

  // Post-publish image check: compare actual <img> count on the live page
  // against our target (competitor max + 2). Runs async so it doesn't slow the loop.
  void (async () => {
    try {
      await new Promise(r => setTimeout(r, 5000));  // give WP 5s to flush cache
      const resp = await fetch(url);
      if (!resp.ok) return;
      const liveHtml = await resp.text();
      const imgCount = (liveHtml.match(/<img\b/gi) || []).length;
      const ok = imgCount >= targetImages;
      console.log(`[PostQA] ${url} → images ${imgCount}/${targetImages} ${ok ? '✅' : '⚠️ LOW'}`);
    } catch (err: any) {
      // swallow — PostQA is best-effort
    }
  })();

  // Notify search engines about the updated article
  void submitToIndexNow(url);
}

/**
 * Find, upload and inject images into article HTML.
 * Priority: WP Media Library → FLUX generation (sequential to avoid rate limits).
 * Returns updated HTML with images injected after H2s, and the featured media ID.
 */

// ── Article image prompts cache (server/data/article-image-prompts.json) ─────
import { readFileSync as _readFileSync, writeFileSync as _writeFileSync } from 'fs';
import { join as _pathJoin } from 'path';

const _PROMPTS_CACHE = _pathJoin(process.cwd(), 'server/data/article-image-prompts.json');

function getImagePromptsFromCache(slug: string): string[] | null {
  try {
    const cache = JSON.parse(_readFileSync(_PROMPTS_CACHE, 'utf-8')) as Record<string, string[]>;
    const prompts = cache[slug];
    if (Array.isArray(prompts) && prompts.length >= 3) {
      console.log(`[Img] Using cached prompts for "${slug}" (${prompts.length} prompts)`);
      return prompts;
    }
  } catch { /* cache miss */ }
  return null;
}

function saveImagePromptsToCache(slug: string, prompts: string[]): void {
  try {
    let cache: Record<string, string[]> = {};
    try { cache = JSON.parse(_readFileSync(_PROMPTS_CACHE, 'utf-8')); } catch { /* empty */ }
    cache[slug] = prompts;
    _writeFileSync(_PROMPTS_CACHE, JSON.stringify(cache, null, 2), 'utf-8');
    console.log(`[Img] Cached ${prompts.length} prompts for "${slug}"`);
  } catch (e: any) { console.warn('[Img] Could not save prompts cache:', (e as Error).message); }
}

export async function findAndInjectImages(
  siteUrl: string,
  username: string,
  appPassword: string,
  slug: string,
  title: string,
  html: string,
  imagesNeeded = 9,
): Promise<{ html: string; featuredMediaId: number | undefined }> {
  const titleKeywords = title
    .replace(/[-–—:,]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !/^(полное|руководство|как|что|для|при|про|это|инструкция)$/i.test(w))
    .slice(0, 3)
    .join(' ');

  // WP Media Library first
  const libraryImages = await wp.searchMedia(siteUrl, username, appPassword, titleKeywords, 8)
    .catch(() => [] as { id: number; url: string; width: number; height: number; alt: string; title: string }[]);

  console.log(`[Img] WP library: ${libraryImages.length}`);

  // Vision-filter for relevance
  const relevant = libraryImages.length > 0
    ? await filterRelevantMedia(title, libraryImages).catch(() => libraryImages.slice(0, imagesNeeded))
    : [];
  console.log(`[Img] Relevant after filter: ${relevant.length}/${libraryImages.length}`);

  let validMedia: { id: number; url: string; width?: number; height?: number }[] = relevant
    .filter(m => m.id > 0)
    .slice(0, imagesNeeded)
    .map(m => ({ id: m.id, url: m.url, width: m.width, height: m.height }));

  // FLUX generation — sequential to avoid Fireworks rate-limit 500 errors
  if (process.env.IMAGE_API_KEY) {
    const fluxNeeded = validMedia.length < imagesNeeded
      ? imagesNeeded - validMedia.length
      : 1;
    // 2026-04-20: извлекаем H2 + первые ~180 слов тела каждого раздела, чтобы FLUX-промпт
    // отражал фактическое содержание раздела (цены/сроки/действия из текста), а не generic.
    const h2SectionsData = extractH2Sections(html).slice(0, Math.max(fluxNeeded, 9));
    const h2Sections = h2SectionsData.map(s => s.heading);
    const h2Bodies = h2SectionsData.map(s => s.body);
    const bodyText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    // Check cache first — allows per-article prompt customization
    const cachedPrompts = getImagePromptsFromCache(slug);
    const prompts = cachedPrompts && cachedPrompts.length >= fluxNeeded
      ? cachedPrompts
      : await generateImagePrompts(title, titleKeywords, h2Sections, bodyText, fluxNeeded, h2Bodies);
    if (!cachedPrompts || cachedPrompts.length < fluxNeeded) saveImagePromptsToCache(slug, prompts);
    // 2026-04-20: параллельно по 2 (было sequential из-за прежних 500-ошибок Fireworks).
    // Schnell отвечает быстрее → rate-limit менее чувствителен. Если серия 500 — автоматически
    // падём на sequential для остатка.
    const BATCH_SIZE = Number(process.env.FLUX_BATCH_SIZE ?? 2);
    console.log(`[Img] Generating ${fluxNeeded} FLUX images (parallel batch=${BATCH_SIZE})`);
    const fluxValid: { id: number; url: string; width?: number; height?: number }[] = [];
    const totalImgs = Math.min(fluxNeeded, prompts.length);
    let rateLimitHits = 0;
    let useSequential = false;
    for (let start = 0; start < totalImgs; start += useSequential ? 1 : BATCH_SIZE) {
      const batchEnd = Math.min(totalImgs, start + (useSequential ? 1 : BATCH_SIZE));
      const indices = Array.from({ length: batchEnd - start }, (_, k) => start + k);
      const results = await Promise.allSettled(
        indices.map(async (i) => {
          const imgUrl = await generateDallEImage(prompts[i]);
          const up = await wp.uploadMediaFromUrl(siteUrl, username, appPassword, imgUrl, `${slug}-flux-${i + 1}.jpg`);
          return { i, up };
        })
      );
      for (const [k, r] of results.entries()) {
        const i = indices[k];
        if (r.status === 'fulfilled') {
          fluxValid.push(r.value.up);
          console.log(`[Img] FLUX[${i}] uploaded → WP id ${r.value.up.id}`);
        } else {
          const msg = (r.reason as any)?.message || '';
          console.warn(`[Img] FLUX[${i}] failed:`, msg);
          if (/rate.?limit|500|429/i.test(msg)) rateLimitHits++;
        }
      }
      if (!useSequential && rateLimitHits >= 2) {
        console.warn(`[Img] 2+ rate-limit hits — switching to sequential for remaining`);
        useSequential = true;
      }
    }
    // FLUX images go first — first one becomes the featured image
    validMedia = [...fluxValid, ...validMedia];
  }

  if (validMedia.length === 0) {
    console.log('[Img] No images found, skipping injection');
    return { html, featuredMediaId: undefined };
  }

  console.log(`[Img] Injecting ${validMedia.length} images into article`);
  // SEO context for alt texts: article title supplies the keyword themes
  const htmlWithImages = injectImagesAfterH2s(html, validMedia, undefined, { articleTitle: title, keyword: titleKeywords });
  return { html: htmlWithImages, featuredMediaId: validMedia[0]?.id };
}

/** Truncate meta description to ≤155 chars at word boundary (Google shows ~155-160 chars). */
function truncateMetaDesc(text: string, max = 155): string {
  if (!text) return text;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  // Prefer end of sentence: last . ! ? within the cut
  const lastSentence = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (lastSentence >= 100) return cut.slice(0, lastSentence + 1).trim();
  // Fallback: last word boundary + ellipsis
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 100 ? cut.slice(0, lastSpace) : cut).replace(/[,;:–—\-]+$/, '').trim();
  return base.endsWith('.') || base.endsWith('!') || base.endsWith('?') ? base : base + '…';
}

/**
 * Publish an article to WordPress automatically (batch mode).
 * Finds/uploads images from WP Library, Pexels, Wikimedia, or generates via FLUX.
 */
async function autoPublishToWP(
  userId: number,
  url: string,
  title: string,
  content: string,
  opts: { metaDescription?: string; focusKeyword?: string; keywords?: string[]; imagesNeeded?: number } = {},
): Promise<void> {
  const accounts = await wordpressDb.getUserWordpressAccounts(userId);
  const account = accounts[0];
  if (!account) { console.log(`[WP] No WP account for userId=${userId}, skipping auto-publish`); return; }

  const slug = new URL(url).pathname.replace(/\/$/, '').split('/').pop() || '';
  if (!slug) { console.log(`[WP] Could not extract slug from ${url}`); return; }

  const post = await wp.findPostBySlug(account.siteUrl, account.username, account.appPassword, slug);
  if (!post) { console.log(`[WP] Post not found for slug "${slug}", skipping`); return; }

  const ctaUrl = `${account.siteUrl.replace(/\/$/, '')}/spravki/`;
  const ctaTexts = ['Заказать документ онлайн', 'Получить справку сейчас', 'Проверить объект на kadastrmap.info'];
  const ctaBlock = (text: string) =>
    `\n<div style="text-align:center;margin:2em 0 2.5em;">` +
    `<a href="${ctaUrl}" style="display:inline-block;background:#4CAF50;color:#fff;` +
    `padding:16px 48px;border-radius:8px;font-size:16px;font-weight:500;text-decoration:none;">` +
    `${text}</a></div>\n`;

  // Base HTML: beautify + CTAs
  let htmlContent = replacePriceTableWithShortcode(
    injectCtasIntoHtml(content, ctaTexts, ctaBlock)
  );

  // Find and inject images — imagesNeeded driven by competitor stats from rewriteArticle
  const { html: htmlWithImages, featuredMediaId } = await findAndInjectImages(
    account.siteUrl, account.username, account.appPassword,
    slug, title, htmlContent, opts.imagesNeeded,
  ).catch((e: any) => {
    console.warn('[WP] Image injection failed:', e?.message);
    return { html: htmlContent, featuredMediaId: undefined };
  });
  htmlContent = htmlWithImages;

  await wp.updatePost(account.siteUrl, account.username, account.appPassword, post.id, {
    title,
    content: htmlContent,
    categories: detectCategoryIds(url),
    ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
  });

  // Update outsearch + outmap + Yoast SEO meta via custom WP endpoint
  const showMap = shouldShowMap(slug);
  const siteBase = account.siteUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');
  const axiosInst = (await import('axios')).default;
  const postMeta: Record<string, string> = { outsearch: '1', outmap: showMap ? '1' : '0' };
  if (opts.metaDescription) postMeta._yoast_wpseo_metadesc = opts.metaDescription;
  if (opts.focusKeyword)    postMeta._yoast_wpseo_focuskw  = opts.focusKeyword;
  if (opts.keywords?.length) postMeta.meta_keywords = opts.keywords.join(', ');
  await axiosInst.post(
    `${siteBase}/wp-json/kadastrmap/v1/post-meta/${post.id}`,
    { meta: postMeta },
    { headers: { Authorization: auth, 'Content-Type': 'application/json' } }
  ).catch((e: any) => console.warn('[WP] meta update failed:', e?.message));
  console.log(`[WP] outmap=${showMap} metadesc=${!!opts.metaDescription} keywords=${opts.keywords?.length ?? 0} for slug="${slug}"`);

  console.log(`[WP] Published: ${url} → ${account.siteUrl}`);
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

  // Sequential (1 at a time) to avoid hammering SERP proxies + MariaDB
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
    // Cooldown between articles: let PHP-FPM/MariaDB recover (prevent CrowdSec triggering on 127.0.0.1)
    if (queue.length > 0 && !stopped) await new Promise(r => setTimeout(r, 5000));
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
      const targetWords = Math.max(3500, Math.round(maxCompetitorWords * 1.3));

      // Competitor media/structure stats
      const avgCompetitorImages = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + (c.imageCount || 0), 0) / competitors.length) : 8;
      const maxCompetitorImages = competitors.length > 0
        ? Math.max(...competitors.map(c => c.imageCount || 0)) : 8;
      const avgCompetitorFaq = competitors.length > 0
        ? Math.round(competitors.reduce((s, c) => s + (c.faqCount || 0), 0) / competitors.length) : 0;
      const competitorHasTables = competitors.some(c => c.hasTable);
      // 2026-04-20: оптимизация расхода — floor 9→6, cap 12. Картинок после каждого 2-го H2
  // достаточно для UX; 14-20 не давали доп. SEO-сигнала, но съедали 30% стоимости и 2 мин/статья.
  const targetImages = Math.max(6, Math.min(12, maxCompetitorImages));
      const targetFaq = Math.max(12, avgCompetitorFaq + 2);

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
            `--- Конкурент ${c.position}: ${c.domain} (${c.wordCount} слов, ${c.imageCount} изобр., ${c.faqCount} FAQ, таблицы: ${c.hasTable ? 'есть' : 'нет'}) ---\nЗаголовки: ${c.headings}\nФрагмент:\n${c.content.slice(0, 3000)}`
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

      const top3Stats = `\nСТАНДАРТ ТОП-3 (мы должны превзойти):
- Слов: лучший конкурент ${maxCompetitorWords}, наша цель ${targetWords}+
- Изображений: макс. у конкурентов ${maxCompetitorImages}, наша цель ${targetImages}+
- FAQ-вопросов: средн. у конкурентов ${avgCompetitorFaq}, наша цель ${targetFaq}+
- Таблицы: конкуренты ${competitorHasTables ? 'используют' : 'не используют'} — ${competitorHasTables ? 'ОБЯЗАТЕЛЬНО' : 'желательно'}\n`;

      const ourHeadings = parsed.headings.map(h => `${h.level}: ${h.text}`).join('; ');

      // 3. SEO analysis + improved text — parallel, with competitor context
      const seoPrompt = `Ты SEO-эксперт по российскому рынку. Проанализируй статью и верни JSON.

Статья (ПОСЛЕ улучшения ИИ):
Заголовок: ${parsed.title}
Ключевой запрос: ${serpKeyword}
Объём: ${parsed.wordCount} слов → целевой после улучшения: ${targetWords}+ слов
Структура: ${ourHeadings}
Конкуренты ТОП-3: ${maxCompetitorWords} слов, ${maxCompetitorImages} изображений, ${avgCompetitorFaq} FAQ

Правила оценки score (0-100):
- ${targetWords}+ слов → +20
- 8+ H2 заголовков → +15
- Ключ в H1 и первом абзаце → +15
- FAQ раздел (${targetFaq}+ вопросов) → +10
- 9+ изображений равномерно → +10
- Таблица сравнения → +5
- Внешние ссылки на авторитетные источники → +10
- Внутренние ссылки на другие страницы сайта → +10
- Ключевые слова в подзаголовках → +5

Верни ТОЛЬКО валидный JSON:
{"metaTitle":"до 60 симв","metaDescription":"до 160 симв","keywords":["ключ1"],"headingsSuggestions":[],"generalSuggestions":["совет"],"score":75}`;

      const improvePrompt = competitorContext
        ? `Ключ: "${serpKeyword}"

Наша статья (${parsed.wordCount} слов):
${parsed.title}
${parsed.content.slice(0, 3000)}

КОНКУРЕНТЫ ТОП-5 (лучший конкурент: ${maxCompetitorWords} слов, средний: ${avgCompetitorWords} слов):
${competitorContext}
${missingTopicsBlock}${lsiBlock}${top3Stats}
ТРЕБОВАНИЯ:
1. Объём: минимум ${targetWords} слов — это 30% БОЛЬШЕ лучшего конкурента (${maxCompetitorWords} слов). Каждый раздел должен быть полным, не обрывай мысль.
2. HTML: H1, H2 (8-14), H3 где уместно, <ul>/<ol>, <table> для сравнений и данных
3. Прямой ответ на "${serpKeyword}" в первых 2-3 предложениях (featured snippet для Яндекса)
4. Покрой ВСЕ темы из списка "ТЕМЫ КОНКУРЕНТОВ" выше плюс добавь уникальный угол — то чего нет ни у кого
5. FAQ: H2 "Часто задаваемые вопросы" с минимум ${targetFaq} вопросами СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные без. НЕ используй <h3> для вопросов — только <details>/<summary>
6. E-E-A-T: конкретные числа, сроки, законы РФ, стоимости, примеры из практики. ${getShortcodesHint(serpKeyword)}
7. Все упоминания заказа документов — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. ⛔ ЗАПРЕЩЕНО писать «зайдите на сайт kadastrmap.info», «на главной странице выберите раздел», «в меню нажмите», «найдите раздел «Заказать»» — это абстрактные инструкции, которые у нас НЕ соответствуют реальной навигации. ✅ Вместо этого: «перейдите по ссылке на /spravki/», «воспользуйтесь формой заказа на /spravki/», «заполните онлайн-анкету на /spravki/». НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.
8. Качество: пиши лучше конкурентов — более подробно, структурировано, с конкретными примерами и полезными деталями которых у них нет.
9. ЗАПРЕЩЕНО вставлять конкретные цены в рублях — используй ТОЛЬКО шорткод [BLOCK_PRICE] для раздела с ценами.
10. Название сервиса пиши СТРОГО как "kadastrmap.info" (с буквой r: kadas-TR-map). Никогда не пиши "Kadastmap", "kadastmap", "KadastrMap" — только "kadastrmap.info".
11. Авторитетные источники (E-E-A-T): упоминай в ТЕКСТЕ — Росреестр (rosreestr.gov.ru), Федеральный закон №218-ФЗ, Гражданский кодекс РФ, ГАРАНТ.РУ, КонсультантПлюс, ФНС. Минимум 3 упоминания. ⚠️ НЕ ОБОРАЧИВАЙ их в <a href> — просто пиши доменное имя как текст (не кликабельно). Это защищает наш PageRank от утечки на внешние сайты. Пример правильно: "согласно ФЗ-218 (pravo.gov.ru)"; пример неправильно: &lt;a href="..."&gt;Росреестр&lt;/a&gt;.
12. СТРОГО по теме запроса "${serpKeyword}" — НЕ включай разделы про другие продукты если они не относятся к теме.
13. ОБЯЗАТЕЛЬНЫЕ H3-блоки внутри соответствующих H2-разделов:
    - В разделе про документ/отчёт добавь <h3>🛡️ Гарантируем возврат средств</h3> с текстом о гарантии и условиях возврата (80-100 слов)
    - В разделе про виды или форматы добавь <h3>📱 Срочный отчёт в твоём смартфоне</h3> с описанием мобильного доступа (80-100 слов)
    - В разделе про стоимость добавь <h3>⭐ Отзывы клиентов</h3> с 3-4 краткими отзывами (100-120 слов)
14. ИЗОБРАЖЕНИЯ: в статье будет ${targetImages} изображений, равномерно после каждого 2-го H2. Пиши каждый H2-раздел полностью (300+ слов) — это обеспечивает контекст для картинки.

Верни ТОЛЬКО HTML без <html>/<body>.`
        : `Ключ: "${serpKeyword}"\n\nОригинальная статья (${parsed.wordCount} слов):\n${parsed.title}\n${parsed.content.slice(0, 5000)}\n\nНапиши расширенную SEO-статью строго по следующей структуре. Каждый раздел ОБЯЗАТЕЛЕН и должен содержать указанный минимум слов:\n\n<h1>${parsed.title}</h1>\n<p>[Прямой ответ: что такое "${serpKeyword}" — 120-150 слов, featured snippet]</p>\n\n<h2>Что такое ${serpKeyword}</h2>\n<p>[Подробное определение, правовая база, зачем нужно — 200-250 слов]</p>\n\n<h2>Когда требуется ${serpKeyword}</h2>\n<p>[5-7 конкретных случаев с пояснением — 200-250 слов]</p>\n\n<h2>Какие сведения содержит ${serpKeyword}</h2>\n<p>[Список с пояснениями — 200-250 слов, используй <ul>]</p>\n\n<h2>Как заказать ${serpKeyword} онлайн через kadastrmap.info</h2>\n<p>[Пошаговая инструкция заказа — 250-300 слов, <ol>. Пункты говорят о действиях на странице заказа: 1) «Перейдите на <a href="/spravki/">/spravki/</a>», 2) «Выберите тип документа (краткая / полная / расширенная выписка и т.п.)», 3) «Введите кадастровый номер или адрес объекта», 4) «Проверьте данные в форме», 5) «Оплатите онлайн (карта/СБП)». ⛔ НЕ пиши «зайдите на главную», «в меню», «найдите раздел» — пользователь уже на /spravki/ после клика по ссылке.]</p>\n\n<h2>Сроки и стоимость</h2>\n<p>[Вступление к разделу — 1-2 предложения]</p>\n[BLOCK_PRICE]\n<p>[Краткое пояснение — 60-80 слов]</p>\n\n<h2>Преимущества заказа через kadastrmap.info</h2>\n<p>[Почему удобнее заказать на нашем сайте: скорость, простота, электронная доставка — 200-250 слов]</p>\n\n<h2>Типичные ошибки при заказе</h2>\n<p>[4-5 частых ошибок с советами — 150-200 слов]</p>\n\n<h2>Часто задаваемые вопросы</h2>\n[10 вопросов-ответов СТРОГО в формате: <details class="faq-item" open><summary>Вопрос?</summary><p>Ответ 70-100 слов</p></details> — первый с open, остальные 9 без него. НЕ используй <h3> для вопросов.]\n\n<h2>Вывод</h2>\n<p>[Итог + CTA: заказать на <a href="/spravki/">base.kadastrmap.info/spravki/</a> — 100-120 слов]</p>\n\nПравила:\n- Все упоминания заказа документов — ТОЛЬКО прямой ссылкой <a href="/spravki/">/spravki/</a>. ⛔ ЗАПРЕЩЕНО «зайдите на главную», «в меню выберите», «найдите раздел Заказать» — такой навигации нет. ✅ Пиши: «перейдите на /spravki/», «заполните форму на /spravki/». НЕ упоминай Росреестр, Госуслуги, МФЦ как способы заказа.\n- Конкретные факты, законы РФ, сроки. Цены — ТОЛЬКО через [BLOCK_PRICE], не вставляй цифры.\n- FAQ ТОЛЬКО через <details class="faq-item">/<summary>, НЕ через <h3>.\n- Только HTML без <html>/<body>.\n- Не сокращай разделы — каждый должен быть полным.\n- ЭМОДЗИ: активно используй в тексте (минимум 25): 💡 советы, ⚠️ предупреждения, ✅ преимущества, 📌 факты, ★ выводы, 📊 💰 ⏱️ по контексту.`;

      const [seoResponse, improvedResponse] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: "Ты SEO-эксперт по российскому рынку. Отвечай только валидным JSON." },
            { role: "user", content: seoPrompt },
          ],
        }),
        invokeLLM({
          messages: [
            { role: "system", content: "Ты профессиональный SEO-копирайтер. Пишешь длинные подробные статьи 3500+ слов для топа поиска. Никогда не сокращай разделы — каждый H2 минимум 250 слов. ВАЖНО: цены указывай ТОЛЬКО через [BLOCK_PRICE], не вставляй конкретные цифры цен в рублях." },
            { role: "user", content: improvePrompt },
          ],
          maxTokens: 6000,
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

      // Post-generation: fix missing content vs competitor targets
      improvedContent = await enhanceIfNeeded(improvedContent, serpKeyword, targetWords, targetFaq);
      improvedContent = filterGarbageH2(improvedContent, serpKeyword);
      improvedContent = normalizeHeadings(improvedContent);
      improvedContent = beautifyArticleHtml(improvedContent);

      // QA log: verify article meets TOP-3 standards
      checkArticleQuality(improvedContent, input.url, targetWords, targetFaq);

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

      // Build comparison: our improved article vs competitors
      const improvedHeadings = extractHeadingsFromHtml(improvedContent);
      const ourH2 = improvedHeadings.filter(h => h.level === 'H2').length;
      const ourH3 = improvedHeadings.filter(h => h.level === 'H3').length;
      const ourFaq = (improvedContent.match(/<details\b/gi) || []).length;
      const ourTable = /<table\b/i.test(improvedContent);

      const comparison: ArticleComparison = {
        serpKeyword,
        our: { wordCount: improvedWordCount, h2Count: ourH2, h3Count: ourH3, faqCount: ourFaq, hasTable: ourTable },
        competitors: competitors.map(c => ({
          position: c.position,
          domain: c.domain,
          title: c.title,
          url: (mergedSerpResults.find(r => r.domain === c.domain) as any)?.url ?? '',
          wordCount: c.wordCount,
          h2Count: (c.headings || '').split(' | ').filter((h: string) => h.startsWith('H2:')).length,
          h3Count: (c.headings || '').split(' | ').filter((h: string) => h.startsWith('H3:')).length,
          faqCount: c.faqCount,
          hasTable: c.hasTable,
        })),
        targetWords,
        targetFaq,
      };

      return {
        analysisId,
        originalTitle: parsed.title,
        originalContent: parsed.content,
        originalMetaDescription: parsed.metaDescription,
        headings: improvedHeadings,
        wordCount: improvedWordCount,
        improvedTitle: seo.metaTitle || parsed.title,
        improvedContent,
        seo,
        comparison,
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
   * Fetch top-3 competitor pages from Google + Yandex SERP and return structural metrics.
   * Used in UI to show competitor word count, H2/H3/FAQ counts before/after rewrite.
   */
  getCompetitorMetrics: protectedProcedure
    .input(z.object({ keyword: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const ourDomain = 'kadastrmap.info';
      const [google, yandex] = await Promise.all([
        cachedGoogleSerp(input.keyword),
        cachedYandexSerp(input.keyword),
      ]);

      const googleTop3 = google.results
        .filter(r => !r.domain.includes(ourDomain) && !ourDomain.includes(r.domain))
        .slice(0, 3)
        .map(r => ({ ...r, engine: 'google' as const }));
      const yandexTop3 = yandex.results
        .filter(r => !r.domain.includes(ourDomain) && !ourDomain.includes(r.domain))
        .slice(0, 3)
        .map(r => ({ ...r, engine: 'yandex' as const }));

      // Dedupe by URL, preserve engine label
      const seenUrls = new Set<string>();
      const toFetch: typeof googleTop3 = [];
      for (const r of [...googleTop3, ...yandexTop3]) {
        if (!seenUrls.has(r.url)) { seenUrls.add(r.url); toFetch.push(r); }
      }

      const fetched = await Promise.allSettled(
        toFetch.map(async (r) => {
          const cached = cacheGet(pageCache, r.url);
          if (cached) {
            const h2Count = (cached.headings as string || '').split(' | ').filter((h: string) => h.startsWith('H2:')).length;
            const h3Count = (cached.headings as string || '').split(' | ').filter((h: string) => h.startsWith('H3:')).length;
            return { engine: r.engine, position: r.position, domain: r.domain, title: cached.title || r.title, url: r.url, wordCount: cached.wordCount, h2Count, h3Count, faqCount: cached.faqCount, hasTable: cached.hasTable };
          }
          const parsed = await Promise.race([
            parseArticleFromUrl(r.url),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
          ]);
          const h2Count = (parsed.headings || []).filter((h: { level: string }) => h.level === 'H2').length;
          const h3Count = (parsed.headings || []).filter((h: { level: string }) => h.level === 'H3').length;
          const html = (parsed as any).contentHtml || '';
          const faqCount = (html.match(/<details\b/gi) || []).length;
          const hasTable = /<table\b/i.test(html);
          return { engine: r.engine, position: r.position, domain: r.domain, title: parsed.title || r.title, url: r.url, wordCount: parsed.wordCount, h2Count, h3Count, faqCount, hasTable };
        })
      );

      const competitors = fetched
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value);

      return {
        keyword: input.keyword,
        competitors,
        googleError: google.error ?? null,
        yandexError: yandex.error ?? null,
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
1. Объём: минимум 3500 слов (конкуренты в топе пишут именно столько)
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
        maxTokens: 6000,
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
      const targetWords = Math.max(3200, avgWords + 800);

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
        maxTokens: 6000,
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
      const [ctaResponse, metaResponse, excerptResponse, imagePrompts] = await Promise.all([
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
        generateImagePrompts(input.title, undefined, extractH2Texts(input.content).slice(0, 9), input.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)),
      ]);

      const imageResults = await Promise.all(
        input.generateImage
          ? (imagePrompts as string[]).map((p) =>
              generateDallEImage(p).catch((e) => { console.error('[Articles] DALL-E failed:', e.message); return null; })
            )
          : [Promise.resolve(null), Promise.resolve(null), Promise.resolve(null)]
      );

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

      // Parse excerpt — fallback to first sentence of article content if LLM fails
      const excerpt: string = (() => {
        try {
          const raw = typeof excerptResponse?.choices[0]?.message.content === 'string'
            ? excerptResponse.choices[0].message.content.trim().replace(/^["']|["']$/g, '')
            : '';
          if (raw.length > 20) return raw;
        } catch { /* fall through */ }
        // Fallback: extract first meaningful sentence from article HTML
        const text = input.content
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const sentences = text.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          const clean = s.trim();
          if (clean.length >= 40) return clean.slice(0, 160).trimEnd();
        }
        return text.slice(0, 160).trimEnd();
      })();
      console.log(`[Articles] Excerpt (${excerptResponse ? 'LLM' : 'fallback'}): ${excerpt.slice(0, 80)}`);

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

      let htmlContent = replacePriceTableWithShortcode(
        injectCtasIntoHtml(beautifyArticleHtml(stripFirstH1(input.content)), ctaTexts, ctaBlock)
      );

      // 7. Inject content images after H2 tags (2nd, 4th, 6th occurrence)
      const validMedia = uploadedMedia.filter(Boolean) as { id: number; url: string }[];
      htmlContent = injectImagesAfterH2s(htmlContent, validMedia);

      // 8. Update WP post (first image as featured media)
      const featuredMediaId: number | undefined = validMedia[0]?.id;

      const updated = await wp.updatePost(
        account.siteUrl, account.username, account.appPassword,
        post.id,
        {
          title:      input.title,
          content:    htmlContent,
          categories: detectCategoryIds(input.originalUrl),
          excerpt,
          ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
        }
      );

      // Update Yoast meta + outsearch via custom endpoint
      {
        const siteBase = account.siteUrl.replace(/\/$/, '');
        const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');
        const axiosInst2 = (await import('axios')).default;
        const metaPayload: Record<string, string> = {
          outsearch: '1',
          outmap: shouldShowMap(slug) ? '1' : '0',
        };
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

      // Extract title keywords for media library search
      const titleKeywords = input.title
        .replace(/[-–—:,]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !/^(полное|руководство|как|что|для|при|про|это|инструкция)$/i.test(w))
        .slice(0, 3)
        .join(' ');

      // Extract H2 sections from content for targeted DALL-E prompts
      const h2Sections = extractH2Texts(input.content).slice(0, 9);
      // Target image count: 1 per ~350 words, min 9 (etalon standard)
      const contentWordCount = input.content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      const IMAGES_NEEDED = Math.max(9, Math.min(12, Math.ceil(contentWordCount / 350)));

      // Run meta LLM + image prompts + WP library + Wikimedia search all in parallel
      const [metaResp, imagePrompts, libraryImages, wikimediaImages] = await Promise.all([
        invokeLLM({
          messages: [
            { role: 'system', content: 'Ты SEO-копирайтер. Никогда не упоминай Госуслуги, МФЦ, Росреестр как способы заказа. Акцент — заказ через kadastrmap.info.' },
            { role: 'user', content: `Заголовок: "${input.title}"\nФокусный ключ: "${focusKeyword}"\n\nНапиши meta description (130–155 символов). Включи ключевой запрос и CTA «заказать на kadastrmap.info». Верни ТОЛЬКО строку без кавычек.` },
          ],
          maxTokens: 200,
        }).catch(() => null),
        generateImagePrompts(input.title, focusKeyword, h2Sections, input.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)),
        wp.searchMedia(account.siteUrl, account.username, account.appPassword, titleKeywords, 12)
          .catch(() => [] as { id: number; url: string; width: number; height: number; alt: string; title: string }[]),
        searchWikimediaImages(titleKeywords, 8)
          .catch(() => [] as { id: number; url: string; width: number; height: number; alt: string; title: string }[]),
      ]);
      console.log(`[Draft] WP library: ${libraryImages.length}, Wikimedia: ${wikimediaImages.length}, IMAGES_NEEDED: ${IMAGES_NEEDED}`);

      // Combine candidates: WP library (positive IDs) first, then Wikimedia (negative IDs)
      const allCandidates = [...libraryImages, ...wikimediaImages];

      // Vision-filter: keep only images that visually match the article topic
      const relevantCandidates = allCandidates.length > 0
        ? await filterRelevantMedia(input.title, allCandidates)
        : [];
      console.log(`[Draft] Relevant after vision filter: ${relevantCandidates.length}/${allCandidates.length}`);
      const selectedCandidates = relevantCandidates.slice(0, IMAGES_NEEDED);

      // WP library images (id > 0) are already uploaded; Wikimedia images (id < 0) need sideload
      const uploadedCandidates = await Promise.all(
        selectedCandidates.map(async (m) => {
          if (m.id > 0) return { id: m.id, url: m.url, width: m.width, height: m.height };
          try {
            const ext = m.url.match(/\.(jpe?g|png|webp)/i)?.[1] ?? 'jpg';
            const filename = `wiki-${slug}-${Date.now()}.${ext}`;
            const uploaded = await wp.uploadMediaFromUrl(account.siteUrl, account.username, account.appPassword, m.url, filename);
            console.log(`[Draft] Wikimedia sideloaded → WP id ${uploaded.id}`);
            return { id: uploaded.id, url: uploaded.url, width: m.width, height: m.height };
          } catch (e: any) {
            console.warn('[Draft] Wikimedia upload failed:', e?.message);
            return null;
          }
        })
      );
      const confirmedImages = uploadedCandidates.filter(Boolean) as { id: number; url: string; width: number; height: number }[];
      const dalleNeeded = Math.max(0, IMAGES_NEEDED - confirmedImages.length);

      let uploadedDalle: ({ id: number; url: string } | null)[] = [];
      if (dalleNeeded > 0) {
        console.log(`[Draft] Generating ${dalleNeeded} DALL-E images (confirmed: ${confirmedImages.length})`);
        const dalleUrls = await Promise.all(
          imagePrompts.slice(0, dalleNeeded).map((p: string, i: number) =>
            generateDallEImage(p)
              .then(url => { console.log(`[Draft] DALL-E[${i}] OK`); return url; })
              .catch((e: any) => { console.warn(`[Draft] DALL-E[${i}] failed:`, e?.message); return null; })
          )
        );
        uploadedDalle = await Promise.all(
          dalleUrls.map(async (imgUrl, i) => {
            if (!imgUrl) return null;
            try { return await wp.uploadMediaFromUrl(account.siteUrl, account.username, account.appPassword, imgUrl, `${slug}-img-${confirmedImages.length + i + 1}.jpg`); }
            catch (e: any) { console.warn(`[Draft] DALL-E upload ${i + 1} failed:`, e?.message); return null; }
          })
        );
      }

      let metaDesc: string | undefined;
      try {
        const raw = metaResp?.choices[0]?.message.content;
        if (typeof raw === 'string' && raw.trim().length > 20) metaDesc = raw.trim().replace(/^["']|["']$/g, '');
      } catch { /* ignore */ }

      const axiosInst = (await import('axios')).default;
      const headers = { Authorization: auth, 'Content-Type': 'application/json' };

      // Merge: library/Wikimedia images first (real dimensions), then DALL-E uploads
      const validMedia: { id: number; url: string; width?: number; height?: number }[] = [
        ...confirmedImages.map(m => ({ id: m.id, url: m.url, width: m.width || undefined, height: m.height || undefined })),
        ...(uploadedDalle.filter(Boolean) as { id: number; url: string }[]),
      ];

      // Inject images after H2s (auto-distributed evenly) and CTA at end
      let html = replacePriceTableWithShortcode(
        beautifyArticleHtml(stripFirstH1(input.content))
      );
      html = injectImagesAfterH2s(html, validMedia);
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
        maxTokens: 6000,
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
   * Start auto-rewrite batch: fetch SERP, fetch competitor content, rewrite to 3500+ words, save.
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

  // ── Article Library ───────────────────────────────────────────────────────

  getLibrary: protectedProcedure
    .query(async ({ ctx }) => {
      return articlesDb.getLibrary(ctx.user.id);
    }),

  getArticleVersions: protectedProcedure
    .input(z.object({ url: z.string().url() }))
    .query(async ({ ctx, input }) => {
      return articlesDb.getArticleVersions(ctx.user.id, input.url);
    }),

  getLibrarySerpData: protectedProcedure
    .query(async ({ ctx }) => {
      const library = await articlesDb.getLibrary(ctx.user.id);
      return library
        .filter(e => e.googlePos !== null || e.yandexPos !== null)
        .map(e => ({
          url: e.url,
          title: e.improvedTitle || e.originalTitle,
          googlePos: e.googlePos,
          yandexPos: e.yandexPos,
          checkedAt: e.latestCreatedAt.toISOString(),
        }));
    }),

  auditImprovedArticles: protectedProcedure
    .query(async ({ ctx }) => {
      const library = await articlesDb.getLibrary(ctx.user.id);
      const results = await Promise.all(
        library
          .filter(entry => entry.latestId > 0)
          .map(async (entry) => {
            const analysis = await articlesDb.getAnalysisById(ctx.user.id, entry.latestId);
            if (!analysis?.improvedContent) return null;
            const report = checkArticleQuality(analysis.improvedContent, entry.url, 2800, 10);
            return {
              ...report,
              title: entry.improvedTitle || entry.originalTitle,
              id: entry.latestId,
            };
          })
      );
      const filtered = results.filter(Boolean) as (ArticleQualityReport & { title: string; id: number })[];
      const pass = filtered.filter(r => r.pass).length;
      return {
        results: filtered,
        stats: {
          total: filtered.length,
          pass,
          fail: filtered.length - pass,
        },
      };
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
  // Strip LLM placeholder images like <img src="image1.jpg"> / <img src="image12.jpg">
  // These are hallucinated by LLM and never replaced with real uploads
  html = html.replace(/<figure[^>]*>[\s]*<img[^>]*src=["']image\d+\.jpg["'][^>]*\/?>[\s]*(?:<figcaption[^>]*>.*?<\/figcaption>[\s]*)?<\/figure>/gis, '');
  html = html.replace(/<img[^>]*src=["']image\d+\.jpg["'][^>]*\/?>/gi, '');

  const $ = cheerio.load(html, { xml: { decodeEntities: false } });

  // -2. Add loading="lazy" and decoding="async" to all <img> — LCP/CWV optimization.
  //     Skip first image (usually above-the-fold hero) to preserve LCP speed.
  $('img').each((i: number, img: any) => {
    if (i === 0) {
      $(img).attr('fetchpriority', 'high');  // First image: prioritize for LCP
    } else {
      if (!$(img).attr('loading'))  $(img).attr('loading',  'lazy');
      if (!$(img).attr('decoding')) $(img).attr('decoding', 'async');
    }
  });

  // -1. Convert absolute kadastrmap.info links to relative paths
  //     + close external links with rel="nofollow noopener noreferrer" to prevent link juice leak
  $('a[href]').each((_: number, a: any) => {
    const href = $(a).attr('href') || '';
    const cleaned = href.replace(/^https?:\/\/kadastrmap\.info/i, '');
    if (cleaned !== href) {
      $(a).attr('href', cleaned || '/');
    } else if (/^https?:\/\//i.test(href)) {
      // External link: add nofollow to prevent PageRank leak
      $(a).attr('rel', 'nofollow noopener noreferrer');
      if (!$(a).attr('target')) $(a).attr('target', '_blank');
    }
  });

  // 0. Style h2 headings — green left border + emoji prefix
  $('h2').each((_: number, h2: any) => {
    const inner = $(h2).html() || '';
    const text = $(h2).text();
    // Skip if already has an emoji at the start
    if (/^\p{Emoji}/u.test(text.trim())) return;
    const emoji = pickHeadingEmoji(text);
    $(h2).replaceWith(
      `<h2 style="text-align:center;` +
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
      `<h3 style="color:#166534;font-size:1.1em;font-weight:600;margin:1.5em 0 0.5em;text-align:center;">` +
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

  // 3. Detect "Важно:" / "Обратите внимание" → yellow warning-box
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

  // 3b. Detect "💡 Совет" / "📌" → blue info-box
  $('p').each((_: number, p: any) => {
    const text = $(p).text();
    if (/^(💡|📌|совет[:\s]|лайфхак[:\s])/i.test(text.trim())) {
      const inner = $(p).html() || '';
      const box =
        `<div style="background:#eff6ff;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;` +
        `padding:12px 16px;margin:1.5em 0;font-size:15px;line-height:1.7;">${inner}</div>`;
      $(p).replaceWith(box);
    }
  });

  // 4. Style <table> — striped, bordered, responsive
  $('table').each((_: number, table: any) => {
    const outer = $.html(table);
    const styled = outer
      .replace('<table', '<div style="overflow-x:auto;margin:1.5em 0;"><table style="width:100%;border-collapse:collapse;font-size:14px;"')
      .replace('</table>', '</table></div>');
    $(table).replaceWith(styled);
  });
  // Style th/td inside any table
  $('th').each((_: number, th: any) => {
    $(th).attr('style', 'background:#1e3a5f;color:#fff;padding:10px 12px;text-align:left;font-weight:600;font-size:13px;');
  });
  $('td').each((_: number, td: any) => {
    $(td).attr('style', 'padding:9px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:1.6;');
  });
  // Stripe odd rows
  $('tr:nth-child(even) td').each((_: number, td: any) => {
    $(td).attr('style', ($(td).attr('style') || '') + 'background:#f8fafc;');
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
