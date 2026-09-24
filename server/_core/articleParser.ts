import axios from 'axios';
import * as cheerio from 'cheerio';

export interface CatalogArticle {
  url: string;
  title: string;
}

export interface CatalogPage {
  articles: CatalogArticle[];
  totalPages: number;
  scannedPages: number;
}

/**
 * Fetch one listing page and extract article links
 */
function isValidArticleTitle(title: string): boolean {
  const lower = title.toLowerCase();
  if (lower.includes('читать дальше') || lower.includes('read more')) return false;
  if (/^[→←\s.]+$/.test(title)) return false;
  if (title.length < 5) return false;
  return true;
}

async function fetchListingPage(url: string): Promise<{ articles: CatalogArticle[]; totalPages: number }> {
  const opts = {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentAnalyzer/1.0)' },
    timeout: 30000,
  };
  let response;
  try {
    response = await axios.get(url, opts);
  } catch (e: any) {
    // 🚨 25.08.2026: изнутри контейнера у 100zem.ru не поднят TLS (ECONNREFUSED на :443),
    // из-за чего скан каталога падал и батч получал 1 кандидата вместо 10. Адреса статей
    // берутся из разметки самой страницы, поэтому протокол пробы на них не переносится.
    const viaHttp = url.replace(/^https:\/\//i, 'http://');
    if (viaHttp === url) throw e;
    response = await axios.get(viaHttp, opts);
  }

  const $ = cheerio.load(response.data as string);
  const articles: CatalogArticle[] = [];

  // Primary selector for kadastrmap.info
  $('div.article-entry h3 a').each((_, el) => {
    const href = $(el as any).attr('href') || '';
    const title = $(el as any).text().trim();
    if (href && title && isValidArticleTitle(title)) {
      const fullUrl = href.startsWith('http') ? href : new URL(href, url).toString();
      articles.push({ url: fullUrl, title });
    }
  });

  // Fallback: generic article link selectors
  if (articles.length === 0) {
    $('h2 a, h3 a, .entry-title a, .post-title a').each((_, el) => {
      const href = $(el as any).attr('href') || '';
      const title = $(el as any).text().trim();
      if (href && title && isValidArticleTitle(title) && href.includes('/kadastr/')) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, url).toString();
        if (!articles.find(a => a.url === fullUrl)) {
          articles.push({ url: fullUrl, title });
        }
      }
    });
  }

  // Detect total pages from pagination
  let totalPages = 1;
  const pageLinks: number[] = [];
  $('a[href*="/page/"]').each((_, el) => {
    const href = $(el as any).attr('href') || '';
    const match = href.match(/\/page\/(\d+)\//);
    if (match) pageLinks.push(parseInt(match[1], 10));
  });
  if (pageLinks.length > 0) totalPages = Math.max(...pageLinks);

  return { articles, totalPages };
}

/**
 * Build paginated URL for a catalog
 * e.g. https://kadastrmap.info/kadastr/ → https://kadastrmap.info/kadastr/page/2/
 */
