/**
 * Rewrite: кадастровый паспорт здания сооружения объекта незавершенки
 * Статья имеет мусорный контент в нижней части — полная перезапись.
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-zdaniya-sooruzheniya-obekta-nezavershenki/',
];

const USER_ID = 1;
console.log(`[rewrite-nezavershenka] Starting`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[rewrite-nezavershenka] DONE in ${mins} min`);
