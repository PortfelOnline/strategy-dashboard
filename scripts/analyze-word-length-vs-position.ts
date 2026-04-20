/**
 * Analyze: does article word count correlate with Google ranking?
 *
 * Input: IMPROVED set from score-articles.ts (all rewritten articles)
 * Output: wordCount buckets vs GSC average position / top-3 rate / CTR
 *
 * Run: npx tsx scripts/analyze-word-length-vs-position.ts
 *      npx tsx scripts/analyze-word-length-vs-position.ts --csv > /tmp/wc-vs-pos.csv
 */
import 'dotenv/config';
import axios from 'axios';
import { google } from 'googleapis';
import { writeFileSync } from 'fs';
import { IMPROVED } from './score-articles';

const GSC_KEY_FILE = '/Users/evgenijgrudev/Downloads/curious-pointer-230707-16b0af3037fa.json';
const SITE_URL = 'sc-domain:kadastrmap.info';
const WP_API = 'https://kadastrmap.info/wp-json/wp/v2';
const PAGE_PATH_PREFIX = 'https://kadastrmap.info/kadastr/';
const DAYS_WINDOW = 28;

const CSV_MODE = process.argv.includes('--csv');

interface PageStats {
  url: string;
  slug: string;
  wordCount: number;
  position: number | null;
  impressions: number;
  clicks: number;
  ctr: number;
}

