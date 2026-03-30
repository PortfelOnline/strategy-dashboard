/**
 * Batch 9: 25 HIGH-priority articles
 * Focus: zakazat-kadastrovyj-pasport (direct order, max conversion intent),
 *        zakazat-vypisku/spravku (urgent orders),
 *        srochno cluster,
 *        vypiska-iz-egrn specific types
 *
 * Usage: npx tsx scripts/batch-rewrite-9.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // zakazat-kadastrovyj-pasport — highest order intent
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-kvartiry/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-na-dom/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-onlajn/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-na-kvartiru-onlajn/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-na-kvartiru-cherez-internet/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-onlajn-rosreestr/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-tsena/',
  'https://kadastrmap.info/kadastr/zakazat-kadastrovyj-pasport-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/zakazat-onlajn-kadastrovyj-pasport/',

  // zakazat-vypisku / zakazat-spravku (urgent)
  'https://kadastrmap.info/kadastr/zakazat-vypisku-iz-egrn-na-dom-onlajn/',
  'https://kadastrmap.info/kadastr/zakazat-vypisku-iz-egrp/',
  'https://kadastrmap.info/kadastr/zakazat-vypisku-iz-egrp-onlajn/',
  'https://kadastrmap.info/kadastr/zakazat-spravku-egrn-srochno/',
  'https://kadastrmap.info/kadastr/zakazat-spravku-iz-egrn-srochno/',
  'https://kadastrmap.info/kadastr/zakazat-spravku-iz-egrn-o-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/zakazat-elektronnuyu-vypisku-iz-egrp/',
  'https://kadastrmap.info/kadastr/zakazat-vypisku-po-kadastrovomu-nomeru/',

  // srochno cluster
  'https://kadastrmap.info/kadastr/srochnyj-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/uskorennyj-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/stoimost-vypiski-iz-egrn-onlajn-srochno/',

  // vypiska-iz-egrn specific types
  'https://kadastrmap.info/kadastr/vypiska-iz-egrn-na-sadovyj-dom/',
  'https://kadastrmap.info/kadastr/vypiska-iz-egrn-na-zhiloj-dom/',
  'https://kadastrmap.info/kadastr/vypiska-iz-egrn-o-snyatii-obremeneniya/',
  'https://kadastrmap.info/kadastr/spravka-vypiska-iz-egrn-na-kvartiru/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-9] Starting: ${URLS.length} articles, userId=${USER_ID}`);
console.log(`[batch-rewrite-9] Clusters: zakazat-pasport(10), zakazat-vypiska/spravka(8), srochno(3), vypiska-types(4)`);
const start = Date.now();

await runBatchRewrite(USER_ID, URLS);

const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-9] DONE in ${mins} min`);
process.exit(0);
