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

export async function fetchGoogleSerp(keyword: string): Promise<SerpData> {
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
  const cloudResult = await fetchYandexCloudSerp(keyword);
  if (cloudResult) return cloudResult;
  return fetchYandexSerpPuppeteer(keyword);
}
