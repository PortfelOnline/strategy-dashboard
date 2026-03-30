/**
 * Batch 8: 25 HIGH-priority articles
 * Focus: kadastrovyj-pasport specific subtypes (komnata, dom, garazh, zdanie, obekt),
 *        kadastrovyj-plan variants,
 *        kak-poluchit/oformit remaining
 *
 * Usage: npx tsx scripts/batch-rewrite-8.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // kadastrovyj-pasport — specific property types
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-komnatu-v-kvartire/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-komnatu-v-obshhezhitii/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-dom-dachnyj/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-dom-v-snt/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-garazh-boks/',

  // kadastrovyj-pasport — zdanie/sooruzhenie cluster
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-rosreestr/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-zdanie-stoimost/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obekta-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-pomeshhenie/',

  // kak-poluchit — remaining subtypes
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-garazh/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-garazh-v-gsk/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-zdanie/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-dachnyj-dom/',

  // kadastrovyj-plan — remaining
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-plan-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-territorii-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-territorii-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-kak-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-onlajn/',

  // kadastrovyj-pasport — high commercial variants
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-onlajn-rossreestr/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-pri-prodazhe-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-tseny/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-v-elektronnom-vide/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-8] Starting: ${URLS.length} articles, userId=${USER_ID}`);
console.log(`[batch-rewrite-8] Clusters: specific-types(5), zdanie/obekt(5), kak-poluchit(5), kadastrovyj-plan(5), commercial(5)`);
const start = Date.now();

await runBatchRewrite(USER_ID, URLS);

const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-8] DONE in ${mins} min`);
process.exit(0);
