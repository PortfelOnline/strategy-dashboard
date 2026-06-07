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

  const axios = (await import('axios')).default;
  const apiBase = `${base}/wp-json/wp/v2`;
  const authH = 'Basic ' + Buffer.from(`${acc.username}:${acc.appPassword}`).toString('base64');

  // По ОДНОЙ: опубликовать stub → сразу сгенерировать → следующая.
  // Так тонкая заглушка живёт публично только ~время её собственной генерации (минимум для URL-fetch),
  // а не висит, пока очередь дойдёт. Новые страницы — без трафика, без индексации (outsearch ставится в конце).
  for (const t of topics.slice(0, limit)) {
    const url = `${base}/kadastr/${t.slug}/`;
    const existing = await wp.findPostBySlug(acc.siteUrl, acc.username, acc.appPassword, t.slug);
    if (existing) {
      // черновик/существующий → опубликовать (нужен публичный URL для rewriteArticle)
      await axios.post(`${apiBase}/posts/${existing.id}/`, { status: 'publish' },
        { headers: { Authorization: authH, 'Content-Type': 'application/json' }, maxRedirects: 0, proxy: false });
      console.log(`[New] существует slug=${t.slug} (id ${existing.id}) → publish`);
    } else {
      const seed = `<h1>${t.title}</h1>\n<p>${t.keyword} — подробное практическое руководство 2026 года.</p>`;
      const post = await wp.publishPost(acc.siteUrl, acc.username, acc.appPassword, {
        title: t.title, content: seed, status: 'publish', slug: t.slug, categories: [2],
      });
      console.log(`[New] stub создан id=${post.id} slug=${t.slug}`);
    }
    if (stubOnly) continue;
    await new Promise(r => setTimeout(r, 2000));
    console.log(`[New] → генерация ${t.slug}`);
    await runBatchRewrite(1, [url]);  // сразу заполнить эту одну
  }
  console.log('[New] Готово.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[New] FAIL:', e?.message || e); process.exit(1); });
