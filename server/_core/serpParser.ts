import * as nodeFs from 'fs';
import * as nodePath from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fetchPageHtml } from './browser';
import { getRandomWorkingProxy, banProxy } from '../bots';

export interface SerpResult {
  position: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface SerpData {
  engine: 'google' | 'yandex';
  keyword: string;
  results: SerpResult[];
  error?: string;
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function fetchHtmlAxios(url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const response = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, ...extraHeaders },
    timeout: 15000,
    maxRedirects: 5,
    decompress: true,
    responseType: 'text',
  });
  return response.data as string;
}

async function fetchHtml(url: string): Promise<string> {
  try {
    return await fetchPageHtml(url, 1500);
  } catch (err: any) {
    console.warn('[SERP] Puppeteer failed, falling back to axios:', err?.message);
    return fetchHtmlAxios(url);
  }
}

function parseProxy(proxy: string): { host: string; port: number; username: string; password: string } | null {
  const m = proxy.match(/^([^:]+):([^@]+)@([^:]+):(\d+)$/);
  if (!m) return null;
  return { username: m[1], password: m[2], host: m[3], port: parseInt(m[4], 10) };
}

async function fetchHtmlViaProxy(url: string, proxy: string): Promise<string> {
  const p = parseProxy(proxy);
  if (!p) throw new Error('Invalid proxy format');
  const proxyUrl = `http://${p.username}:${p.password}@${p.host}:${p.port}`;
  const agent = new HttpsProxyAgent(proxyUrl);
  const response = await axios.get(url, {
    headers: BROWSER_HEADERS,
    timeout: 20000,
    maxRedirects: 5,
    decompress: true,
    responseType: 'text',
    proxy: false,
    httpsAgent: agent,
  });
  return response.data as string;
}

async function fetchSerpHtml(url: string, isCaptcha: (html: string) => boolean): Promise<string> {
  for (let i = 0; i < 3; i++) {
    const proxy = getRandomWorkingProxy();
    if (!proxy) break;
    try {
      const html = await fetchHtmlViaProxy(url, proxy);
      if (isCaptcha(html)) {
        banProxy(proxy);
        console.warn(`[SERP] CAPTCHA via proxy ${proxy.split('@')[1]} — banned, retrying`);
        continue;
      }
      return html;
    } catch (err: any) {
      console.warn(`[SERP] Proxy ${proxy.split('@')[1]} failed: ${err?.message}`);
    }
  }
  // No working proxies — fall back to direct request
  return fetchHtml(url);
}

const SERPAPI_KEY = process.env.SERPAPI_KEY;

async function fetchViaSerpApi(params: Record<string, string>): Promise<any> {
  if (!SERPAPI_KEY) throw new Error('SERPAPI_KEY not configured');
  const qs = new URLSearchParams({ ...params, api_key: SERPAPI_KEY, output: 'json' });
  const response = await axios.get(`https://serpapi.com/search?${qs}`, { timeout: 30000 });
  return response.data;
}

// Free SERP via self-hosted SearXNG (Google + Yandex metasearch with JSON API).
// Primary source — replaces the paid/timeout-prone Yandex Cloud API. Reached directly
// (its host is in NO_PROXY), never via the SERP proxy. Returns [] on failure so callers
// fall back to Puppeteer/Cloud. URL form: http://user:pass@host:8899
const SEARXNG_URL = process.env.SEARXNG_URL;

