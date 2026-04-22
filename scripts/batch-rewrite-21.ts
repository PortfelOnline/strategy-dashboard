/**
 * Batch 21: 35 remaining articles (реестры, технические планы, выписки, ситуационные планы)
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = [
  'https://kadastrmap.info/kadastr/rosreestr-razrabotal-dajdzhest-izmenenij-po-zemelnym-voprosam-i-obektam-stroitelstva/',
  'https://kadastrmap.info/kadastr/kak-proverit-egrn/',
  'https://kadastrmap.info/kadastr/reestr-sobstvennikov-i-chlenov-tszh/',
  'https://kadastrmap.info/kadastr/reestr-obektov-zhilishhnogo-fonda/',
  'https://kadastrmap.info/kadastr/reestr-vvedennyh-v-ekspluatatsiyu-obektov/',
  'https://kadastrmap.info/kadastr/uznat-kakaya-nedvizhimost-zaregistrirovana-na-cheloveka/',
  'https://kadastrmap.info/kadastr/registratsiya-nedvizhimosti-za-odin-den/',
  'https://kadastrmap.info/kadastr/kak-uznat-koordinaty-zemelnogo-uchastka-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/tehnicheskij-plan-snt/',
  'https://kadastrmap.info/kadastr/kadastrovyj-tehnicheskij-plan-doma/',
  'https://kadastrmap.info/kadastr/tehnicheskij-plan-dlya-kadastrovogo-ucheta/',
  'https://kadastrmap.info/kadastr/kak-poluchit-reestr-pomeshhenij-mnogokvartirnogo-doma/',
  'https://kadastrmap.info/kadastr/kak-poluchit-reestr-sobstvennikov-zhilya-mnogokvartirnogo-doma/',
  'https://kadastrmap.info/kadastr/reestr-sobstvennikov-pomeshhenij-v-mnogokvartirnom-dome/',
  'https://kadastrmap.info/kadastr/kak-sobrat-sobranie-sobstvennikov-mnogokvartirnogo-doma/',
  'https://kadastrmap.info/kadastr/reestr-sobstvennikov-zhilya-2/',
  'https://kadastrmap.info/kadastr/karta-geodezii/',
  'https://kadastrmap.info/kadastr/kak-uznat-kadastrovyj-nomer-zemelnogo-uchastka/',
  'https://kadastrmap.info/kadastr/kak-najti-uchastok-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/kak-najti-nedvizhimost-po-kadastrovomu-nomeru/',
  'https://kadastrmap.info/kadastr/vypiska-o-sobstvennosti-kvartiry-iz-egrn/',
  'https://kadastrmap.info/kadastr/dokumenty-na-poluchenie-spravki-iz-egrn/',
  'https://kadastrmap.info/kadastr/kak-vyglyadit-situatsionnyj-plan/',
  'https://kadastrmap.info/kadastr/kak-poluchit-situatsionnyj-plan/',
  'https://kadastrmap.info/kadastr/spravka-egrn-o-prave-sobstvennosti/',
  'https://kadastrmap.info/kadastr/chto-takoe-vypiska-iz-egrn-na-zemlyu-i-dom/',
  'https://kadastrmap.info/kadastr/chto-takoe-vypiska-iz-egrn-na-zemlyu-i-dom-2/',
  'https://kadastrmap.info/kadastr/zaprosit-vypisku-iz-egrn-v-rosreestre/',
  'https://kadastrmap.info/kadastr/chto-delat-esli-rosreestr-ne-vydaet-vypiski-iz-egrn/',
  'https://kadastrmap.info/kadastr/reestr-sobstvennikov-mkd-dlya-provedeniya-sobraniya/',
  'https://kadastrmap.info/kadastr/kakoj-dokument-podtverzhdaet-pravo-sobstvennosti-na-kvartiru/',
  'https://kadastrmap.info/kadastr/plan-podklyucheniya-elektrichestva-k-domu-i-zemelnomu-uchastku/',
  'https://kadastrmap.info/kadastr/kak-polzovatsya-kadastrovoj-kartoj-rosreestra/',
  'https://kadastrmap.info/kadastr/chto-takoe-spravka-egrn-na-kvartiru-i-gde-ee-vzyat/',
  'https://kadastrmap.info/kadastr/gde-poluchit-situatsionnyj-plan/',
];

const USER_ID = 1;
console.log(`[batch-21] Starting: ${URLS.length} articles`);
const start = Date.now();
await runBatchRewrite(USER_ID, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-21] DONE in ${mins} min`);
