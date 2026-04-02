/**
 * Batch 10: 25 HIGH-priority articles
 * Focus: kak-poluchit-spravku/vypisku, kak-sdelat/oformit remaining,
 *        kadastrovyj-plan remaining, kadastrovyj-pasport zhiloj/nezavershennyj/proverit
 *
 * Usage: npx tsx scripts/batch-rewrite-10.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kak-poluchit-spravku-egrn-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-poluchit-spravku-egrn-onlajn/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-egrn-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-egrn-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-iz-egrn-instruktsiya/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-iz-egrp-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-sdelat-kadastrovyj-pasport-na-kvartiru-vladeltsu-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kak-sdelat-kadastrovyj-pasport-na-dom-i-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-dachnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-oformit-kadastrovyj-pasport-na-kvartiru-v-novostrojke/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-po-adresu-nomeru/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-stoimost/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-zemelnogo-uchastka-obrazets/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-doma-kak-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zhilogo-doma/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zhilogo-pomeshheniya/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-zhiloj-dom-kak-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-vnov-postroennyj-dom/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-objekt-nezavershennogo-stroitelstva/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-proverit-onlajn/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-proverit-po-adresu-onlajn/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-srok-dejstviya/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-obrazets/',
  'https://kadastrmap.info/kadastr/kak-proverit-sobstvennika-kvartiry-po-adresu/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-10] Starting: ${URLS.length} articles, userId=${USER_ID}`);
console.log(`[batch-rewrite-10] Clusters: kak-poluchit(6), kak-sdelat/oformit(4), plan(5), zhiloj/nezav(5), proverit(5)`);
const start = Date.now();

await runBatchRewrite(USER_ID, URLS);

const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-10] DONE in ${mins} min`);
process.exit(0);
