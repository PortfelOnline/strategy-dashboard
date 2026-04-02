/**
 * Backfill post_excerpt for all rewritten articles that have empty excerpts.
 * Fetches posts from WP, checks excerpt, generates from content if empty, updates.
 */
import 'dotenv/config';
import axios from 'axios';

// WP account - kadastrmap
const SITE_URL   = 'https://kadastrmap.info';
const WP_USER    = 'grudeves_vf97s8yc';
const WP_PASS    = 'uX$8LCdpGKH9Rcd';

async function getWpPassword(): Promise<string> {
  return process.env.WP_APP_PASSWORD_KAD ?? WP_PASS;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerptFromContent(html: string): string {
  const text = stripHtml(html);
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const s of sentences) {
    const clean = s.trim();
    if (clean.length >= 40) return clean.slice(0, 160).trimEnd();
  }
  return text.slice(0, 160).trimEnd();
}

async function main() {
  const appPassword = await getWpPassword();
  const auth = 'Basic ' + Buffer.from(`${WP_USER}:${appPassword}`).toString('base64');
  const base = SITE_URL + '/wp-json/wp/v2/posts';

  let page = 13;
  let total = 0;
  let updated = 0;
  let skipped = 0;

  while (true) {
    const res = await axios.get(base, {
      params: { per_page: 100, page, status: 'publish', _fields: 'id,slug,excerpt,content' },
      headers: { Authorization: auth },
      httpsAgent: new (await import('https')).default.Agent({ rejectUnauthorized: false }),
    });

    const posts: any[] = res.data;
    if (!posts.length) break;
    total += posts.length;
    console.log(`Page ${page}: ${posts.length} posts (total so far: ${total})`);

    for (const post of posts) {
      const contentHtml = post.content?.rendered ?? '';
      const excerpt = excerptFromContent(contentHtml);
      if (!excerpt || excerpt.length < 20) {
        skipped++;
        continue;
      }

      try {
        await axios.post(`${base}/${post.id}`, { excerpt }, {
          headers: { Authorization: auth, 'Content-Type': 'application/json' },
          httpsAgent: new (await import('https')).default.Agent({ rejectUnauthorized: false }),
        });
        updated++;
        if (updated % 10 === 0) console.log(`  Updated ${updated} so far...`);
      } catch (e: any) {
        console.error(`  FAIL post ${post.id} (${post.slug}): ${e.message}`);
      }
    }

    if (posts.length < 100) break;
    page++;
  }

  console.log(`\nDone. Total: ${total}, Updated: ${updated}, Skipped (short content): ${skipped}`);
}

main().catch(console.error);
