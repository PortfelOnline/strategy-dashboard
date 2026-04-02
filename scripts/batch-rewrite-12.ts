/**
 * Batch 12: 25 HIGH-priority articles
 * Focus: kadastrovyj-plan variants, kak-poluchit/zakazat/vosstanovit/vyglyadit,
 *        kak-uznat-sobstvennika cluster
 *
 * Usage: npx tsx scripts/batch-rewrite-12.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-plan/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-territorii-obrazets/',
  'https://kadastrmap.info/kadastr/kak-poluchit-kadastrovyj-pasport-na-zdanie-yuridicheskomu-litsu/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-egrn-cherez-portal-gosuslug/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-iz-egrn-v-rezhime-onlajn-v-rosreestr/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-kvartiry-po-adresu-onlajn-rosreestr-2/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-kvartiry-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-nedvizhimosti-po-adresu/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-uchastka/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-uchastka-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-zemelnogo-uchastka-po-adresu/',
  'https://kadastrmap.info/kadastr/kak-vosstanovit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-vosstanovit-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-kadastrovyj-pasport/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-vypiska-iz-egrn-ob-obekte-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kak-zakazat-kadastrovye-uslugi/',
  'https://kadastrmap.info/kadastr/kak-zakazat-kadastrovyj-pasport-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/kak-zakazat-kadastrovyj-pasport-na-zemlyu/',
  'https://kadastrmap.info/kadastr/kak-zakazat-kadastrovyj-pasport-v-moskve-polnoe-rukovodstvo/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-eto-novyj-vzglyad-na-gosregistrtsiyu/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-v-2017-godu/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershennogo-stroitelstva/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru-mfts/',
];

const USER_ID = 1;

console.log(`[batch-rewrite-12] Starting: ${URLS.length} articles, userId=${USER_ID}`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`\n[batch-rewrite-12] DONE in ${mins} min`);
process.exit(0);
