/**
 * Batch 19: 35 remaining articles
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/nalog-po-kadastrovoj-stoimosti/',
  'https://kadastrmap.info/kadastr/oformlenie-soglasovaniya-pereplanirovki-zhilya/',
  'https://kadastrmap.info/kadastr/tehnoparki-moskvy-poluchayut-gospodderzhku-i-nabirayut-oboroty/',
  'https://kadastrmap.info/kadastr/rosreestru-predostavyat-pravo-izmenyat-nazvaniya-naselennyh-punktov/',
  'https://kadastrmap.info/kadastr/kak-proverit-dannye-zemelnogo-uchastka-onlajn/',
  'https://kadastrmap.info/kadastr/bezopasnost-sdelki-na-pervom-meste/',
  'https://kadastrmap.info/kadastr/kak-mozhno-uznat-informatsiyu-o-nedvizhimosti-konkretnogo-cheloveka/',
  'https://kadastrmap.info/kadastr/obshhaya-dolya-granits-mezhdu-naselennymi-punktami-v-rf-zaregistrirovana-v-30-ot-neobhodimogo/',
  'https://kadastrmap.info/kadastr/osnovnye-zadachi-reestra-nedvizhimosti-v-rossii/',
  'https://kadastrmap.info/kadastr/kak-poluchit-svedeniya-iz-reestra-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/mozhno-li-vosstanovit-na-chastnyj-dom-domovuyu-knigu/',
  'https://kadastrmap.info/kadastr/srok-arendy-zu-v-publichnoj-sobstvennosti-uvelichat-na-3-goda-iz-za-covid-19/',
  'https://kadastrmap.info/kadastr/kakie-vozmozhnosti-daet-kadastrovaya-karta-rossii/',
  'https://kadastrmap.info/kadastr/kak-uznat-inventarizatsionnuyu-stoimost-obekta-nedvizhimosti-onlajn/',
  'https://kadastrmap.info/kadastr/chto-zapreshheno-stroit-na-dache/',
  'https://kadastrmap.info/kadastr/mozhno-li-postroit-domik-v-lesu/',
  'https://kadastrmap.info/kadastr/vse-chto-nuzhno-znat-pro-nyuansy-dachnoj-amnistii-v-rossii/',
  'https://kadastrmap.info/kadastr/sposoby-podachi-uvedomleniya-o-planiruemom-stroitelstve-doma/',
  'https://kadastrmap.info/kadastr/u-rosreestra-novaya-baza-ucheta/',
  'https://kadastrmap.info/kadastr/kak-razdelit-obekt-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/za-chto-mogut-oshtrafovat-vladeltsev-zemelnyh-uchastkov-s-2021-goda/',
  'https://kadastrmap.info/kadastr/nuzhno-li-mezhevat-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/dachnye-zemli-mogut-poluchit-status-selskie-territorii/',
  'https://kadastrmap.info/kadastr/garazhnaya-amnistiya-2021-goda/',
  'https://kadastrmap.info/kadastr/obyazatelno-li-vnosit-svedeniya-o-pereplanirovke-v-egrn/',
  'https://kadastrmap.info/kadastr/kak-izbezhat-otkaza-v-postanovke-na-kadastrovyj-uchet/',
  'https://kadastrmap.info/kadastr/zachem-nuzhen-adres-dlya-nedvizhimosti-i-pochemu-eto-vazhno-dlya-vypiski-iz-egrn-po-adresu-doma/',
  'https://kadastrmap.info/kadastr/poshlina-za-vypisku-iz-egrn/',
  'https://kadastrmap.info/kadastr/chto-mozhno-uznat-iz-egrn/',
  'https://kadastrmap.info/kadastr/kak-uznat-zapis-egrn-kvartiry/',
  'https://kadastrmap.info/kadastr/skolko-zhdat-vypisku-iz-egrn/',
  'https://kadastrmap.info/kadastr/kto-daet-vypisku-iz-egrn/',
  'https://kadastrmap.info/kadastr/chto-znachit-dolya-pod-obremeneniem/',
  'https://kadastrmap.info/kadastr/chto-znachit-kadastrovaya-stoimost-doma/',
  'https://kadastrmap.info/kadastr/kak-uznat-staryj-kadastrovyj-nomer/',
];

const USER_ID = 1;
console.log(`[batch-19] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-19] DONE in ${mins} min`);
