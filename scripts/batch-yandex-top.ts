/**
 * YANDEX TOP-3 batch — deep rewrite for articles with high Yandex potential.
 *
 * Priority (Yandex Moskva positions as of 2026-04-02):
 *   freq 193 — как узнать владельца квартиры по адресу         pos WAS 1 → now 87 (CRITICAL DROP)
 *   freq 276 — кадастровый паспорт на квартиру                pos 36–54 (нестабильно)
 *   freq 582 — кадастровая стоимость в Росреестре             pos 20–36 → выпала
 *   freq  84 — как проверить квартиру на обременение          pos 45
 *   freq  51 — как узнать наложен ли арест на квартиру        pos 23
 *   freq  48 — как узнать квартира в залоге или нет           pos 25
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // freq=193 — была #1, упала до #87 — КРИТИЧНО
  'https://kadastrmap.info/kadastr/kak-uznat-vladeltsa-kvartiry-po-adresu-zakonnye-sposoby-i-vypiska/',
  // freq=276 — нестабильно 36–54
  'https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru/',
  // freq=582 — выпала из топ-100
  'https://kadastrmap.info/kadastr/kadastrovaya-stoimost-nedvizhimosti-v-rosreestre-kak-uznat/',
  // freq=84 — pos 45
  'https://kadastrmap.info/kadastr/kak-proverit-kvartiru-na-obremenenie/',
  // freq=51 — pos 23
  'https://kadastrmap.info/kadastr/kak-uznat-nalozhen-li-arest-na-kvartiru/',
  // freq=48 — pos 25
  'https://kadastrmap.info/kadastr/kak-uznat-kvartira-v-zaloge-ili-net/',
];

const USER_ID = 1;
console.log(`[batch-yandex-top] Starting: ${URLS.length} articles (Yandex top-3 push)`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-yandex-top] DONE in ${mins} min`);
