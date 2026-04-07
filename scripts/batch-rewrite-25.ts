/**
 * Batch-25: 35 HIGH-priority unimproved articles (2026-04-07)
 * Проверка при покупке, справки ЕГРН, технические планы, межевание
 * Usage: npx tsx scripts/batch-rewrite-25.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';
const SLUGS = [
  // Проверка при покупке / обременения
  'kak-proverit-dom-pered-pokupkoj-na-obremenenie',
  'kak-proverit-kvartiru-v-rosreestre-na-obremenenie',
  'kak-proverit-zemlyu-na-obremenenie-po-kadastrovomu-nomeru',
  'chto-mozhno-delat-s-kvartiroj-v-ipoteke-bez-vedoma-banka',
  'obremeneniya-i-ogranicheniya-na-kvartiru-chto-nuzhno-znat-pokupatelyu',
  'kak-proverit-kvartiru-na-obremenenie-samostoyatelno',
  'kak-proverit-kvartiru-na-obremeneniya-pered-pokupkoj-poshagovaya-instruktsiya',
  'proverit-kvartiru-pered-pokupkoj-onlajn-poshagovoe-rukovodstvo',
  'zaschita-prav-obremenenie-nedvizhimosti',
  'chto-takoe-obremenenie-nedvizhimosti-kak-proverit-i-izbezhat',

  // Справки ЕГРН — получение, стоимость, виды
  'gde-poluchayut-spravku-egrn',
  'kakie-nuzhny-dokumenty-dlya-spravki-iz-egrn',
  'dokumenty-dlya-spravki-egrn',
  'spravka-egrn-zakazat-cherez-rosreestr',
  'spravka-egrn-skolko-stoit',
  'spravka-egrn-skolko-delaetsya-po-vremeni',
  'stoimost-spravki-egrn',
  'spravka-egrn-chto-eto-i-gde-poluchit',
  'spravka-iz-egrn-o-nedvizhimosti',
  'gde-zakazyvat-spravku-egrn',

  // Выписки ЕГРН — виды, стоимость, получение
  'vidy-vypisok-iz-egrn',
  'vidy-vypisok-iz-egrn-na-zemelnyj-uchastok',
  'gde-poluchayut-vypisku-iz-egrn-na-kvartiru',
  'skolko-stoit-vypiska-iz-egrn-v-mfts',
  'srochnaya-vypiska-iz-egrn-v-mfts',
  'kak-vosstanovit-vypisku-iz-egrn',
  'tsena-vypiski-iz-egrn-na-zemelnyj-uchastok',
  'srok-dejstviya-vypiski-iz-egrn-ob-obekte-nedvizhimosti',
  'kak-poluchit-novuyu-vypisku-iz-egrn',
  'zakazat-vypisku-iz-egrn-o-kadastrovoj-stoimosti-obekta-nedvizhimosti',
  'vypiska-iz-egrn-pri-arende-kvartiry',
  'zemelnaya-spravka-iz-egrn',
  'vypiska-iz-egrn-po-obremeneniyam',
  'chto-mozhno-uznat-iz-vypiski-egrn',
  'egrn-vypiski-optom',
];

const URLS = [...new Set(SLUGS)].map(s => `${BASE}${s}/`);
console.log(`[batch-25] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(1, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-25] DONE in ${mins} min`);
