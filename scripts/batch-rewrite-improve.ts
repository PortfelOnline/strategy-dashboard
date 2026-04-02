/**
 * Batch: re-process top-positioned articles with fresh competitor analysis.
 * Priority: queries with existing Google positions 5–100 that can be pushed higher.
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // pos=5  — almost top-3!
  'https://kadastrmap.info/kadastr/proverit-kvartiru-na-obremenenie-onlajn/',
  // pos=29
  'https://kadastrmap.info/kadastr/raspolozhenie-po-kadastrovomu-nomeru/',
  // pos=36 — кадастровый паспорт (высокочастотник freq=276)
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-kvartiry/',
  // pos=39
  'https://kadastrmap.info/kadastr/kak-proverit-ne-v-zaloge-li-kvartira/',
  // pos=46
  'https://kadastrmap.info/kadastr/kak-uznat-kvartira-v-zaloge-ili-net/',
  // pos=56 — freq=84
  'https://kadastrmap.info/kadastr/kak-proverit-kvartiru-na-obremenenie/',
  // pos=71 — freq=51
  'https://kadastrmap.info/kadastr/kak-uznat-nalozhen-li-arest-na-kvartiru/',
  // обременение (смежные — могут ранжироваться)
  'https://kadastrmap.info/kadastr/arest-kvartiry-obremeneniem/',
  'https://kadastrmap.info/kadastr/kak-snyat-obremenenie-s-kvartiry/',
  // собственник (freq=193 — высокочастотник)
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-kvartiry-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-nedvizhimosti-po-adresu/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-uchastka/',
  // кадастровый план квартиры (pos=34)
  'https://kadastrmap.info/kadastr/kadastrovyj-plan-kvartiry-po-adresu/',
];

const USER_ID = 1;
console.log(`[batch-improve] Starting: ${URLS.length} articles (re-process with fresh SERP)`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-improve] DONE in ${mins} min`);