async function fetchSearxngSerp(keyword: string, engine: 'google' | 'yandex'): Promise<SerpData> {
  if (!SEARXNG_URL) return { engine, keyword, results: [], error: 'SEARXNG_URL not configured' };
  // 🚨 13.08.2026: SearXNG используем только под Яндекс. Раньше google-слот
  // подменялся на duckduckgo, но тот отдаёт CAPTCHA, и половина кандидатов
  // приходила пустой. Google берётся через свои API выше по цепочке
  // (fetchGoogleSerp: SerpApi/CSE), поэтому здесь просто выходим.
  if (engine !== 'yandex') {
    return { engine, keyword, results: [], error: 'searxng: google идёт через API' };
  }
  const engines = 'yandex';
  // Сколько страниц выдачи забираем. Одной не хватает: из ~18 кандидатов живыми
  // (не 401/403, не SLOW_DOMAINS) оказываются примерно пять, а конкурентов
  // разбираем десять.
  const SERP_PAGES = Number(process.env.SERP_PAGES ?? 2);

  try {
    const pages = await Promise.all(
      Array.from({ length: Math.max(1, SERP_PAGES) }, (_, i) =>
        axios.get(`${SEARXNG_URL.replace(/\/$/, '')}/search`, {
          params: { q: keyword, format: 'json', language: 'ru-RU', engines, pageno: i + 1 },
          timeout: 25000,
          proxy: false,
        }).catch(() => null),
      ),
    );

    const seen = new Set<string>();
    const raw: any[] = [];
    for (const resp of pages) {
      for (const r of (resp?.data?.results ?? [])) {
        const u = typeof r?.url === 'string' ? r.url : '';
        if (!u || seen.has(u)) continue;
        seen.add(u);
        raw.push(r);
      }
    }
    if (raw.length === 0) return { engine, keyword, results: [], error: 'searxng empty' };
    const results: SerpResult[] = raw
      .filter((r) => typeof r?.url === 'string' && r.url.startsWith('http'))
      .map((r, i) => ({
        position: Array.isArray(r.positions) && r.positions.length ? r.positions[0] : i + 1,
        title: cleanText(r.title || ''),
        url: r.url,
        domain: extractDomain(r.url),
        snippet: cleanText(r.content || '').slice(0, 300),
      }))
      .slice(0, 50);
    if (results.length > 0) return { engine, keyword, results };
    return { engine, keyword, results: [], error: 'searxng empty' };
  } catch (err: any) {
    console.warn(`[SERP] SearXNG (${engine}) error:`, err?.message);
    return { engine, keyword, results: [], error: 'searxng failed' };
  }
}

/**
 * Fetch Google search results via SerpAPI
 */
