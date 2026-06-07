import 'dotenv/config';
import { readFileSync } from 'fs';
import axios from 'axios';
import * as wp from '../server/_core/wordpress';
import * as wordpressDb from '../server/wordpress.db';
import { runBatchRewrite } from '../server/routers/articles';

// Создание НОВЫХ статей БЕЗ долгого тонкого окна: по ОДНОЙ, just-in-time.
// Для каждой темы: создать/найти пост (draft) → опубликовать → СРАЗУ rewriteArticle
// (генерация из конкурентов) → следующая. Тонкой (~5 мин) бывает максимум одна статья
// в момент своей генерации.
//   tsx scripts/create-new-articles.ts <topics.json> [limit]
async function main() {
  const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'scripts/new-topics.json';
  const limitArg = process.argv.find((a, i) => i >= 3 && /^\d+$/.test(a));
  const topics: { title: string; keyword: string; slug: string }[] = JSON.parse(readFileSync(file, 'utf8'));
  const limit = limitArg ? Number(limitArg) : topics.length;

  const acc = (await wordpressDb.getUserWordpressAccounts(1))[0];
  if (!acc) throw new Error('No WP account for userId=1');
  const apiBase = acc.siteUrl.replace(/\/$/, '') + '/wp-json/wp/v2';
  const auth = 'Basic ' + Buffer.from(`${acc.username}:${acc.appPassword}`).toString('base64');
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };
  const base = acc.siteUrl.replace(/\/$/, '');

  // найти пост по слагу в любом статусе (context=edit видит draft)
  const findAny = async (slug: string) => {
    const { data } = await axios.get(`${apiBase}/posts/`, {
      params: { slug, status: 'publish,draft,pending,private', _fields: 'id,status', per_page: 1, context: 'edit' },
      headers, proxy: false,
    });
    return Array.isArray(data) && data[0] ? data[0] : null;
  };

  for (const t of topics.slice(0, limit)) {
    const url = `${base}/kadastr/${t.slug}/`;
    console.log(`\n=== ${t.slug} ===`);
    let post = await findAny(t.slug);
    if (!post) {
      const seed = `<h1>${t.title}</h1>\n<p>${t.keyword} — подробное практическое руководство 2026 года.</p>`;
      const created = await wp.publishPost(acc.siteUrl, acc.username, acc.appPassword, {
        title: t.title, content: seed, status: 'publish', slug: t.slug, categories: [2],
      });
      post = { id: created.id, status: 'publish' };
      console.log(`[New] создан id=${post.id}`);
    } else if (post.status !== 'publish') {
      await axios.post(`${apiBase}/posts/${post.id}/`, { status: 'publish' }, { headers, maxRedirects: 0, proxy: false });
      console.log(`[New] draft id=${post.id} → publish`);
    } else {
      console.log(`[New] уже опубликован id=${post.id}`);
    }
    // СРАЗУ генерируем полный контент (тонкое окно ~ время генерации этой одной статьи)
    console.log(`[New] rewriteArticle → ${url}`);
    await runBatchRewrite(1, [url]);
  }
  console.log('\n[New] Готово.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[New] FAIL:', e?.response?.data?.message || e?.message || e); process.exit(1); });
