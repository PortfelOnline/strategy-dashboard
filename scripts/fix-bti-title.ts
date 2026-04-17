/**
 * One-shot fix: restore title + meta for /kak-zakazat-plan-bti/
 * Original LLM bug: llama-3.1-8b copied placeholder "в 60 символов или меньше" as real title.
 */
import 'dotenv/config';
import * as wordpressDb from '../server/wordpress.db';

const POST_ID = 332712;
const NEW_TITLE = 'Как заказать план БТИ онлайн — пошаговая инструкция';
const NEW_META_DESC = 'Заказать план БТИ онлайн: сроки, стоимость, пошаговая инструкция. Официальные сведения из Росреестра. Доставка на email за 1 день.';
const FOCUS_KEYWORD = 'как заказать план БТИ';

async function main() {
  const accounts = await wordpressDb.getUserWordpressAccounts(1);
  const account = accounts[0];
  if (!account) throw new Error('No WP account for userId=1');
  const siteBase = account.siteUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${account.username}:${account.appPassword}`).toString('base64');

  // 1. Update WP post title (stock REST)
  const wpResp = await fetch(`${siteBase}/wp-json/wp/v2/posts/${POST_ID}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: NEW_TITLE }),
  });
  const wpJson = await wpResp.json() as any;
  console.log('[WP] Title:', wpJson.title?.rendered ?? wpJson);

  // 2. Update Yoast meta via custom endpoint (same path autoPublishToWP uses)
  const metaResp = await fetch(`${siteBase}/wp-json/kadastrmap/v1/post-meta/${POST_ID}`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meta: {
        _yoast_wpseo_title: NEW_TITLE + ' — %%sitename%%',
        _yoast_wpseo_metadesc: NEW_META_DESC,
        _yoast_wpseo_focuskw: FOCUS_KEYWORD,
      },
    }),
  });
  console.log('[WP] Yoast meta:', metaResp.status, await metaResp.text().catch(() => '(no body)'));
}

main().catch(e => { console.error(e); process.exit(1); });
