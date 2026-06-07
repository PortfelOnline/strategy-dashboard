import 'dotenv/config';
import { readFileSync } from 'fs';
import { scanCatalog } from '../server/_core/articleParser';
import * as articlesDb from '../server/articles.db';
import { runBatchRewrite } from '../server/routers/articles';
import { getSchedulerConfig } from '../server/articleScheduler';

// Manual on-demand batch.
//   tsx scripts/run-batch-now.ts [count]                  → catalog order, skip recently-improved
//   tsx scripts/run-batch-now.ts --file urls.txt [--force] → explicit URL list (one per line)
// --force ignores the skip-recently-improved filter (re-do articles regardless of history).
async function main() {
  const cfg = getSchedulerConfig();
  const userId = cfg.userId;
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const fileIdx = args.indexOf('--file');

  // Explicit URL-list mode (e.g. GSC striking-distance targets)
  if (fileIdx !== -1) {
    const file = args[fileIdx + 1];
    const urls = readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s));
    let toRun = urls;
    if (!force) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - cfg.skipImprovedDays);
      const history = await articlesDb.getUserAnalysisHistory(userId, 5000);
      const recent = new Set(history.filter(h => new Date(h.createdAt) >= cutoff).map(h => h.url));
      toRun = urls.filter(u => !recent.has(u));
    }
    console.log(`[ManualBatch] file=${file}, ${toRun.length}/${urls.length} URL к обработке (force=${force}):`);
    toRun.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
    if (toRun.length === 0) { console.log('[ManualBatch] Нечего обрабатывать.'); return; }
    await runBatchRewrite(userId, toRun);
    console.log('[ManualBatch] Батч завершён.');
    return;
  }

  const count = Number(args[0] ?? cfg.articlesPerNight) || cfg.articlesPerNight;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cfg.skipImprovedDays);
  const history = await articlesDb.getUserAnalysisHistory(userId, 5000);
  const recent = new Set(
    history.filter(h => new Date(h.createdAt) >= cutoff).map(h => h.url),
  );

  const toProcess: string[] = [];
  let page = 1;
  while (toProcess.length < count && page <= 100) {
    const result = await scanCatalog(cfg.catalogUrl, 1, page);
    for (const a of result.articles) {
      if (!recent.has(a.url)) toProcess.push(a.url);
      if (toProcess.length >= count) break;
    }
    if (result.articles.length === 0 || page >= result.totalPages) break;
    page++;
  }

  console.log(`[ManualBatch] ${toProcess.length} статей к обработке (count=${count}, skipRecent=${recent.size}):`);
  toProcess.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  if (toProcess.length === 0) { console.log('[ManualBatch] Нечего обрабатывать.'); return; }

  await runBatchRewrite(userId, toProcess.slice(0, count));
  console.log('[ManualBatch] Батч завершён.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[ManualBatch] FAIL:', e?.message || e); process.exit(1); });