async function fetchGoogleSerpPuppeteer(keyword: string): Promise<SerpData> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=ru&gl=ru&num=20`;
  try {
    const html = await fetchPageHtml(url, 2000);
    const $ = cheerio.load(html);
    const results: SerpResult[] = [];
    $('div.g, div[data-sokoban-container]').each((i, el) => {
      const link = $(el).find('a[href^="http"]').first();
      const href = link.attr('href') || '';
      if (!href.startsWith('http') || href.includes('google.com')) return;
      const title = $(el).find('h3').first().text().trim();
      const snippet = $(el).find('.VwiC3b, [data-sncf] span').first().text().trim();
      results.push({ position: i + 1, title, url: href, domain: extractDomain(href), snippet: snippet.slice(0, 300) });
    });
    if (results.length > 0) return { engine: 'google', keyword, results: results.slice(0, 20) };
  } catch (err: any) {
    console.warn('[SERP] Puppeteer Google error:', err?.message);
  }
  return { engine: 'google', keyword, results: [], error: 'puppeteer failed' };
}

// Real Google SERP via SerpAPI (free 250 searches/month). When the quota is out
// the call errors and we fall back to the SearXNG surrogate, then Puppeteer.
async function fetchGoogleSerpViaSerpApi(keyword: string): Promise<SerpData | null> {
  if (!SERPAPI_KEY) return null;
  try {
    const data = await fetchViaSerpApi({ engine: 'google', q: keyword, hl: 'ru', gl: 'ru', num: '20' });
    const raw: any[] = data?.organic_results ?? [];
    const results: SerpResult[] = raw
      .filter((r) => typeof r?.link === 'string' && r.link.startsWith('http'))
      .map((r, i) => ({
        position: r.position ?? i + 1,
        title: cleanText(r.title || ''),
        url: r.link,
        domain: extractDomain(r.link),
        snippet: cleanText(r.snippet || '').slice(0, 300),
      }));
    if (results.length > 0) return { engine: 'google', keyword, results };
  } catch (err: any) {
    console.warn('[SERP] SerpAPI Google error:', err?.response?.data?.error || err?.message);
  }
  return null;
}

// Real Google via Custom Search JSON API — free 100 requests/day (3000/мес), enough
// for the nightly batch. Needs GOOGLE_CSE_KEY (API key, GCP) + GOOGLE_CSE_CX (engine id
// from programmablesearchengine.google.com with "search the entire web" enabled).
const GOOGLE_CSE_KEY = process.env.GOOGLE_CSE_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;

async function fetchGoogleSerpViaCse(keyword: string): Promise<SerpData | null> {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_CX) return null;
  try {
    const results: SerpResult[] = [];
    for (const start of [1, 11]) { // две страницы по 10 = топ-20
      const resp = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: { key: GOOGLE_CSE_KEY, cx: GOOGLE_CSE_CX, q: keyword, hl: 'ru', gl: 'ru', num: 10, start },
        timeout: 20000,
      });
      const items: any[] = resp.data?.items ?? [];
      for (const it of items) {
        if (typeof it?.link !== 'string' || !it.link.startsWith('http')) continue;
        results.push({
          position: results.length + 1,
          title: cleanText(it.title || ''),
          url: it.link,
          domain: extractDomain(it.link),
          snippet: cleanText(it.snippet || '').slice(0, 300),
        });
      }
      if (items.length < 10) break;
    }
    if (results.length > 0) return { engine: 'google', keyword, results };
  } catch (err: any) {
    console.warn('[SERP] Google CSE error:', err?.response?.data?.error?.message || err?.message);
  }
  return null;
}

// Real Google via Serper.dev (free 2500 credits, аккаунт grudeves@gmail.com).
// Основной источник: CSE отпал — Google закрыл «Search the entire web» для новых движков.
const SERPER_KEY = process.env.SERPER_KEY;

function bumpSerperUsage(kind: string): void {
  // 🚨 13.08.2026: здесь был require() внутри ESM-сборки — вызов падал, а пустой
  // catch его глушил, поэтому расход Serper не считался вообще (0 записей типа
  // "search" при живых запросах). Пишем через статические импорты.
  try {
    const dir = process.env.DATA_DIR || nodePath.join(process.cwd(), 'data');
    nodeFs.appendFileSync(nodePath.join(dir, 'serper-usage.log'),
      `${new Date().toISOString().slice(0, 10)}\t${kind}\n`);
  } catch (e: any) {
    console.warn('[SERP] счётчик Serper не записался:', e?.message?.slice(0, 80));
  }
}

async function fetchGoogleSerpViaSerper(keyword: string): Promise<SerpData | null> {
  if (!SERPER_KEY) return null;
  try {
    bumpSerperUsage('search');
    const resp = await axios.post('https://google.serper.dev/search',
      { q: keyword, gl: 'ru', hl: 'ru', num: 20 },
      { headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' }, timeout: 20000 },
    );
    const raw: any[] = resp.data?.organic ?? [];
    const results: SerpResult[] = raw
      .filter((r) => typeof r?.link === 'string' && r.link.startsWith('http'))
      .map((r, i) => ({
        position: r.position ?? i + 1,
        title: cleanText(r.title || ''),
        url: r.link,
        domain: extractDomain(r.link),
        snippet: cleanText(r.snippet || '').slice(0, 300),
      }));
    if (results.length > 0) return { engine: 'google', keyword, results };
  } catch (err: any) {
    console.warn('[SERP] Serper error:', err?.response?.data?.message || err?.message);
  }
  return null;
}

export async function fetchGoogleSerp(keyword: string): Promise<SerpData> {
  // Логируем, КАКОЙ источник реально отдал выдачу: 13.08.2026 счётчик serper-usage
  // не рос, и понять по логам, работает ли основной источник, было нельзя.
  const srp = await fetchGoogleSerpViaSerper(keyword); // 2500 фри-кредитов — основной
  if (srp) { console.log(`[SERP] Google via serper: ${srp.results.length} рез. "${keyword}"`); return srp; }
  const cse = await fetchGoogleSerpViaCse(keyword); // задел: если появится engine со всем вебом
  if (cse) { console.log(`[SERP] Google via CSE: ${cse.results.length} рез.`); return cse; }
  const api = await fetchGoogleSerpViaSerpApi(keyword); // 250/мес — резерв
  if (api) { console.warn(`[SERP] Google via SerpApi (резерв 250/мес): ${api.results.length} рез.`); return api; }
  const sx = await fetchSearxngSerp(keyword, 'google');
  if (sx.results.length > 0) return sx;
  return fetchGoogleSerpPuppeteer(keyword);
}

// Бесплатная цепочка без API-квот (searxng/ddg → puppeteer) — для массовых фоновых
// проверок вроде CRAG-фактчека (~8 запросов на статью), где жечь CSE/SerpAPI нельзя.
export async function fetchFreeGoogleSerp(keyword: string): Promise<SerpData> {
  const sx = await fetchSearxngSerp(keyword, 'google');
  if (sx.results.length > 0) return sx;
  // ddg при серийных запросах (CRAG: 8 подряд) пустеет — яндекс-движок надёжнее
  // и для проверки русскоязычных фактов даже релевантнее.
  const yx = await fetchSearxngSerp(keyword, 'yandex');
  if (yx.results.length > 0) return yx;
  return fetchGoogleSerpPuppeteer(keyword);
}


const YA_CLOUD_API_KEY = process.env.YA_CLOUD_API_KEY;
const YA_CLOUD_FOLDER_ID = process.env.YA_CLOUD_FOLDER_ID;

/**
 * Parse Yandex Cloud Search API XML response
 */
function parseYandexCloudXml(xml: string, keyword: string): SerpData {
  const results: SerpResult[] = [];
  // Match each <group> block
  const groupRegex = /<group>([\s\S]*?)<\/group>/g;
  let groupMatch: RegExpExecArray | null;
  let position = 0;
  while ((groupMatch = groupRegex.exec(xml)) !== null) {
    const groupXml = groupMatch[1];
    const urlMatch = groupXml.match(/<url>([\s\S]*?)<\/url>/);
    const titleMatch = groupXml.match(/<title>([\s\S]*?)<\/title>/);
    const domainMatch = groupXml.match(/<domain>([\s\S]*?)<\/domain>/);
    const passageMatch = groupXml.match(/<passage>([\s\S]*?)<\/passage>/);
    if (!urlMatch) continue;
    const url = urlMatch[1].trim();
    if (!url.startsWith('http')) continue;
    const rawTitle = titleMatch ? titleMatch[1] : '';
    const title = cleanText(rawTitle.replace(/<[^>]+>/g, ''));
    const domain = domainMatch ? domainMatch[1].trim() : extractDomain(url);
    const rawSnippet = passageMatch ? passageMatch[1] : '';
    const snippet = cleanText(rawSnippet.replace(/<[^>]+>/g, '')).slice(0, 300);
    position++;
    results.push({ position, title, url, domain, snippet });
    if (results.length >= 100) break;
  }
  return { engine: 'yandex', keyword, results };
}

/**
 * Fetch Yandex search results via Yandex Cloud Search API (deferred mode, $0.25/1000)
 */
async function fetchYandexCloudSerp(keyword: string): Promise<SerpData | null> {
  if (!YA_CLOUD_API_KEY || !YA_CLOUD_FOLDER_ID) return null;
  try {
    const body = {
      folderId: YA_CLOUD_FOLDER_ID,
      query: { queryText: keyword, searchType: 'SEARCH_TYPE_RU' },
      region: '213',
      responseFormat: 'FORMAT_XML',
      groupSpec: { groupMode: 'GROUP_MODE_DEEP', groupsOnPage: 100, docsInGroup: 1 },
    };
    const resp = await axios.post('https://searchapi.api.cloud.yandex.net/v2/web/search', body, {
      headers: { Authorization: `Api-Key ${YA_CLOUD_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    const rawData: string = resp.data?.rawData;
    if (!rawData) return null;
    const xml = Buffer.from(rawData, 'base64').toString('utf-8');
    const parsed = parseYandexCloudXml(xml, keyword);
    if (parsed.results.length > 0) return parsed;
  } catch (err: any) {
    console.warn('[SERP] Yandex Cloud API error:', err?.message);
  }
  return null;
}

