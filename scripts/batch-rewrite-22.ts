/**
 * Batch 22: 36 remaining articles (планы помещений, кадастровые карты онлайн, аресты, финал)
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/situatsionnyj-plan-chastnogo-doma-dlya-gazifikatsii/',
  'https://kadastrmap.info/kadastr/situatsionnyj-plan-predpriyatiya/',
  'https://kadastrmap.info/kadastr/spravka-egrn-s-rosreestra/',
  'https://kadastrmap.info/kadastr/gde-vzyat-vypisku-egrn-na-kvartiru-v-moskve/',
  'https://kadastrmap.info/kadastr/plan-pomeshhenij-chertezh/',
  'https://kadastrmap.info/kadastr/kak-sozdat-idealnuyu-planirovku-kvartiry-shemy-i-onlajn-instrumenty/',
  'https://kadastrmap.info/kadastr/plan-pomeshhenij-po-adresu-planirovka-kvartiry-v-dokumentah/',
  'https://kadastrmap.info/kadastr/shema-planirovki-dvuhkomnatnoj-kvartiry/',
  'https://kadastrmap.info/kadastr/shema-i-planirovka-kvartiry-hrushhevki/',
  'https://kadastrmap.info/kadastr/kak-uznat-tehnicheskij-plan-kvartiry/',
  'https://kadastrmap.info/kadastr/tehnicheskij-plan-nezhilogo-pomeshheniya/',
  'https://kadastrmap.info/kadastr/informatsiya-o-kvartire/',
  'https://kadastrmap.info/kadastr/otchet-o-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/besplatnyj-onlajn-plan-chertezh-pomeshhenij-kvartiry/',
  'https://kadastrmap.info/kadastr/publichnaya-kadastrovaya-karta-sputnikovaya-semka/',
  'https://kadastrmap.info/kadastr/sputnikovaya-semka-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/plan-pomeshheniya-dlya-arendy-ili-prodazhi-zachem-on-nuzhen-i-kak-ego-oformit/',
  'https://kadastrmap.info/kadastr/plan-pomeshheniya-kogda-on-nuzhen-i-kak-ego-poluchit/',
  'https://kadastrmap.info/kadastr/kak-izbezhat-aresta-kvartiry-sovety-sobstvenniku/',
  'https://kadastrmap.info/kadastr/arest-nedvizhimosti-chto-delat-i-kak-zashhitit-svoi-prava/',
  'https://kadastrmap.info/kadastr/najti-uchastok-po-kadastrovomu-nomeru-onlajn-podrobnaya-instruktsiya/',
  'https://kadastrmap.info/kadastr/kadastrovaya-karta-s-granitsami-uchastkov-polnoe-rukovodstvo-2025-goda/',
  'https://kadastrmap.info/kadastr/publichnaya-kadastrovaya-karta-s-koordinatami-kak-poluchit-dannye-ob-obekte-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kadastrovaya-karta-rossii-onlajn-besplatno-dannye-nedvizhimosti/',
  'https://kadastrmap.info/kadastr/kak-proverit-zemelnyj-uchastok-po-adresu-instruktsiya/',
  'https://kadastrmap.info/kadastr/publichnaya-kadastrovaya-karta-rosreestra-onlajn-poisk/',
  'https://kadastrmap.info/kadastr/kak-najti-uchastok-po-kadastrovomu-nomeru-onlajn-besplatno/',
  'https://kadastrmap.info/kadastr/interaktivnaya-kadastrovaya-karta-onlajn/',
  'https://kadastrmap.info/kadastr/kak-rabotat-s-kadastrovoj-kartoj-onlajn-instruktsiya-i-sovety/',
  'https://kadastrmap.info/kadastr/proverit-nedvizhimost-cherez-rosreestr-onlajn-kak-uznat-vsyo-ob-obekte/',
  'https://kadastrmap.info/kadastr/kak-opredelit-granitsy-uchastka-po-kadastrovomu-nomeru-poshagovo/',
  'https://kadastrmap.info/kadastr/proverit-kvartiru-na-obremenenie-pri-pokupke-bystryj-sposob/',
  'https://kadastrmap.info/kadastr/chto-delat-esli-kadastrovyj-nomer-ne-najden-instruktsiya/',
  'https://kadastrmap.info/kadastr/posmotret-kadastrovuyu-kartu-v-realnom-vremeni/',
  'https://kadastrmap.info/kadastr/uznat-kadastrovuyu-stoimost-doma-onlajn-instruktsiya/',
  'https://kadastrmap.info/kadastr/rosreestr-2026-proverka-obremenij-stala-obyazatelnoj-pri-ipotechnykh-sdelkakh/',
];

const USER_ID = 1;
console.log(`[batch-22] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-22] DONE in ${mins} min`);
