/**
 * Batch 7: 25 HIGH-priority articles
 * Focus: kak-poluchit/oformit kadastrovyj-pasport (5+4),
 *        kadastrovyj-pasport specific objects (6),
 *        bystro-poluchit/zakazat-spravku (3),
 *        kadastrovyj-plan variants (7)
 *
 * Usage: npx tsx scripts/batch-rewrite-7.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // kak-poluchit kadastrovyj-pasport
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-dom/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-zemlyu/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-uchastka/',

  // kak-oformit kadastrovyj-pasport
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-dom/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-zemelnyj-uchastok/',

  // kadastrovyj-pasport specific objects
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-nezhiloe-pomeshhenie/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-nedvizhimost/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-sadovyj-domik/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-sadovyj-uchastok/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-zdanie/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-v-elektronnom-vide/',

  // bystro / zakazat-spravku (high urgency intent)
  'https://kadastrmap.info/kadastr/kak-bystro-poluchit-vypisku-iz-egrn/',
  'https://kadastrmap.info/kadastr/kak-bystro-poluchit-vypisku-iz-egrp/',
  'https://kadastrmap.info/kadastr/kak-mozhno-zakazat-spravku-egrn/',

  // kadastrovyj-plan variants
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-doma/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-kvartiry-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-onlajn/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-territorii/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-plan/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-pomeshheniya/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-7] Starting: ${URLS.length} articles, userId=${USER_ID}`);
console.log(`[batch-rewrite-7] Clusters: kak-poluchit(5), kak-oformit(4), specific-objects(6), bystro/zakazat(3), kadastrovyj-plan(7)`);
const start = Date.now();

await runBatchRewrite(USER_ID, URLS);

const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-7] DONE in ${mins} min`);
process.exit(0);
