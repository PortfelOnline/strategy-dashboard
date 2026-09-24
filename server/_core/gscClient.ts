/**
 * Google Search Console client for enriching article rewrites.
 * Uses service account key (same as analytics-mcp).
 */
import { google } from 'googleapis';
import { subDays, format } from 'date-fns';

const KEY_FILE =
  process.env.GSC_KEY_FILE ||
  '/Users/evgenijgrudev/Downloads/curious-pointer-230707-16b0af3037fa.json';

const DEFAULT_SITE = process.env.GSC_SITE_URL || 'sc-domain:kadastrmap.info';
const DEFAULT_SITE_BASE = 'https://kadastrmap.info';

// После переезда kadastrmap.info → 100zem.ru (301, 2026-06-19) данные размазаны по двум
// property: история — на kadastrmap, новые показы копятся на 100zem. Опрашиваем оба и
// мержим. Переопределение: GSC_SITE_URLS=sc-domain:a,sc-domain:b
const SITES: string[] = (process.env.GSC_SITE_URLS || `${DEFAULT_SITE},sc-domain:100zem.ru`)
  .split(',').map(s => s.trim()).filter(Boolean);

function pathnameOf(u: string): string {
  try { return new URL(u).pathname.replace(/\/$/, '') + '/'; } catch { return u; }
}

function getService() {
  const creds = (google.auth as any).fromJSON
    ? null
    : null;
  const auth = new (google.auth.GoogleAuth)({
    keyFile: KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return google.webmasters({ version: 'v3', auth });
}

export interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscPageSnapshotResult {
  ok: boolean;
  snapshot?: { periodStart: Date; periodEnd: Date; clicks: number; impressions: number; ctr: number; position: number | null; queries: GscQuery[] };
  reason?: string;
}

/** Comparable delayed 28-day page window for the feedback loop; never throws. */
export async function fetchGscPageSnapshot(pageUrl: string, now = new Date()): Promise<GscPageSnapshotResult> {
  try {
    const periodEnd = subDays(now, 3), periodStart = subDays(periodEnd, 27);
    const fullUrl = pageUrl.startsWith('http') ? pageUrl : `${DEFAULT_SITE_BASE}${pageUrl}`;
    const queries = await fetchGscPageQueries(fullUrl, 28, 50);
    const stats = await fetchGscAllPagePositions(28);
    const page = stats.get(pathnameOf(fullUrl));
    return { ok: true, snapshot: { periodStart, periodEnd, clicks: page?.clicks ?? 0, impressions: page?.impressions ?? 0, ctr: page?.impressions ? page.clicks / page.impressions : 0, position: page?.position ?? null, queries: queries.map(q => ({ ...q, ctr: q.impressions ? q.clicks / q.impressions : 0 })) } };
  } catch (error: any) { return { ok: false, reason: error?.message || 'GSC request failed' }; }
}

/** Real queries with demand that need a dedicated or stronger landing page. */
export async function fetchGscOpportunityQueries(days = 28, limit = 100): Promise<GscQuery[]> {
  const endDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const sc = getService();
  const merged = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const site of SITES) {
    try {
      const res = await sc.searchanalytics.query({
        siteUrl: site,
        requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 2500 } as any,
      } as any);
      for (const r of ((res as any).data?.rows ?? [])) {
        const query = String(r.keys?.[0] ?? '').trim();
        if (!query) continue;
        const cur = merged.get(query) ?? { clicks: 0, impressions: 0, posW: 0 };
        cur.clicks += Number(r.clicks) || 0;
        cur.impressions += Number(r.impressions) || 0;
        cur.posW += (Number(r.position) || 0) * (Number(r.impressions) || 1);
        merged.set(query, cur);
      }
    } catch (err: any) { console.warn(`[GSC] opportunity queries (${site}) error:`, err?.message); }
  }
  return [...merged.entries()].map(([query, m]) => ({
    query, clicks: m.clicks, impressions: m.impressions,
    ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 1000) / 10 : 0,
    position: Math.round((m.posW / Math.max(m.impressions, 1)) * 10) / 10,
  })).filter(q => q.impressions >= 10 && q.position >= 8 && q.position <= 40)
    .sort((a, b) => b.impressions - a.impressions).slice(0, limit);
}

