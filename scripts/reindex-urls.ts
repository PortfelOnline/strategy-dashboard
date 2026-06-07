import 'dotenv/config';
import { readFileSync } from 'fs';
import { google } from 'googleapis';

// Переобход списка URL: Яндекс+Bing (IndexNow) + Google (Indexing API).
//   tsx scripts/reindex-urls.ts <file|url> [url2 ...]
// file — текстовый список (по одному URL в строке, # — комментарий).
async function googleIndex(url: string): Promise<string> {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GSC_KEY_FILE;
  if (!keyFile) return 'no-key';
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/indexing'] });
  const client = await auth.getClient();
  try {
    const res = await (client as any).request({
      url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
      method: 'POST', data: { url, type: 'URL_UPDATED' },
    });
    return `google:${res.status}`;
  } catch (e: any) { return `google:ERR ${e?.response?.status || e?.message}`; }
}

async function indexNow(url: string): Promise<string> {
  const key = process.env.INDEXNOW_API_KEY;
  if (!key) return 'no-indexnow-key';
  const host = new URL(url).hostname;
  const body = JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList: [url] });
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body } as const;
  const r = await Promise.allSettled([
    fetch('https://yandex.com/indexnow', opts),
    fetch('https://api.indexnow.org/indexnow', opts),
  ]);
  return `indexnow:${r.filter(x => x.status === 'fulfilled').length}/2`;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('usage: reindex-urls.ts <file|url> [...]'); process.exit(1); }
  let urls: string[] = [];
  for (const a of args) {
    if (/^https?:\/\//.test(a)) urls.push(a);
    else urls.push(...readFileSync(a, 'utf8').split('\n').map(s => s.trim()).filter(s => /^https?:\/\//.test(s)));
  }
  urls = Array.from(new Set(urls));
  console.log(`[Reindex] ${urls.length} URL`);
  for (const url of urls) {
    const [g, i] = await Promise.all([googleIndex(url), indexNow(url)]);
    console.log(`  ${g} | ${i} — ${url}`);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[Reindex] Готово.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
