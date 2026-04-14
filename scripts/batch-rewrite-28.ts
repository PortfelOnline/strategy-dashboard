/**
 * Batch-28 (2026-04-14): Дача, ипотека, оформление земли/домов
 *
 * Group 1 — Дачная амнистия / садовые участки (высокий intent)
 * Group 2 — Ипотека + Росреестр
 * Group 3 — Оформление: земля, дом, объединение
 *
 * Usage: npx tsx scripts/batch-rewrite-28.ts 2>&1 | tee /tmp/batch28.log
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';

// ── Group 1: Дача / садовые участки ──────────────────────────────────────────
const SLUGS_DACHA = [
  'kak-oformit-dachnuyu-amnistiyu',
  'kak-oformit-dachnyj-uchastok-v-sobstvennost-esli-umershij-ne-oformil-na-nego-pravo',
  'kadastrovyj-pasport-na-sadovyj-uchastok',
  'kadastrovyj-pasport-na-sadovyj-domik',
  'kadastrovyj-pasport-na-dom-dachnyj',
  'kadastrovyj-pasport-na-dachnyj-uchastok',
  'kadastrovyj-pasport-dachnyj-domik',
  'chto-takoe-sadovyj-dom',
  'vypiska-iz-egrn-na-sadovyj-dom',
  'obyazan-li-pensioner-oplachivat-nalog-na-zemelnyj-ili-dachnyj-uchastok',
];

// ── Group 2: Ипотека ──────────────────────────────────────────────────────────
const SLUGS_IPOTEKA = [
  'skolko-dnej-registriruetsya-ipoteka-v-rosreestre',
  'voennaya-ipoteka-osobennosti-oformleniya-kvartiry-v-kredit',
  'vypiska-iz-egrp-obremenenie-ipoteka',
];

// ── Group 3: Оформление земли и домов ────────────────────────────────────────
const SLUGS_OFORMLENIE = [
  'kak-oformit-zemelnyj-uchastok-bez-lishnej-suety',
  'kak-oformit-dom-v-rosreestre',
  'kak-oformit-obedinenie-zemelnyh-uchastkov-polnyj-i-prakticheskij-gid',
  'kak-oformit-zemli-lesnogo-fonda-v-sobstvennost',
  'kak-oformit-kadastrovyj-pasport-na-kvartiru-v-novostrojke',
  'kak-oformit-kadastrovyj-pasport-na-zemelnyj-uchastok',
  'kak-oformit-kadastrovyj-pasport',
  'kak-oformit-kadastrovyj-pasport-na-dom',
  'kak-oformit-kadastrovyj-pasport-na-dachnyj-uchastok',
  'kak-oformit-kadastrovyj-pasport-na-kvartiru',
  'kak-oformit-kadastrovyj-pasport-na-dachnyj-dom',
  'kak-prodat-garazh-storonnemu-litsu',
];

const ALL_SLUGS = [
  ...SLUGS_DACHA,
  ...SLUGS_IPOTEKA,
  ...SLUGS_OFORMLENIE,
];

const URLS = [...new Set(ALL_SLUGS)].map(s => `${BASE}${s}/`);
console.log(`Batch-28: ${URLS.length} URLs`);

const start = Date.now();
await runBatchRewrite(1, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-28] DONE in ${mins} min`);