/**
 * Get top GSC queries for a specific page URL.
 * Returns empty array on error (graceful fallback).
 */
export async function fetchGscPageQueries(
  pageUrl: string,
  days = 28,
  limit = 20,
): Promise<GscQuery[]> {
  const endDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const fullUrl = pageUrl.startsWith('http') ? pageUrl : `${DEFAULT_SITE_BASE}${pageUrl}`;
  const pagePath = pathnameOf(fullUrl); // фильтр по пути — хост у property может отличаться

  const sc = getService();
  const merged = new Map<string, { clicks: number; impressions: number; posW: number }>();

  for (const site of SITES) {
    try {
      const res = await sc.searchanalytics.query({
        siteUrl: site,
        requestBody: {
          startDate,
          endDate,
          dimensions: ['query'],
          rowLimit: limit,
          orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
          dimensionFilterGroups: [{
            filters: [{
              dimension: 'page',
              operator: 'contains',
              expression: pagePath,
            }],
          }],
        } as any,
      } as any);
      for (const r of ((res as any).data?.rows || [])) {
        const q = r.keys[0] as string;
        const cur = merged.get(q) ?? { clicks: 0, impressions: 0, posW: 0 };
        cur.clicks += r.clicks as number;
        cur.impressions += r.impressions as number;
        cur.posW += (r.position as number) * (r.impressions as number || 1);
        merged.set(q, cur);
      }
    } catch (err: any) {
      console.warn(`[GSC] fetchGscPageQueries(${site}) error:`, err?.message);
    }
  }

  return [...merged.entries()]
    .map(([query, m]) => ({
      query,
      clicks: m.clicks,
      impressions: m.impressions,
      ctr: m.impressions ? Math.round((m.clicks / m.impressions) * 1000) / 10 : 0,
      position: Math.round((m.posW / Math.max(m.impressions, 1)) * 10) / 10,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

export interface GscPageStat {
  position: number;
  impressions: number;
  clicks: number;
}

/**
 * Позиции/показы ВСЕХ страниц сайта одним запросом (dimensions=page).
 * Ключ карты — pathname с завершающим слэшем (домены property и сайта могут различаться).
 * Используется шедулером (скип уже-топовых) и scripts/position-report.ts.
 */
export async function fetchGscAllPagePositions(days = 14, limit = 5000): Promise<Map<string, GscPageStat>> {
  const acc = new Map<string, { clicks: number; impressions: number; posW: number }>();
  const sc = getService();
  const endDate = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');

  for (const site of SITES) {
    try {
      const res = await sc.searchanalytics.query({
        siteUrl: site,
        requestBody: { startDate, endDate, dimensions: ['page'], rowLimit: limit } as any,
      } as any);
      for (const r of ((res as any).data?.rows ?? [])) {
        try {
          const key = pathnameOf(r.keys[0]);
          const cur = acc.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
          cur.clicks += r.clicks as number;
          cur.impressions += r.impressions as number;
          cur.posW += (r.position as number) * (r.impressions as number || 1);
          acc.set(key, cur);
        } catch {}
      }
    } catch (err: any) {
      console.warn(`[GSC] fetchGscAllPagePositions(${site}) error:`, err?.message);
    }
  }

  const map = new Map<string, GscPageStat>();
  for (const [key, m] of acc) {
    map.set(key, {
      position: Math.round((m.posW / Math.max(m.impressions, 1)) * 10) / 10,
      impressions: m.impressions,
      clicks: m.clicks,
    });
  }
  return map;
}

/**
 * Format GSC queries as a prompt block for LLM.
 */
export function formatGscBlock(queries: GscQuery[]): string {
  if (!queries.length) return '';
  const lines = queries.slice(0, 15).map(
    q => `  - "${q.query}" (${q.impressions} показов, поз. ${q.position})`,
  );
  return `\nРЕАЛЬНЫЕ ПОИСКОВЫЕ ЗАПРОСЫ ЭТОЙ СТРАНИЦЫ (из Google Search Console):\n${lines.join('\n')}\nОптимизируй статью под эти запросы — используй их формулировки в заголовках и тексте.\n`;
}
