import 'dotenv/config';
import { readFileSync } from 'fs';
import * as wp from '../server/_core/wordpress';
import * as wordpressDb from '../server/wordpress.db';
import { runBatchRewrite } from '../server/routers/articles';

// Создание НОВЫХ статей: stub WP-пост (publish, категория kadastr=2) → rewriteArticle
// генерирует полный текст из конкурентов. Темы: scripts/new-topics.json [{title,keyword,slug}].
//   tsx scripts/create-new-articles.ts [file] [limit] [--stub-only]
async function main() {
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'scripts/new-topics.json';
  const limitArg = process.argv.find(a => /^\d+$/.test(a));
  const stubOnly = process.argv.includes('--stub-only');
  const topics: { title: string; keyword: string; slug: string }[] = JSON.parse(readFileSync(file, 'utf8'));
  const limit = limitArg ? Number(limitArg) : topics.length;

  const acc = (await wordpressDb.getUserWordpressAccounts(1))[0];
  if (!acc) throw new Error('No WP account for userId=1');
  const base = acc.siteUrl.replace(/\/$/, '');

  const urls: string[] = [];
  for (const t of topics.slice(0, limit)) {
    const existing = await wp.findPostBySlug(acc.siteUrl, acc.username, acc.appPassword, t.slug);
    const url = `${base}/kadastr/${t.slug}/`;
    if (existing) {
      console.log(`[New] уже существует slug=${t.slug} (id ${existing.id}) — в рерайт без пересоздания`);
      urls.push(url);
      continue;
    }
    const seed = `<h1>${t.title}</h1>\n<p>${t.keyword} — подробное практическое руководство 2026 года.</p>`;
    const post = await wp.publishPost(acc.siteUrl, acc.username, acc.appPassword, {
      title: t.title, content: seed, status: 'publish', slug: t.slug, categories: [2],
    });
    console.log(`[New] stub создан id=${post.id} slug=${t.slug} → ${url}`);
    urls.push(url);
    await new Promise(r => setTimeout(r, 3000));
  }

  if (stubOnly) { console.log(`[New] stub-only: ${urls.length} URL созданы, рерайт пропущен.`); return; }

  console.log(`[New] ${urls.length} URL → запуск rewriteArticle (генерация из конкурентов)`);
  await runBatchRewrite(1, urls);
  console.log('[New] Готово.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[New] FAIL:', e?.message || e); process.exit(1); });
