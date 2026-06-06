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
    const toProcess: string[] = [];
    let page = 1;
    while (toProcess.length < config.articlesPerNight && page <= 100) {
      const result = await scanCatalog(config.catalogUrl, 1, page);
      for (const a of result.articles) {
        if (!recentUrls.has(a.url)) toProcess.push(a.url);
        if (toProcess.length >= config.articlesPerNight) break;
      }
      if (result.articles.length === 0 || page >= result.totalPages) break;
      page++;
    }

    if (toProcess.length === 0) {
      console.log('[ArticleScheduler] Нет статей для обработки (все недавно улучшены)');
      setLastRunDate();
      return;
    }

    console.log(`[ArticleScheduler] Обрабатываем ${toProcess.length} статей...`);
    await runBatchRewrite(config.userId, toProcess.slice(0, config.articlesPerNight));
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
