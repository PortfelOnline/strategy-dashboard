/**
 * Batch-23: 40 thin general articles (100-220 words, 0 FAQ)
 * Высокий SEO-потенциал, общие темы (не региональные)
 * Usage: npx tsx scripts/batch-rewrite-23.ts
 */
import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const BASE = 'https://kadastrmap.info/kadastr/';
const SLUGS = [
  // Кадастровая стоимость — популярные запросы
  'kadastrovaya-stoimost-nedvizhimogo-imushhestva',
  'kak-uznat-kadastrovuyu-stoimost-obekta',
  'ustanovlenie-kadastrovoj-stoimosti',
  'kak-uznat-stoimost-uchastka-po-kadastru',
  'kadastrovaya-stoimost-obekta',
  'kadastrovaya-stoimost-i-rynochnaya-stoimost',
  'kadastrovaya-stoimost-nalogovaya-baza',
  'nalog-na-kadastrovuyu-stoimost-nedvizhimosti',

  // Кадастровый учёт
  'kadastrovyj-uchet-nedvizhimogo-imushhestva',
  'kadastrovyj-uchet-obektov-kapitalnogo-stroitelstva',
  'kadastrovyj-uchet-onlajn',
  'kadastrovaya-registratsiya-ili-uchyot-nedvizhimosti',
  'chto-takoe-kadastrovyj-uchyot-zemelnyh-uchastkov',
  'postavit-na-kadastrovyj-uchet',

  // Кадастровый паспорт
  'chto-takoe-kadastrovyj-pasport-na-zemelnyj-uchastok',
  'dokumenty-dlya-kadastrovogo-pasporta-na-nedvizhimost',
  'forma-kadastrovogo-pasporta',
  'chto-neobhodimo-dlya-kadastrovogo-pasporta-na-kvartiru',

  // Кадастровая выписка / номер
  'forma-kadastrovoj-vypiski-zemelnogo-uchastka',
  'kak-poluchit-kadastrovyj-nomer-zemelnogo-uchastka',
  'kadastrovyj-nomer-nedvizhimosti',
  'vozmozhnost-polucheniya-svedenij-iz-kadastra-nedvizhimosti',

  // Кадастровые границы / межевание
  'kadastrovoe-mezhevanie',
  'kadastrovye-granicy',
  'kadastrovye-zemelnye-uchastki',
  'kadastrovoe-raspolozhenie-uchastkov',

  // Каданастровые карты (общие)
  'kadastr-nedvizhimosti-onlajn',
  'kadastr-nedvizhimosti',
  'gosudarstvennyj-kadastr',
  'elektronnyj-kadastr',
  'kadastr-nedvizhimosti-moskvy',

  // Прочие важные темы
  'kadastrovoe-naznachenie-zemel',
  'chto-takoe-kadastrovoe-delo',
  'kakoj-organ-osushhestvlyaet-ispravlenie-kadastrovoj-oshibki',
  'kadastrovoe-mezhevanie',
  'kadastrovaya-registratsiya-ili-uchyot-nedvizhimosti',
  'chto-takoe-kadastrovoe-sro',
  'kadastrovyj-poisk',
  'publichka-kadastrovaya-karta',
  'karty-zemelnogo-kadastra',
];

const URLS = [...new Set(SLUGS)].map(s => `${BASE}${s}/`);
console.log(`Batch-23: ${URLS.length} URLs`);

const start = Date.now();
await runBatchRewrite(1, URLS);
const mins = ((Date.now() - start) / 60000).toFixed(1);
console.log(`[batch-23] DONE in ${mins} min`);
