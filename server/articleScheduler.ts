import * as fs from 'fs';
import * as path from 'path';
import { scanCatalog } from './_core/articleParser';
import * as articlesDb from './articles.db';

export interface ArticleSchedulerConfig {
  enabled: boolean;
  catalogUrl: string;
  articlesPerNight: number;
  hour: number;          // 0–23, local server time
  userId: number;
  skipImprovedDays: number; // skip articles improved within N days
  /** Latest Flow health snapshot. Kept optional for backwards-compatible config files. */
  flowHealth?: FlowHealthResponse;
}

export interface FlowHealthResponse {
  /** Remaining image credits/quota exposed by the Flow bridge. */
  credits?: number | null;
  imageQuota?: number | null;
  imagesRemaining?: number | null;
  flowDisabled?: boolean;
}

export type ArticleQueueKind = 'improveExisting' | 'createNewEvergreen';

export interface ArticleQueueEntry {
  url: string;
  kind?: ArticleQueueKind;
  imagesRequired?: number;
  [key: string]: unknown;
}

const DEFAULT_CONFIG: ArticleSchedulerConfig = {
  enabled: false,
  catalogUrl: 'https://kadastrmap.info/kadastr/',
  articlesPerNight: 20,
  hour: 2,
  userId: 1,
  skipImprovedDays: 30,
};

const CONFIG_FILE  = path.join(process.cwd(), 'article-scheduler.json');
const LASTRUN_FILE = path.join(process.cwd(), 'article-scheduler-lastrun.json');
const TICK_MS = 10 * 60 * 1000; // check every 10 min

let tickTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

function getImageQuota(health: FlowHealthResponse): number | undefined {
  if (health.flowDisabled) return 0;
  for (const value of [health.imageQuota, health.imagesRemaining, health.credits]) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  }
  return undefined;
}

/**
 * Select queue work without coupling improvement eligibility to image credits.
 * Existing articles can fall back to a text-only rewrite when quota is exhausted;
 * new evergreen articles always require at least one image and a positive quota.
 */
export function selectEligibleArticleQueueEntries(
  entries: ArticleQueueEntry[],
  flowHealth: FlowHealthResponse = {},
  limit = entries.length,
): ArticleQueueEntry[] {
  const quota = getImageQuota(flowHealth);
  const selected: ArticleQueueEntry[] = [];

  for (const entry of entries) {
    const kind = entry.kind ?? 'improveExisting';
    const required = entry.imagesRequired ?? 0;

    if (kind === 'createNewEvergreen') {
      // Evergreen creation must never silently become text-only.
      if (required <= 0 || quota === undefined || quota < required) continue;
      selected.push({ ...entry });
    } else if (quota === 0) {
      // Preserve the queued improvement, explicitly signalling text-only mode.
      selected.push({ ...entry, kind: 'improveExisting', imagesRequired: 0 });
    } else if (quota === undefined || required <= quota) {
      selected.push({ ...entry });
    }

    if (selected.length >= limit) break;
  }

  return selected;
}

export function getSchedulerConfig(): ArticleSchedulerConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveSchedulerConfig(config: ArticleSchedulerConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function getLastRunDate(): string | null {
  try {
    if (fs.existsSync(LASTRUN_FILE)) {
      return JSON.parse(fs.readFileSync(LASTRUN_FILE, 'utf8')).date ?? null;
    }
  } catch {}
  return null;
}

function setLastRunDate(): void {
  fs.writeFileSync(LASTRUN_FILE, JSON.stringify({ date: todayStr() }));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextRunIso(config: ArticleSchedulerConfig): string | null {
  if (!config.enabled) return null;
  const d = new Date();
  d.setHours(config.hour, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

async function runScheduledBatch(config: ArticleSchedulerConfig): Promise<void> {
  if (running) return;
  running = true;
  console.log('[ArticleScheduler] Ночной батч запущен');

  try {
    // Dynamic import to avoid potential module init order issues
    const { runBatchRewrite } = await import('./routers/articles');

    // Collect recently-improved URLs to skip
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.skipImprovedDays);
    const history = await articlesDb.getUserAnalysisHistory(config.userId, 5000);
    const recentUrls = new Set(
      history
        .filter(h => new Date(h.createdAt) >= cutoff)
        .map(h => h.url),
    );

    // Scan catalog pages until we collect enough unimproved URLs
    const toProcess: ArticleQueueEntry[] = [];
    let page = 1;
    while (toProcess.length < config.articlesPerNight && page <= 100) {
      const result = await scanCatalog(config.catalogUrl, 1, page);
      for (const a of result.articles) {
        if (!recentUrls.has(a.url)) {
          // Catalog entries are existing articles, so they may run text-only
          // when Flow reports an exhausted image quota.
          toProcess.push({ url: a.url, kind: 'improveExisting' });
        }
        if (toProcess.length >= config.articlesPerNight) break;
      }
      if (result.articles.length === 0 || page >= result.totalPages) break;
      page++;
    }

    const eligible = selectEligibleArticleQueueEntries(toProcess, config.flowHealth ?? {});

    if (eligible.length === 0) {
      console.log(toProcess.length === 0
        ? '[ArticleScheduler] Нет статей для обработки (все недавно улучшены)'
        : '[ArticleScheduler] Нет доступной работы для текущего лимита Flow');
      setLastRunDate();
      return;
    }

    const batch = eligible.slice(0, config.articlesPerNight);
    const textOnly = getImageQuota(config.flowHealth ?? {}) === 0 &&
      batch.every(a => (a.kind ?? 'improveExisting') === 'improveExisting');
    console.log(`[ArticleScheduler] Обрабатываем ${batch.length} статей${textOnly ? ' (text-only)' : ''}...`);
    await runBatchRewrite(
      config.userId,
      batch.map(a => a.url),
      textOnly ? { imagesRequired: 0 } : undefined,
    );
    setLastRunDate();
    console.log('[ArticleScheduler] Батч завершён');
  } catch (err) {
    console.error('[ArticleScheduler] Ошибка:', err);
  } finally {
    running = false;
  }
}

function tick(): void {
  const config = getSchedulerConfig();
  if (!config.enabled || running) return;

  const now = new Date();
  if (now.getHours() === config.hour && getLastRunDate() !== todayStr()) {
    runScheduledBatch(config);
  }
}

export function initArticleScheduler(): void {
  if (tickTimer) return;
  const config = getSchedulerConfig();
  const next = nextRunIso(config);
  console.log(
    `[ArticleScheduler] Init — enabled=${config.enabled}, ` +
    `${config.articlesPerNight} статей/ночь в ${String(config.hour).padStart(2, '0')}:00, ` +
    `skipImprovedDays=${config.skipImprovedDays}, lastRun=${getLastRunDate() ?? 'никогда'}, ` +
    `nextRun=${next ?? 'отключён'} (tick каждые ${TICK_MS / 60000} мин)`,
  );
  tickTimer = setInterval(tick, TICK_MS);
  tick();
}

export function getSchedulerStatus() {
  const config = getSchedulerConfig();
  return {
    running,
    lastRun: getLastRunDate(),
    nextRun: nextRunIso(config),
  };
}
