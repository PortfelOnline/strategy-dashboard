/**
 * loop-improve.ts — Infinite loop that improves kadastrmap.info articles to top-3.
 *
 * Priority: commercial articles with high search freq that are NOT in top-3.
 * Each article has a 30-day cooldown after improvement.
 *
 * Run: nohup npx tsx scripts/loop-improve.ts >> /tmp/loop-improve.log 2>&1 &
 * Stop: kill -SIGINT <pid>
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';
import { fetchGoogleSerp, fetchYandexSerp } from '../server/_core/serpParser';
import { runBatchRewrite } from '../server/routers/articles';
import * as wordpressDb from '../server/wordpress.db';

// ── Constants ────────────────────────────────────────────────────────────────

const USER_ID = 1;
// Short cooldown so articles get re-evaluated against a fresh top-3 every 2 weeks.
// Self-improvement: each rewrite pulls the latest competitors + LSI + missing topics,
// so the same article keeps closing the quality gap until it lands in top-3.
const COOLDOWN_DAYS = 14;
const BETWEEN_ARTICLES_MS = 5000;
const ALL_COOLDOWN_SLEEP_MS = 60 * 60 * 1000;
// After this many non-top-3 rewrites, switch to aggressive mode (deeper, more unique, +30% target).
const AGGRESSIVE_PASS_THRESHOLD = 2;
// Max total runtime — graceful stop after this many minutes (env override possible).
// Default 60 min so dev sessions don't leave the loop running indefinitely.
const MAX_RUNTIME_MS = Number(process.env.LOOP_MAX_MINUTES ?? 60) * 60 * 1000;
const STATE_FILE = path.join(import.meta.dirname, 'loop-state.json');
const POSITIONS_FILE = path.join(import.meta.dirname, 'positions.json');
const SITE_DOMAIN = 'kadastrmap.info';

// ── Types ────────────────────────────────────────────────────────────────────

interface ArticleState {
  lastChecked?: string;
  lastImproved?: string;
  googlePos?: number | null;
  yandexPos?: number | null;
  skipReason?: string | null;
  rewriteCount?: number;
  inTop3?: boolean;
}
interface LoopState {
  _updated: string;
  articles: Record<string, ArticleState>;
}
interface WpPost {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
}
interface PositionEntry {
  query: string;
  freq: number | null;
  google: (number | null)[];
  yandex: (number | null)[];
}
interface CheckResult {
  googlePos: number | null;
  yandexPos: number | null;
  needsRewrite: boolean;
  reason: string;
}

// ── Commercial intent scoring ─────────────────────────────────────────────────

/**
 * Score a slug by commercial keyword intent (revenue potential).
 * 2026-04-20: contrast усилен с 3:1 до ~20:1, чтобы прибыльные статьи
 * гарантированно обрабатывались первыми при ограниченном runtime (180 мин).
 *
 * Weights:
 *   0  — SKIP: карты/бесплатно/госуслуги (не приведут заказы)
 *   1  — LOW: общая информация (что-такое, почему, зачем, история)
 *   5  — MED: проблема-aware без прямого заказа (проверить, обременение, арест, снять)
 *  20  — HIGH: прямой заказ документа + ценовой intent
 *  30  — TOP-HIGH: "заказать + стоимость/цена" + "срочно" — максимальная конверсия
 */
function commercialScore(slug: string): number {
  const s = slug.toLowerCase();
  // SKIP — пустые запросы с т.з. конверсии
  if (/\bkarta\b|kadastrovaya-karta|publichnaya|besplatno|gosuslugi|cherez-mfc|sputnikovaya/.test(s)) return 0;
  // TOP-HIGH — commercial intent + price OR urgency (самые прибыльные)
  if (
    /(zakazat|poluchit|oformit).*(tsena|stoimost|srochno|bystro|onlajn)|(tsena|stoimost).*(zakazat|poluchit|vypisk|spravk|pasport)/.test(s)
    || /srochno|bystro-online/.test(s)
  ) return 30;
  // HIGH — прямой заказ документа
  if (/zakazat|poluchit|oformit|spravka|vypiska|pasport|kupit/.test(s)) return 20;
  // MED — проблема-aware (владелец в поиске решения, но пока без intent купить)
  if (/proverit|obremenenie|arest|zalog|sobstvennik|snyat|vosstanovit/.test(s)) return 5;
  // LOW — информационные (дефолт)
  return 1;
}

