/**
 * Batch-24: 40 HIGH-priority unimproved articles (2026-04-07)
 * Выписки, справки, обременения, проверка недвижимости
 * Usage: npx tsx scripts/batch-rewrite-24.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';
const SLUGS = [
  // Справки и выписки ЕГРН — прямой заказ
  'spravku-egrn-cherez-internet',
  'spravka-na-dom-v-egrn',
  'spravka-egrn-po-vsej-rossii',
  'chto-takoe-predostavlenie-svedenij-iz-egrn',
  'vypiska-dlya-ooo-iz-egrn',
  'gde-vzyat-spravku-egrn',
  'kak-skachat-vypisku-egrn',
  'vypiska-na-zdanie-iz-egrn',
  'usluga-onlajn-vypiska-egrn-iz-rosreestra',
  'chto-takoe-predstavlenie-vypiski-iz-egrn',
  'kak-uznat-nomer-egrn-kvartiry',
  'spravka-egrn-na-nedvizhimoe-imushhestvo',
  'zaprosit-vypisku-iz-egrn-v-rosreestre',
  'pochemu-v-vypiske-net-kadastrovoj-stoimosti',
  'kto-daet-vypisku-iz-egrn',
  'skolko-zhdat-vypisku-iz-egrn',
  'vypiska-o-sobstvennosti-kvartiry-iz-egrn',
  'spravka-egrn-o-prave-sobstvennosti',

  // Обременения — высокий интент
  'chto-znachit-dolya-pod-obremeneniem',
  'kak-snyat-obremenenie-cherez-rosreestr',
  'proverit-kvartiru-na-obremenenie-pri-pokupke-bystryj-sposob',
  'kak-pokupat-kvartiru-s-obremeneniem-ipotekoj',
  'kak-kupit-kvartiru-bez-obremenenij',
  'kak-prodat-dom-s-obremeneniem',
  'chto-delat-esli-rosreestr-ne-vydaet-vypiski-iz-egrn',
  'chto-znachit-kvartira-s-obremeneniem',
  'kak-snyat-obremenenie-s-kvartiry-po-voennoj-ipoteke',
  'chto-delat-posle-snyatiya-obremeneniya-po-ipoteke',
  'kak-snyat-obremenenie-s-kvartiry-v-mfts',
  'kak-snyat-obremenenie-posle-vyplaty-materinskogo-kapitala',

  // Кадастровая стоимость
  'uznat-kadastrovuyu-stoimost-doma-onlajn-instruktsiya',
  'kak-uznat-zapis-egrn-kvartiry',
  'kak-opredelyaetsya-kadastrovaya-stoimost-uchastka',
  'kak-kupit-zemlyu-po-kadastrovoj-stoimosti',
  'kakoj-dokument-podtverzhdaet-pravo-sobstvennosti-na-kvartiru',
  'kak-uznat-kadastrovyj-nomer-zemelnogo-uchastka',

  // Проверка и поиск
  'uznat-kakaya-nedvizhimost-zaregistrirovana-na-cheloveka',
  'kak-proverit-zemelnyj-uchastok-po-kadastrovomu-nomeru-onlajn',
  'egrn-chto-eto-takoe-rasshifrovka',
  'spravka-iz-egrn-dlya-registratsii',
];

const URLS = [...new Set(SLUGS)].map(s => `${BASE}${s}/`);
console.log(`[batch-24] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(1, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-24] DONE in ${mins} min`);
