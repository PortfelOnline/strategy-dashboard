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
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ContentAnalyzer/1.0)' },
    timeout: 30000,
  });

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
const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (compatible; ContentAnalyzer/1.0)',
];

export async function parseArticleFromUrl(url: string): Promise<ParsedArticle> {
  let lastError: any;
  for (let attempt = 0; attempt < UA_LIST.length; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': UA_LIST[attempt],
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
        },
        timeout: 45000,
        maxRedirects: 5,
      });
      return parseHtml(url, response.data as string);
    } catch (err: any) {
      lastError = err;
      console.warn(`[articleParser] attempt ${attempt + 1} failed for ${url}: ${err?.message}`);
    }
  }
  throw lastError;
}

function parseHtml(url: string, html: string): ParsedArticle {
  const $ = cheerio.load(html);

  // Remove noise — keep <header> because WP puts <h1 class="entry-title"> inside it
  $('script, style, nav, footer, aside, .sidebar, .menu, .navigation, .ad, .advertisement, .comments, .comment-form, iframe, noscript, #masthead, .site-header, header.site-header, #colophon').remove();

  // Title
  const title =
    $('h1').first().text().trim() ||
    $('title').text().trim() ||
    'Без заголовка';

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
