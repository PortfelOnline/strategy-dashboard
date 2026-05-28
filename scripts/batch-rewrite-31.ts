/**
 * Batch-31 (2026-05-28): GSC striking-distance, second wave
 *
 * Запускать ПОСЛЕ batch-30 (избегаем гонок WP-публикации одного и того же
 * сайта). Кандидаты — из тех же GSC-данных, но position 11-25 и
 * impressions 200-500 (второй эшелон по приоритету).
 *
 * Usage: NO_PROXY=...,kadastrmap.info npx tsx scripts/batch-rewrite-31.ts 2>&1 | tee /tmp/batch31.log
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';

const SLUGS = [
  // RETRY из batch-30: QA FAIL (2007/2200 слов), нужен повторный rewrite
  'kadastrovye-koordinaty',                                  // batch-30 retry

  // position 20-30 (большой запас на рост)
  'uznat-kadastrovuyu-stoimost-kvartiry-po-adresu-moskva',  // pos 20.6, imp 346
  'situatsionnyj-plan-zemelnogo-uchastka',                  // pos 22.6, imp 319
  'granitsy-zemelnogo-uchastka',                            // pos 27.6, imp 300
  'uznat-sobstvennika-zemelnogo-uchastka-po-kadastrovomu-nomeru', // pos 22.9, imp 241
  'kadastrovyj-plan-zemelnogo-uchastka-onlajn',             // pos 18.3, imp 249
  'kadastrovyj-tehnicheskij-plan-doma',                     // pos 31.9, imp 220
  'publichnaya-kadastrovaya-karta-irkutskoj-oblasti',       // pos 11.1, imp 244

  // position 10-18 с приличными impressions
  'kadastrovyj-kvartal',                                    // pos 11.2, imp 219
  'kadastrovyj-plan-kvartiry-gde-poluchit',                 // pos 10.9, imp 225
  'kadastrovaya-stoimost-nedvizhimosti-v-samare',           // pos 11.8, imp 216
];

const URLS = SLUGS.map(s => `${BASE}${s}/`);
const USER_ID = 1;

console.log(`[batch-31] Starting: ${URLS.length} articles`);
console.log(`[batch-31] Source: GSC striking-distance, second wave`);
console.log(URLS.map((u, i) => `  ${i + 1}. ${u}`).join('\n'));

const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-31] DONE in ${mins} min`);
