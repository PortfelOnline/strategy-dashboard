/**
 * Retry script for 4 failed articles from batch-rewrite7.
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershenki/',
];

const USER_ID = 1;
console.log(`[batch-retry] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-retry] DONE in ${mins} min`);
