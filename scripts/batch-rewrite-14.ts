/**
 * Batch 14: 10 HIGH tier — diverse kadastrovyj-pasport cluster + high-intent queries
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // Высокий коммерческий интент
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-iz-egrn-v-rezhime-onlajn-v-rosreestr/',
  'https://kadastrmap.info/kadastr/kak-poluchit-vypisku-egrn-cherez-portal-gosuslug/',
  'https://kadastrmap.info/kadastr/kak-uznat-sobstvennika-kvartiry-po-adresu-onlajn-rosreestr-2/',
  // Кадастровый паспорт (топовый кластер)
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershenki/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kak-vosstanovit-kadastrovyj-pasport-na-kvartiru/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obrazets/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-uchastka/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-skolko-dejstvitelen/',
  'https://kadastrmap.info/kadastr/kadastrovyj-plan/',
];

const USER_ID = 1;
console.log(`[batch-14] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-14] DONE in ${mins} min`);
