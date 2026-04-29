const PLACEHOLDER_RE = /<img[^>]*src=["']image\d+\.jpg["'][^>]*\/?>/gi;

export function removePlaceholders(html: string): string {
  return html.replace(PLACEHOLDER_RE, '');
}

// ── CLI entry point ───────────────────────────────────────────────────────────
import 'dotenv/config';
import axios from 'axios';

const SITE_URL = 'https://kadastrmap.info';
const WP_USER  = 'grudeves_vf97s8yc';
const WP_PASS  = process.env.WP_APP_PASSWORD_KAD ?? 'uX$8LCdpGKH9Rcd';
const AUTH     = 'Basic ' + Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');
const API      = `${SITE_URL}/wp-json/wp/v2`;

async function getAllPosts() {
  const posts: Array<{ id: number; slug: string; content: string }> = [];
  let page = 1, total = 0;
  console.log('[scan] Fetching all published posts...');
  do {
    const res = await axios.get(`${API}/posts`, {
      headers: { Authorization: AUTH },
      params: { per_page: 100, page, _fields: 'id,slug,content', status: 'publish' },
    });
    if (page === 1) {
      total = parseInt(res.headers['x-wp-totalpages'] ?? '1', 10);
      console.log(`[scan] Total pages: ${total}, posts: ${res.headers['x-wp-total']}`);
    }
    for (const p of res.data) posts.push({ id: p.id, slug: p.slug, content: p.content?.rendered ?? '' });
    console.log(`[scan] Page ${page}/${total}`);
    page++;
  } while (page <= total);
  return posts;
}

// Guard: only run CLI when executed directly, not when imported for tests
const isMainModule = process.argv[1]?.replace(/\\/g, '/').includes('fix-placeholder-images');
if (isMainModule) {
  const posts = await getAllPosts();
  const affected = posts.filter(p => /<img[^>]*src=["']image\d+\.jpg["'][^>]*\/?>/.test(p.content));
  console.log(`\n[scan] Found ${affected.length} articles with placeholder images:\n`);
  for (const a of affected) console.log(`  ${a.slug} (id=${a.id})`);

  if (affected.length === 0) {
    console.log('\n✅ All clean!');
    process.exit(0);
  }

  let fixed = 0, errors = 0;
  for (const a of affected) {
    const cleaned = removePlaceholders(a.content);
    try {
      await axios.post(`${API}/posts/${a.id}`, { content: cleaned }, {
        headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
      });
      console.log(`  ✅ ${a.slug}`);
      fixed++;
    } catch (e: any) {
      console.error(`  ❌ ${a.slug}: ${e?.response?.data?.message ?? e.message}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`\n[fix] Done: ${fixed} fixed, ${errors} errors`);
}