// ── State management ──────────────────────────────────────────────────────────

function loadState(): LoopState {
  if (!existsSync(STATE_FILE)) return { _updated: new Date().toISOString().slice(0, 10), articles: {} };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as LoopState; }
  catch { return { _updated: new Date().toISOString().slice(0, 10), articles: {} }; }
}

function saveState(state: LoopState): void {
  state._updated = new Date().toISOString().slice(0, 10);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function isOnCooldown(state: LoopState, url: string): boolean {
  const last = state.articles[url]?.lastImproved;
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < COOLDOWN_DAYS * 86400000;
}

function markChecked(state: LoopState, url: string, data: Partial<ArticleState>): void {
  state.articles[url] = { ...(state.articles[url] || {}), ...data, lastChecked: new Date().toISOString() };
}

function markImproved(state: LoopState, url: string, googlePos: number | null, yandexPos: number | null): void {
  const prev = state.articles[url] || {};
  const inTop3 = (googlePos !== null && googlePos <= 3) || (yandexPos !== null && yandexPos <= 3);
  state.articles[url] = {
    ...prev,
    lastImproved: new Date().toISOString(),
    lastChecked: new Date().toISOString(),
    googlePos, yandexPos, skipReason: null,
    rewriteCount: (prev.rewriteCount ?? 0) + 1,
    inTop3,
  };
}

// ── Priority scoring ──────────────────────────────────────────────────────────

function loadPositions(): PositionEntry[] {
  if (!existsSync(POSITIONS_FILE)) return [];
  try { return (JSON.parse(readFileSync(POSITIONS_FILE, 'utf8')).queries || []) as PositionEntry[]; }
  catch { return []; }
}

function extractKeyword(title: string): string {
  const short = title.replace(/<[^>]+>/g, '').split(/[,\u2013\u2014:?]|(?:\s+-\s+)/)[0].trim();
  return short.split(/\s+/).slice(0, 5).join(' ').toLowerCase();
}

/**
 * Compute priority score for a post.
 * score = commercial_weight × (1 + freq_boost/100) × position_gap_factor
 */
function computeScore(post: WpPost, positions: PositionEntry[], state: LoopState): number {
  const weight = commercialScore(post.slug);
  if (weight === 0) return 0;

  const slugWords = new Set(post.slug.split('-').filter(w => w.length > 3));
  let freqBoost = 0;
  let knownGPos: number | null = null;
  let knownYPos: number | null = null;

  for (const e of positions) {
    const qWords = new Set(e.query.split(/\s+/).map(w => w.toLowerCase()).filter(w => w.length > 3));
    const overlap = [...slugWords].filter(w => qWords.has(w)).length;
    if (overlap >= 2 && e.freq && e.freq > freqBoost) {
      freqBoost = e.freq;
      knownGPos = e.google?.[0] ?? null;
      knownYPos = e.yandex?.[0] ?? null;
    }
  }

  const stateEntry = state.articles[post.link];
  const gPos = knownGPos ?? stateEntry?.googlePos ?? 50;
  const yPos = knownYPos ?? stateEntry?.yandexPos ?? 50;
  const posGap = (Math.max(gPos as number, 1) + Math.max(yPos as number, 1)) / 2;
  return weight * (1 + freqBoost / 100) * Math.min(posGap / 3, 10);
}

async function fetchAllPosts(siteUrl: string, auth: string): Promise<WpPost[]> {
  const posts: WpPost[] = [];
  let page = 1;
  while (true) {
    const resp = await fetch(
      `${siteUrl}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,slug,title,link&status=publish`,
      { headers: { Authorization: auth } },
    );
    if (!resp.ok) break;
    const batch = await resp.json() as WpPost[];
    if (!batch.length) break;
    posts.push(...batch);
    page++;
  }
  return posts;
}

// ── Per-article position check ────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function findOurPos(results: { domain: string }[]): number | null {
  const idx = results.findIndex(r => r.domain.includes(SITE_DOMAIN) || SITE_DOMAIN.includes(r.domain));
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Fetches Google + Yandex SERP for the article keyword, returns position + rewrite decision.
 *
 * Cache note: serpCache in articles.ts is an in-process Map. When runBatchRewrite()
 * calls cachedGoogleSerp/cachedYandexSerp for the same keyword immediately after,
 * it gets a cache hit — no second SERP API call is made.
 */
async function checkArticlePosition(title: string): Promise<CheckResult> {
  const keyword = extractKeyword(title);
  if (!keyword) return { googlePos: null, yandexPos: null, needsRewrite: true, reason: 'no keyword' };

  const [googleSerp, yandexSerp] = await Promise.all([
    fetchGoogleSerp(keyword).catch(() => ({ results: [] as any[], error: 'failed' })),
    fetchYandexSerp(keyword).catch(() => ({ results: [] as any[], error: 'failed' })),
  ]);

  const googlePos = findOurPos(googleSerp.results);
  const yandexPos = findOurPos(yandexSerp.results);
  const posStr = `G:${googlePos ?? '\u2014'} Y:${yandexPos ?? '\u2014'}`;

  const gTop3 = googlePos !== null && googlePos <= 3;
  const yTop3 = yandexPos !== null && yandexPos <= 3;

  if (gTop3 && yTop3)        return { googlePos, yandexPos, needsRewrite: false, reason: `${posStr} both top-3` };
  // If ranked top-3 in one engine and completely absent from the other — skip (probably niche query)
  if (gTop3 && yandexPos === null) return { googlePos, yandexPos, needsRewrite: false, reason: `${posStr} google top-3, yandex unranked` };
  if (yTop3 && googlePos === null) return { googlePos, yandexPos, needsRewrite: false, reason: `${posStr} yandex top-3, google unranked` };
  // Not ranked anywhere → definitely needs rewrite
  if (googlePos === null && yandexPos === null) return { googlePos, yandexPos, needsRewrite: true, reason: `${posStr} not ranked anywhere` };
  // Ranked but outside top-3 in at least one engine
  if (googlePos !== null && googlePos > 3) return { googlePos, yandexPos, needsRewrite: true, reason: `${posStr} google pos ${googlePos} > 3` };
  if (yandexPos !== null && yandexPos > 3) return { googlePos, yandexPos, needsRewrite: true, reason: `${posStr} yandex pos ${yandexPos} > 3` };
  return { googlePos, yandexPos, needsRewrite: false, reason: `${posStr} ok` };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function runLoop(): Promise<void> {
  const accounts = await wordpressDb.getUserWordpressAccounts(USER_ID);
  const account = accounts[0];
  if (!account) throw new Error('No WP account for userId=1');
  const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');

  const positions = loadPositions();
  let round = 0;
  let stopped = false;
  const startedAt = Date.now();

  process.on('SIGINT',  () => { console.log('\n[loop] SIGINT — finishing current article...'); stopped = true; });
  process.on('SIGTERM', () => { console.log('\n[loop] SIGTERM — finishing current article...'); stopped = true; });

  // Auto-stop after MAX_RUNTIME_MS to prevent runaway sessions.
  const runtimeTimer = setTimeout(() => {
    console.log(`\n[loop] ⏰ MAX_RUNTIME reached (${Math.round(MAX_RUNTIME_MS / 60000)}min) — finishing current article...`);
    stopped = true;
  }, MAX_RUNTIME_MS);
  runtimeTimer.unref();

  while (!stopped) {
    round++;
    const state = loadState();
    const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
    console.log(`[loop] === Round ${round} started (elapsed ${elapsedMin}min / ${Math.round(MAX_RUNTIME_MS / 60000)}min cap) — fetching posts...`);
    const allPosts = await fetchAllPosts(account.siteUrl, auth);
    console.log(`[loop] Fetched ${allPosts.length} posts`);

    const eligible = allPosts
      .filter(p => !isOnCooldown(state, p.link))
      .map(p => ({ post: p, score: computeScore(p, positions, state) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    console.log(`[loop] Eligible: ${eligible.length} | On cooldown: ${allPosts.length - eligible.length}`);
    // 2026-04-20: логируем topN чтобы видеть что самые прибыльные идут первыми
    if (eligible.length > 0) {
      const top5 = eligible.slice(0, 5).map(e => `${e.score.toFixed(1)} · ${e.post.slug}`).join('\n    ');
      const scoreBuckets = eligible.reduce<Record<string, number>>((acc, e) => {
        const bucket = e.score >= 30 ? 'TOP-HIGH' : e.score >= 20 ? 'HIGH' : e.score >= 5 ? 'MED' : 'LOW';
        acc[bucket] = (acc[bucket] || 0) + 1;
        return acc;
      }, {});
      console.log(`[loop] Priority queue: TOP-HIGH=${scoreBuckets['TOP-HIGH'] || 0} HIGH=${scoreBuckets['HIGH'] || 0} MED=${scoreBuckets['MED'] || 0} LOW=${scoreBuckets['LOW'] || 0}`);
      console.log(`[loop] Top 5 by score:\n    ${top5}`);
    }

    if (eligible.length === 0) {
      console.log(`[loop] All on cooldown — sleeping 1h...`);
      await sleep(ALL_COOLDOWN_SLEEP_MS);
      continue;
    }

    let rewritten = 0, skipped = 0, errors = 0;
    const roundStart = Date.now();

    for (let i = 0; i < eligible.length; i++) {
      if (stopped) break;
      const { post } = eligible[i];
      const title = post.title.rendered.replace(/<[^>]+>/g, '');
      const prefix = `[loop] [${i + 1}/${eligible.length}]`;
      const shortTitle = title.slice(0, 55);

      try {
        const check = await checkArticlePosition(title);
        if (!check.needsRewrite) {
          console.log(`${prefix} SKIP | ${shortTitle} | ${check.reason}`);
          markChecked(state, post.link, { googlePos: check.googlePos, yandexPos: check.yandexPos, skipReason: check.reason });
          skipped++;
        } else {
          const priorCount = state.articles[post.link]?.rewriteCount ?? 0;
          const aggressive = priorCount >= AGGRESSIVE_PASS_THRESHOLD;
          console.log(`${prefix} REWRITE${aggressive ? '+AGG' : ''} | ${shortTitle} | ${check.reason} | prior:${priorCount}`);
          if (aggressive) process.env.LOOP_AGGRESSIVE_MODE = '1';
          else delete process.env.LOOP_AGGRESSIVE_MODE;
          await runBatchRewrite(USER_ID, [post.link]);
          markImproved(state, post.link, check.googlePos, check.yandexPos);
          rewritten++;
        }
        saveState(state);
      } catch (err: any) {
        console.error(`${prefix} ERROR | ${shortTitle} | ${String(err?.message).slice(0, 80)}`);
        errors++;
      }

      if (i < eligible.length - 1 && !stopped) await sleep(BETWEEN_ARTICLES_MS);
    }

    const mins = ((Date.now() - roundStart) / 60000).toFixed(1);
    console.log(`[loop] === Round ${round} done — rewritten:${rewritten} skipped:${skipped} errors:${errors} — ${mins}min ===`);
  }
  console.log('[loop] Stopped gracefully.');
}

// ── Entry point ───────────────────────────────────────────────────────────────
runLoop().catch(err => { console.error('[loop] Fatal:', err); process.exit(1); });
