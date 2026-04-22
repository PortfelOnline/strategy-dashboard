/**
 * Batch 20: 35 remaining articles (обременения, кадастровая стоимость, снятие обременений)
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/chto-znachit-obremenenie-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/rosreestr-zapustil-servis-po-otslezhivaniyu-teplyh-sdelok/',
  'https://kadastrmap.info/kadastr/chto-znachit-kvartira-s-obremeneniem/',
  'https://kadastrmap.info/kadastr/kak-snyat-obremenenie-cherez-rosreestr/',
  'https://kadastrmap.info/kadastr/registratsiya-sdelki-s-nedvizhimostyu-stanet-proshhe-cherez-notariusa/',
  'https://kadastrmap.info/kadastr/ot-chego-zavisit-kadastrovaya-stoimost-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/pochemu-uchastok-ne-otobrazhaetsya-na-kadastrovoj-karte/',
  'https://kadastrmap.info/kadastr/kak-opredelyaetsya-kadastrovaya-stoimost-uchastka/',
  'https://kadastrmap.info/kadastr/avarijnye-doma-poyavyatsya-v-baze-rosreestre/',
  'https://kadastrmap.info/kadastr/kak-kupit-kvartiru-bez-obremenenij/',
  'https://kadastrmap.info/kadastr/kak-pokupat-kvartiru-s-obremeneniem-ipotekoj/',
  'https://kadastrmap.info/kadastr/rosreestr-sozdaet-edinuyu-ploshhadku-s-otsenshhikami/',
  'https://kadastrmap.info/kadastr/chto-delat-posle-snyatiya-obremeneniya-po-ipoteke/',
  'https://kadastrmap.info/kadastr/rosreestr-razrabotal-metodichku-dlya-grazhdan-po-garazhnoj-amnistii/',
  'https://kadastrmap.info/kadastr/kak-najti-uchastok-na-publichnoj-kadastrovoj-karte/',
  'https://kadastrmap.info/kadastr/kak-najti-zdanie-na-publichnoj-kadastrovoj-kart/',
  'https://kadastrmap.info/kadastr/kak-posmotret-zony-na-kadastrovoj-karte/',
  'https://kadastrmap.info/kadastr/kak-sohranit-kadastrovuyu-kartu/',
  'https://kadastrmap.info/kadastr/kak-kupit-zemlyu-po-kadastrovoj-stoimosti/',
  'https://kadastrmap.info/kadastr/kak-obedinit-dva-kadastrovyh-nomera-zemelnyh-uchastkov/',
  'https://kadastrmap.info/kadastr/chto-takoe-vypiska-egrn-na-zemelnyj-uchastok/',
  'https://kadastrmap.info/kadastr/rosreestr-dal-razyasnenie-kak-budet-rabotat-dlya-grazhdan-i-mestnyh-organov-vlasti-zakon-o-ranee-uchtennyh-obektah-nedvizhimosti-prava-sobstvennikov-soblyudeny/',
  'https://kadastrmap.info/kadastr/kak-snyat-obremenenie-s-kvartiry-po-voennoj-ipoteke/',
  'https://kadastrmap.info/kadastr/kak-snyat-obremenenie-s-kvartiry-v-mfts/',
  'https://kadastrmap.info/kadastr/kak-prodat-dom-s-obremeneniem/',
  'https://kadastrmap.info/kadastr/kak-snyat-obremenenie-posle-vyplaty-materinskogo-kapitala/',
  'https://kadastrmap.info/kadastr/rosreestr-fiksiruet-rost-udalennoj-pokupki-kvartir-rossii/',
  'https://kadastrmap.info/kadastr/kak-opredelyaetsya-kadastrovaya-stoimost-obekta-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kogda-menyaetsya-kadastrovaya-stoimost-obekta-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kak-schitat-nalog-ot-kadastrovoj-stoimosti/',
  'https://kadastrmap.info/kadastr/pochemu-v-vypiske-net-kadastrovoj-stoimosti/',
  'https://kadastrmap.info/kadastr/kak-postavit-na-kadastrovyj-uchet-sooruzhenie/',
  'https://kadastrmap.info/kadastr/chto-delat-pri-zadvoenii-kadastrovogo-nomera/',
  'https://kadastrmap.info/kadastr/chto-takoe-kadastrovyj-nomer-kvartiry/',
  'https://kadastrmap.info/kadastr/kak-uznat-kto-propisan-po-kadastrovomu-nomeru/',
];

const USER_ID = 1;
console.log(`[batch-20] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-20] DONE in ${mins} min`);
