/**
 * Batch 14b: 7 remaining articles from batch-14 that were not processed
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershenki/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-vosstanovit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obrazets/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-skolko-dejstvitelen/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan/',
];

const USER_ID = 1;
console.log(`[batch-14b] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-14b] DONE in ${mins} min`);
