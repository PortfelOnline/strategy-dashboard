/**
 * Batch 3: 25 HIGH-priority articles
 * Focus: kadastrovyj-pasport variants, gde-poluchit, gde-zakazat, vypiska-egrp
 * Usage: npx tsx scripts/batch-rewrite-3.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/chem-otlichaetsya-kadastrovyj-pasport-ot-tehnicheskogo/',
  'https://kadastrmap.info/kadastr/chem-otlichaetsya-kadastrovyj-pasport-ot-vypiski/',
  'https://kadastrmap.info/kadastr/dlya-chego-nuzhen-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/dlya-chego-nuzhen-kadastrovyj-plan-territorii/',
  'https://kadastrmap.info/kadastr/dlya-chego-nuzhna-vypiska-egrn/',
  'https://kadastrmap.info/kadastr/eksplikatsiya-kvartiry-kak-zakazat-dokument-dlya-razlichnyh-zhiznennyh-situatsij/',
  'https://kadastrmap.info/kadastr/gde-brat-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/gde-delayut-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/gde-mozhno-poluchit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/gde-najti-kadastrovyj-pasport-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/gde-oformlyayut-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-kvartiry/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-na-dom/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-na-zemlyu/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-pasport-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-plan/',
  'https://kadastrmap.info/kadastr/gde-poluchit-kadastrovyj-plan-uchastka/',
  'https://kadastrmap.info/kadastr/gde-poluchit-vypisku-iz-egrp/',
  'https://kadastrmap.info/kadastr/gde-poluchit-vypisku-iz-egrp-na-kvartiru/',
  'https://kadastrmap.info/kadastr/gde-vydayut-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/gde-vzyat-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/gde-vzyat-kadastrovyj-pasport-na-dom/',
  'https://kadastrmap.info/kadastr/gde-vzyat-kadastrovyj-pasport-na-kvartiru/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-3] Starting: ${URLS.length} articles, userId=${USER_ID}`);
const start = Date.now();

await runBatchRewrite(USER_ID, URLS);

const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-3] DONE in ${mins} min`);
process.exit(0);
