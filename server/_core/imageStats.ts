// Скользящее среднее реального числа картинок в НОВЫХ evergreen-статьях (/kadastr/).
// Заменяет статичную догадку IMAGES_PER_NEW_ARTICLE=20 в articleScheduler.ts —
// та расходилась с реальной целью (avgCompetitorImages+2, по аудиту 23+ у части
// конкурентов), из-за чего оценка "на сколько статей хватит квоты" была занижена.
// Пишет publishEvergreenBatch/publishIfFilled после успешной публикации — именно
// там уже посчитан imgCount из опубликованного контента (реальный расход Flow).
import * as fs from 'fs';
import * as path from 'path';

const STATS_FILE = path.join(process.cwd(), 'data', 'new-article-image-stats.json');
const MAX_SAMPLES = 30;

export function recordNewArticleImageCount(count: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  let samples: number[] = [];
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (Array.isArray(raw)) samples = raw;
  } catch {}
  samples.push(count);
  if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(samples));
  } catch (e: any) {
    console.warn('[ImageStats] не удалось сохранить:', e?.message);
  }
}

/**
 * Среднее по последним замерам реального числа картинок в новых статьях.
 * `fallback` — если данных ещё нет (например, после деплоя, файл пуст) или файл не читается.
 */
export function getAvgNewArticleImageCount(fallback: number): number {
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (!Array.isArray(raw) || raw.length === 0) return fallback;
    const avg = raw.reduce((s: number, n: number) => s + n, 0) / raw.length;
    return Math.max(1, Math.round(avg));
  } catch {
    return fallback;
  }
}
