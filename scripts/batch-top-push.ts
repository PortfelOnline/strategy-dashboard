/**
 * TOP PUSH batch — second-pass rewrite for articles already on page 1 (pos ≤ 30).
 * Goal: push them into top-3 by deepening competitor gap analysis.
 *
 * Priority order (Google positions as of 2026-04-01):
 *   pos  2 — чем отличается ситуационный план от кадастрового плана
 *   pos  5 — кадастровая публичная карта со спутника
 *   pos  5 — ситуационный план для строительства дома
 *   pos  9 — заказать кадастровую выписку онлайн
 *   pos  9 — справка об обременении недвижимости в Москве
 *   pos 10 — расположение по кадастровому номеру (freq 18)
 *   pos 14 — как проверить собственника по кадастровому номеру онлайн
 *   pos 27 — ситуационный план для ижс
 *   pos 27 — проверить квартиру на обременение онлайн (freq 22)
 *   pos 27 — как узнать квартира в аресте или нет (freq 33)
 *   pos 28 — план помещения и кадастровая выписка
 *   pos 30 — выписка ЕГРН обременение
 *   pos 30 — проверить квартиру арест судебных приставов
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  // pos=2 — уже почти топ-1, нужно дожать
  'https://kadastrmap.info/kadastr/chem-otlichaetsya-situatsionnyj-plan-ot-kadastrovogo-plana-uchastka/',
  // pos=5
  'https://kadastrmap.info/kadastr/kadastrovaya-publichnaya-karta-so-sputnika/',
  'https://kadastrmap.info/kadastr/situatsionnyj-plan-dlya-stroitelstva-doma-poryadok-i-dokumenty/',
  // pos=9
  'https://kadastrmap.info/kadastr/zakazat-kadastrovuyu-vypisku-onlajn-tsena-sposoby-polucheniya/',
  'https://kadastrmap.info/kadastr/zakazat-spravku-ob-obremenenii-nedvizhimosti-v-moskve-poshagovoe-rukovodstvo/',
  // pos=10 freq=18
  'https://kadastrmap.info/kadastr/raspolozhenie-po-kadastrovomu-nomeru/',
  // pos=14
  'https://kadastrmap.info/kadastr/kak-proverit-sobstvennika-po-kadastrovomu-nomeru-onlajn/',
  // pos=27
  'https://kadastrmap.info/kadastr/situatsionnyj-plan-dlya-izhs-zachem-nuzhen-i-kak-zakazat-onlajn-bez-ocheredej/',
  'https://kadastrmap.info/kadastr/proverit-kvartiru-na-obremenenie-onlajn/',
  'https://kadastrmap.info/kadastr/kak-uznat-kvartira-v-arest-ili-net/',
  // pos=28
  'https://kadastrmap.info/kadastr/plan-pomeshheniya-i-kadastrovaya-vypiska-kak-oni-svyazany/',
  // pos=30
  'https://kadastrmap.info/kadastr/vypiska-egrn-obremenenie/',
  'https://kadastrmap.info/kadastr/proverit-kvartiru-arest-sudebnyh-pristavov/',
];

const USER_ID = 1;
console.log(`[batch-top-push] Starting: ${URLS.length} articles (fresh SERP + deep competitor analysis)`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-top-push] DONE in ${mins} min`);