async function fetchYandexSerpPuppeteer(keyword: string): Promise<SerpData> {
  const url = `https://yandex.ru/search/?text=${encodeURIComponent(keyword)}&lr=213&numdoc=20`;
  try {
    const html = await fetchPageHtml(url, 3000);
    const $ = cheerio.load(html);
    const results: SerpResult[] = [];
    $('.organic, [data-fast-name="organic"]').each((i, el) => {
      const link = $(el).find('a.organic__url, .OrganicTitle-Link, a.link_theme_outer').first();
      const href = link.attr('href') || '';
      if (!href.startsWith('http') || href.includes('yandex')) return;
      const title = $(el).find('h2, .organic__title, .OrganicTitle').first().text().trim();
      const snippet = $(el).find('.organic__text, .TextContainer, .ExtendedText').first().text().trim();
      results.push({ position: i + 1, title, url: href, domain: extractDomain(href), snippet: snippet.slice(0, 300) });
    });
    if (results.length > 0) return { engine: 'yandex', keyword, results: results.slice(0, 20) };
  } catch (err: any) {
    console.warn('[SERP] Puppeteer Yandex error:', err?.message);
  }
  return { engine: 'yandex', keyword, results: [], error: 'puppeteer failed' };
}

/**
 * Fetch Yandex search results — Yandex Cloud API, Puppeteer fallback
 */
export async function fetchYandexSerp(keyword: string): Promise<SerpData> {
  const sx = await fetchSearxngSerp(keyword, 'yandex');
  if (sx.results.length > 0) return sx;
  const cloudResult = await fetchYandexCloudSerp(keyword);
  if (cloudResult) return cloudResult;
  return fetchYandexSerpPuppeteer(keyword);
}
