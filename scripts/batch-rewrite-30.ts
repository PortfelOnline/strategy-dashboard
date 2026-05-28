/**
 * Batch-30 (2026-05-28): GSC striking-distance — статьи /kadastr/ с positions 8-25
 *
 * Источник: GSC top-pages за 28 дней.
 * Критерий отбора: position 8-25, impressions > 500 (страницы с реальным
 * потенциалом роста — близко к топ-10).
 *
 * Цели:
 * — Push to top-5 для статей с position 10-15
 * — Поднять CTR через title/meta description там, где position топ-10
 *   но CTR низкий (signal: контент не отвечает на запрос)
 * — Расширить thin-content статьи (position 20+) до эталона 3500+ слов
 *
 * Pipeline применит: 6+ тематических картинок с уникальным alt + width/height,
 * 10+ FAQ в <details>, FAQPage/Article/BreadcrumbList schema, внутренняя
 * перелинковка, [PRICE_N_DISC] шорткоды, обновление meta description.
 *
 * Usage: npx tsx scripts/batch-rewrite-30.ts 2>&1 | tee /tmp/batch30.log
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';

const SLUGS = [
  // Highest impressions, position 12-15 → push to top-5
  'raspolozhenie-po-kadastrovomu-nomeru',           // pos 12.8, imp 2714, ctr 4.5%
  'kadastrovaya-publichnaya-karta-so-sputnika',     // pos 14.6, imp 2495, ctr 13.2%

  // Top-10 but very low CTR → title/meta + content depth issue
  'shtrafy-za-teplitsu-pravda-ili-vymysel',         // pos 8.0,  imp 1132, ctr 1.5%

  // High impressions, position 20+ → biggest ROI on content rewrite
  'kadastrovyj-nomer-po-adresu-obekta-nedvizhimosti', // pos 25.0, imp 1281, ctr 2.3%
  'proverit-kvartiru-v-rosreestre-po-adresu-onlajn',  // pos 22.5, imp 910,  ctr 3.0%
  'rosreestr-spravochnaya-informatsiya-po-obektam-nedvizhimosti-onlajn', // pos 17.2, imp 805

  // Mid-funnel pages with decent impressions, position 13-18
  'publichnaya-kadastrovaya-karta-moskvy',          // pos 17.6, imp 703
  'kadastrovye-koordinaty',                          // pos 13.4, imp 683
  'kadastrovyj-plan-zemelnogo-uchastka',             // pos 16.7, imp 573
  'poluchit-vypisku-egrn-po-kadastrovomu-nomeru',    // pos 24.5, imp 517
];

const URLS = SLUGS.map(s => `${BASE}${s}/`);
const USER_ID = 1;

console.log(`[batch-30] Starting: ${URLS.length} articles`);
console.log(`[batch-30] Source: GSC striking-distance (28 days)`);
console.log(URLS.map((u, i) => `  ${i + 1}. ${u}`).join('\n'));

const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-30] DONE in ${mins} min`);
