/**
 * Batch 11: 25 HIGH-priority articles
 * Focus: kadastrovyj-pasport misc variants — chto-eto, foto, obrazets,
 *        zhiloj-dom, mfts, garazh, obekty, zdaniya clusters
 *
 * Usage: npx tsx scripts/batch-rewrite-11.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-chto-eto-za-dokument/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-dachnyj-domik/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-dlya-yuridicheskih-lits-stoimost/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-foto/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-i-kadastrovyj-plan/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-kvartiry-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-mnogokvartirnogo-zhilogo-doma/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-chast-zhilogo-doma/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-dom-onlajn-rosreestr/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-garazhnyj-boks/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru-mfts/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obekta-nedvizhimosti-eto/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obekta-nedvizhimosti-stoimost-2/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obekta-nezavershennogo-stroitelstva/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obrazets/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-rf/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-skolko-dejstvitelen/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-tsena-voprosa/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-uchastka-stoimost/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-obrazets/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershenki/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zemelnogo-uchastka-ufa/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zhilya/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-snt/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-11] Starting: ${URLS.length} articles, userId=${USER_ID}`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-11] DONE in ${mins} min`);
process.exit(0);