function countWords(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

function isoDateBack(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchGscMap(): Promise<Map<string, { pos: number; impr: number; clicks: number }>> {
  const auth = new google.auth.GoogleAuth({
    keyFile: GSC_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  const sc = google.webmasters({ version: 'v3', auth });
  const res = await sc.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: isoDateBack(DAYS_WINDOW),
      endDate: isoDateBack(1),
      dimensions: ['page'],
      rowLimit: 25000,
    },
  });
  const map = new Map<string, { pos: number; impr: number; clicks: number }>();
  for (const r of res.data.rows || []) {
    const url = r.keys?.[0];
    if (!url) continue;
    map.set(url.replace(/\/$/, ''), {
      pos: Number(r.position ?? 0),
      impr: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
    });
  }
  return map;
}

async function fetchWpWordCount(slug: string): Promise<number | null> {
  try {
    const r = await axios.get(`${WP_API}/posts`, {
      params: { slug, _fields: 'id,content,link' },
      timeout: 15000,
    });
    const post = r.data?.[0];
    if (!post) return null;
    return countWords(post.content?.rendered || '');
  } catch {
    return null;
  }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function bucketOf(wc: number): string {
  if (wc < 2000) return '<2000';
  if (wc < 3000) return '2000-2999';
  if (wc < 4000) return '3000-3999';
  if (wc < 5000) return '4000-4999';
  return '5000+';
}

function round(n: number, d = 1): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

async function main() {
  const slugs = Array.from(IMPROVED);
  console.error(`[1/3] IMPROVED slugs: ${slugs.length}`);

  console.error(`[2/3] Fetching GSC (last ${DAYS_WINDOW} days)…`);
  const gsc = await fetchGscMap();
  console.error(`      GSC pages: ${gsc.size}`);

  console.error(`[3/3] Fetching wordCount from WP (concurrency 10)…`);
  const rows: PageStats[] = [];
  let done = 0;
  const all = await mapConcurrent(slugs, 10, async (slug) => {
    const wc = await fetchWpWordCount(slug);
    done++;
    if (done % 50 === 0) console.error(`      ${done}/${slugs.length}`);
    if (wc === null || wc === 0) return null;
    const url = `${PAGE_PATH_PREFIX}${slug}`;
    const g = gsc.get(url) || gsc.get(url.replace(/\/$/, ''));
    return {
      url,
      slug,
      wordCount: wc,
      position: g?.pos ?? null,
      impressions: g?.impr ?? 0,
      clicks: g?.clicks ?? 0,
      ctr: g && g.impr > 0 ? g.clicks / g.impr : 0,
    } as PageStats;
  });
  for (const r of all) if (r) rows.push(r);
  console.error(`      WP posts found: ${rows.length}`);

  if (CSV_MODE) {
    console.log('slug,wordCount,position,impressions,clicks,ctr');
    for (const r of rows) {
      console.log(`${r.slug},${r.wordCount},${r.position ?? ''},${r.impressions},${r.clicks},${round(r.ctr * 100, 2)}`);
    }
    return;
  }

  // Save full CSV to tmp
  const csvLines = ['slug,wordCount,position,impressions,clicks,ctr'];
  for (const r of rows) {
    csvLines.push(`${r.slug},${r.wordCount},${r.position ?? ''},${r.impressions},${r.clicks},${round(r.ctr * 100, 2)}`);
  }
  writeFileSync('/tmp/wc-vs-pos.csv', csvLines.join('\n'));
  console.error(`      Full CSV → /tmp/wc-vs-pos.csv`);

  // Only rows with GSC data for ranking analysis (impressions > 0)
  const withGsc = rows.filter((r) => r.impressions > 0 && r.position !== null);
  const noGsc = rows.filter((r) => r.impressions === 0 || r.position === null);

  console.log(`\n=== Word Count vs Google Position (GSC, last ${DAYS_WINDOW} days) ===`);
  console.log(`Improved articles total: ${rows.length}`);
  console.log(`  With GSC impressions:  ${withGsc.length}`);
  console.log(`  Without impressions:   ${noGsc.length} (new articles or zero search demand)\n`);

  const buckets = ['<2000', '2000-2999', '3000-3999', '4000-4999', '5000+'];
  console.log('Bucket      | N   | AvgPos | Median | Top-3 | Top-10 | Top-20 | Σ impr  | Σ clicks | CTR%');
  console.log('------------|-----|--------|--------|-------|--------|--------|---------|----------|-----');

  for (const b of buckets) {
    const bRows = withGsc.filter((r) => bucketOf(r.wordCount) === b);
    if (bRows.length === 0) {
      console.log(`${b.padEnd(12)}| 0   |   —    |   —    |   —   |   —    |   —    |    —    |    —     |  —`);
      continue;
    }
    const positions = bRows.map((r) => r.position!).sort((a, b) => a - b);
    const avgPos = positions.reduce((s, x) => s + x, 0) / positions.length;
    const medPos = positions[Math.floor(positions.length / 2)];
    const top3 = bRows.filter((r) => r.position! <= 3).length;
    const top10 = bRows.filter((r) => r.position! <= 10).length;
    const top20 = bRows.filter((r) => r.position! <= 20).length;
    const sumImpr = bRows.reduce((s, r) => s + r.impressions, 0);
    const sumClicks = bRows.reduce((s, r) => s + r.clicks, 0);
    const ctr = sumImpr > 0 ? (sumClicks / sumImpr) * 100 : 0;

    console.log(
      `${b.padEnd(12)}| ${String(bRows.length).padEnd(3)} | ${String(round(avgPos)).padStart(5)}  | ${String(round(medPos)).padStart(5)}  | ` +
        `${String(round((top3 / bRows.length) * 100)).padStart(4)}% | ${String(round((top10 / bRows.length) * 100)).padStart(5)}% | ` +
        `${String(round((top20 / bRows.length) * 100)).padStart(5)}% | ${String(sumImpr).padStart(6)}  | ${String(sumClicks).padStart(7)}  | ${round(ctr, 2)}`
    );
  }

  // Correlation coefficient (Pearson) between wordCount and position
  if (withGsc.length > 3) {
    const n = withGsc.length;
    const xs = withGsc.map((r) => r.wordCount);
    const ys = withGsc.map((r) => r.position!);
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const r = num / Math.sqrt(dx * dy);
    console.log(`\nPearson correlation wordCount ↔ position: ${round(r, 3)}`);
    console.log(`  (0 = no correlation, +1 = longer → worse position, -1 = longer → better)`);
  }

  // Top performers vs bottom
  const top20 = [...withGsc].sort((a, b) => a.position! - b.position!).slice(0, 20);
  const bot20 = [...withGsc].sort((a, b) => b.position! - a.position!).slice(0, 20);
  const avgWC = (arr: PageStats[]) => round(arr.reduce((s, r) => s + r.wordCount, 0) / arr.length);
  console.log(`\nAvg wordCount in TOP-20 by position: ${avgWC(top20)}  (avg pos ${round(top20.reduce((s, r) => s + r.position!, 0) / top20.length)})`);
  console.log(`Avg wordCount in BOTTOM-20:          ${avgWC(bot20)}  (avg pos ${round(bot20.reduce((s, r) => s + r.position!, 0) / bot20.length)})`);
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