function buildPageUrl(baseUrl: string, page: number): string {
  if (page === 1) return baseUrl;
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/page/${page}/`;
}

/**
 * Scan a catalog listing page (optionally multiple pages, with startPage support)
 */
export async function scanCatalog(baseUrl: string, maxPages = 1, startPage = 1): Promise<CatalogPage> {
  // Always fetch page 1 first to get totalPages
  const first = await fetchListingPage(baseUrl);
  const totalPages = first.totalPages;

  const allArticles: CatalogArticle[] = startPage === 1 ? [...first.articles] : [];
  const endPage = Math.min(startPage + maxPages - 1, totalPages);
  const fromPage = startPage === 1 ? 2 : startPage;

  // Fetch pages in parallel batches of 5
  for (let p = fromPage; p <= endPage; p += 5) {
    const batch: Promise<{ articles: CatalogArticle[]; totalPages: number }>[] = [];
    for (let i = p; i < p + 5 && i <= endPage; i++) {
      batch.push(fetchListingPage(buildPageUrl(baseUrl, i)));
    }
    const results = await Promise.allSettled(batch);
    for (const r of results) {
      if (r.status === 'fulfilled') allArticles.push(...r.value.articles);
    }
  }

  return {
    articles: allArticles,
    totalPages,
    scannedPages: endPage - startPage + 1,
  };
}

export interface ParsedArticle {
  url: string;
  title: string;
  content: string;   // plain text
  contentHtml: string; // cleaned HTML (article body only)
  metaDescription: string;
  headings: { level: string; text: string }[];
  wordCount: number;
}

/**
 * Fetch a URL and extract article content using cheerio
 */
// 2026-04-20: расширен пул UA + Yandex Browser для рус. сайтов.
// Убран "ContentAnalyzer/1.0" — обнаружитель блокирует.
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/25.1.0.0 Yowser/2.5 Safari/537.36',
];

// Домены которые ВСЕГДА timeout'ятся (server-side rendered, старый CMS, либо анти-бот):
// тратить на них 3×25=75 сек бесполезно, шансы спарсить ~0%. Skip immediately.
const SLOW_DOMAINS = [
  'rosreestr.gov.ru',       // госпортал, 15-30 сек server-side render
  'mos.ru',                 // то же + очень агрессивный anti-bot
  'gosuslugi.ru',           // госпортал с JS-redirect
  'pgu2.mos.ru',
  'www.gosuslugi.ru',
];

// 🚨 2026-08-02: наши же страницы нельзя тянуть по публичному https. Маршрут
// n → proxy4 → туннель → n рвёт большие тела (13–23 КБ) и держит соединение до
// таймаута → axios «aborted». Страдали самые крупные статьи, а это ровно денежные
// (ЕГРН/выписки/справки, 160–176 КБ) — они падали каждую ночь и не улучшались.
// Origin отдаёт ту же страницу целиком за миллисекунды.
export function toOriginFetch(url: string): { url: string; host?: string } {
  const base = process.env.SELF_ORIGIN_BASE;            // напр. http://167.86.116.15:8082
  if (!base) return { url };
  try {
    const u = new URL(url);
    const hosts = (process.env.SELF_ORIGIN_HOSTS || '100zem.ru,www.100zem.ru')
      .split(',').map(h => h.trim().replace(/^www\./, '')).filter(Boolean);
    if (!hosts.includes(u.hostname.replace(/^www\./, ''))) return { url };
    return { url: base.replace(/\/$/, '') + u.pathname + u.search, host: u.hostname };
  } catch { return { url }; }
}

// Заголовки, которые нельзя пускать в генерацию: это не тема, а признак того,
// что страница не отдалась (500, JS-рендер, заглушка).
// 🚨 Не \b на конце: в JS \b считает границу по [A-Za-z0-9_], для кириллицы её нет —
// «Без заголовка: …» мимо. Отсечка через (?![\p{L}\p{N}]) с флагом u.
const PLACEHOLDER_TITLE_RE = /^\s*(без\s+заголовка|untitled|no\s+title|document|新規)(?![\p{L}\p{N}])/iu;

export function isOwnUrl(url: string): boolean {
  try {
    const hosts = (process.env.SELF_ORIGIN_HOSTS || '100zem.ru,www.100zem.ru')
      .split(',').map(h => h.trim().replace(/^www\./, '')).filter(Boolean);
    return hosts.includes(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

export function isUsableTitle(title: string): boolean {
  const t = String(title || '').trim();
  return t.length >= 8 && !PLACEHOLDER_TITLE_RE.test(t);
}

export async function parseArticleFromUrl(url: string): Promise<ParsedArticle> {
  // Skip punycode (cyrillic) домены — Node DNS нестабильно их резолвит (ENOTFOUND),
  // тратим 3 × 45s = 2.25 мин на попытки. Fail fast.
  try {
    const hostname = new URL(url).hostname;
    if (hostname.startsWith('xn--') || hostname.includes('.xn--')) {
      console.warn(`[articleParser] SKIP punycode domain: ${hostname}`);
      throw new Error(`punycode domain not supported: ${hostname}`);
    }
    if (SLOW_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) {
      console.warn(`[articleParser] SKIP slow domain: ${hostname}`);
      throw new Error(`slow domain bypassed: ${hostname}`);
    }
  } catch (e: any) {
    if (e.message?.includes('punycode') || e.message?.includes('slow domain')) throw e;
    // если URL.parse упал — пускай axios вернёт нормальную ошибку
  }

  let lastError: any;
  // Shuffle UA per call, чтобы cian/avito не запоминали "наш" первый UA.
  const uas = [...UA_LIST].sort(() => Math.random() - 0.5);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const target = toOriginFetch(url);
      const response = await axios.get(target.url, {
        headers: {
          ...(target.host ? { Host: target.host } : {}),
          'User-Agent': uas[attempt],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 25000, // было 45000 — Cian/Avito либо отвечают быстро, либо 403/429
        maxRedirects: 5,
        // 🚨 Origin отдаёт 301 на канонический адрес, СОХРАНЯЯ порт 8082 — редирект уводил
        // на http://100zem.ru:8082, то есть на публичный IP прокси, где этот порт закрыт
        // (ECONNREFUSED 161.104.16.26:8082). Держим переходы на origin.
        beforeRedirect: (opts: any) => {
          if (!target.host) return;
          try {
            const base = new URL(target.url);
            if (opts.hostname && opts.hostname !== base.hostname) {
              opts.hostname = base.hostname;
              opts.host = base.host;
              opts.port = base.port || opts.port;
              opts.protocol = base.protocol;
              if (opts.headers) opts.headers.Host = target.host;
            }
          } catch { /* оставляем как есть */ }
        },
        validateStatus: (s) => s < 400,
        proxy: false, // фетчить напрямую (датацентр-прокси мёртв → таймауты 0/3 конкурентов; домашний IP лучше для скрейпинга)
      });
      const parsed = parseHtml(url, response.data as string);
      // Свою страницу без внятного заголовка в генерацию не отдаём: её title
      // становится темой статьи, и пайплайн уходит писать «про без заголовка».
      if (isOwnUrl(url) && !isUsableTitle(parsed.title)) {
        console.error(
          `[articleParser] свой URL без пригодного заголовка: ${url} ` +
          `(title=${JSON.stringify(parsed.title)}, h1=${parsed.headings.filter(h => h.level === 'H1').length}, ` +
          `words=${parsed.wordCount}) — отказ вместо мусорной темы`
        );
        const titleError: any = new Error(`unusable title for own page: ${url}`);
        titleError.noRetry = true; // не сеть — повтор даст тот же результат
        throw titleError;
      }
      return parsed;
    } catch (err: any) {
      lastError = err;
      if (err?.noRetry) throw err;
      // 401/403/429 — сайт нас блокирует, повтор не поможет, bail early
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 429) {
        console.warn(`[articleParser] ${status} blocked ${url} — bailout`);
        throw err;
      }
      console.warn(`[articleParser] attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for ${url}: ${err?.message?.slice(0, 80)}`);
    }
  }
  throw lastError;
}

function parseHtml(url: string, html: string): ParsedArticle {
  const $ = cheerio.load(html);

  // Remove noise — keep <header> because WP puts <h1 class="entry-title"> inside it
  $('script, style, nav, footer, aside, .sidebar, .menu, .navigation, .ad, .advertisement, .comments, .comment-form, iframe, noscript, #masthead, .site-header, header.site-header, #colophon').remove();

  // Title. Никакого placeholder-фолбэка: пустой заголовок должен быть виден
  // вызывающему коду как пустой, иначе он уезжает темой в генерацию статьи.
  const title =
    $('h1').first().text().trim() ||
    ($('meta[property="og:title"]').attr('content') || '').trim() ||
    $('title').text().trim() ||
    '';

  // Meta description
  const metaDescription =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  // Try to find main article body
  const contentSelectors = [
    'article',
    '.entry-content',
    '.post-content',
    '.article-content',
    '.article-body',
    '#content-area',
    'main',
    '.content',
    '#content',
  ];

  let $content: cheerio.Cheerio<any> | null = null;
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length > 0) {
      $content = el.first();
      break;
    }
  }

  const contentHtml = $content ? $content.html() || '' : $('body').html() || '';
  const contentText = ($content ? $content.text() : $('body').text())
    .replace(/\s+/g, ' ')
    .trim();

  // Extract headings
  const headings: { level: string; text: string }[] = [];
  $('h1, h2, h3, h4').each((_, el) => {
    const tagName = (el as any).tagName ?? (el as any).name ?? 'h2';
    headings.push({
      level: String(tagName).toUpperCase(),
      text: $(el as any).text().trim(),
    });
  });

  const wordCount = contentText.split(/\s+/).filter(Boolean).length;

  return {
    url,
    title,
    content: contentText,
    contentHtml,
    metaDescription,
    headings,
    wordCount,
  };
}
