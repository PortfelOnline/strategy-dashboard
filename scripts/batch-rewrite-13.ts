/**
 * Batch 13: 5 HIGH tier articles (kadastrovyj-pasport cluster)
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-chto-eto-za-dokument/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-kvartiry-gde-poluchit/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-dom-onlajn-rosreestr/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-obekta-nedvizhimosti-eto/',
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru-mfts/',
];

const USER_ID = 1;
console.log(`[batch-13] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-13] DONE in ${mins} min`);
