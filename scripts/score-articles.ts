/**
 * Score all WP articles by commercial intent and output priority queue.
 * Run: npx tsx scripts/score-articles.ts
 *
 * Scoring:
 *   HIGH (3) — direct order intent: vypiskas, spravkas, zakazat, poluchit
 *   MED  (2) — problem-aware: obremenenie, arest, zalog, proverit
 *   LOW  (1) — informational cadastral content
 *   SKIP (0) — pure map browsing, free, DIY via gov portals
 */
import 'dotenv/config';
import * as wordpressDb from '../server/wordpress.db';
import * as wp from '../server/_core/wordpress';
import { getGoogleOpportunity, loadPositions } from './search-metrics';

// Already improved — exclude from queue
const IMPROVED = new Set([
  'kak-snyat-obremenenie-s-obekta-nedvizhimosti-poshagovaya-instruktsiya',
  'kadastrovaya-stoimost-nedvizhimosti-v-rosreestre-kak-uznat',
  'kak-snyat-obremenenie-s-ipotechnoj-kvartiry',
  'kak-proverit-sobstvennika-po-kadastrovomu-nomeru-onlajn',
  'karta-kadastrovoj-stoimosti-kak-uznat-tsenu-nedvizhimosti-onlajn',
  'kak-snyat-arest-s-kvartiry-chto-delat-sobstvenniku',
  'kak-snyat-obremenenie-posle-pogasheniya-ipoteki',
  'vypiska-iz-egrn-na-zemelnyj-uchastok',
  'kadastrovyj-plan-kvartiry-po-adresu',
  'vypiska-iz-egrn-bystro',
  'vypiska-iz-egrn-stoimost',
  'vypiska-iz-egrn-na-zemlyu',
  'vypiska-iz-egrn-na-nedvizhimost',
  'vypiska-iz-egrn-zakazat-onlajn',
  'vypiska-iz-egrn-na-kvartiru',
  'nalozhen-li-arest-na-kvartiru',
  'kvartira-pod-zalogom-spravka',
  'kak-proverit-ne-v-zaloge-li-kvartira',
  'kadastrovaya-publichnaya-karta-so-sputnika',
  'raspolozhenie-po-kadastrovomu-nomeru',
  'zakazat-kadastrovuyu-vypisku-onlajn-tsena-sposoby-polucheniya',
  'plan-pomeshheniya-i-kadastrovaya-vypiska-kak-oni-svyazany',
  'chto-ukazyvaetsya-v-vypiske-iz-egrn-na-kvartiru',
  'kak-zakazat-vypisku-egrn-v-elektronnom-vide-cherez-gosuslugi',
  'kadastrovaya-spravka-onlajn',
  'generalnyj-plan-zemelnogo-uchastka-chto-eto-i-gde-poluchit',
  'chto-nuzhno-znat-o-kadastrovyh-vypiskah',
  'chem-otlichaetsya-situatsionnyj-plan-ot-kadastrovogo-plana-uchastka',
  'situatsionnyj-plan-dlya-izhs-zachem-nuzhen-i-kak-zakazat-onlajn-bez-ocheredej',
  'situatsionnyj-plan-dlya-stroitelstva-doma-poryadok-i-dokumenty',
  'kak-uznat-svedeniya-po-kadastrovomu-nomeru-egrn-i-karta',
  'poluchit-vypisku-o-perehode-prav-na-nedvizhimost-onlajn-bystro-i-udobno',
  'kak-uznat-vladeltsa-kvartiry-po-adresu-zakonnye-sposoby-i-vypiska',
  'publichnaya-kadastrovaya-karta-moskvy',
  'publichnaya-kadastrovaya-karta-orlovskoj-oblasti',
  'publichnaya-kadastrovaya-karta-moskovskoj-oblasti',
  'publichnaya-kadastrovaya-karta-volgogradskaya-oblast',
  'publichnaya-kadastrovaya-karta-ulyanovskoj-oblasti',
  'publichnaya-kadastrovaya-karta-novosibirskoy-oblasti',
  'kadastr-simferopol',
  'zakazat-spravku-ob-obremenenii-nedvizhimosti-v-moskve-poshagovoe-rukovodstvo',
  'zakazat-spravku-ob-obremenenii-nedvizhimosti-v-moskve-p',
  // batch 2 (2026-03-29)
  'chto-nuzhno-chtoby-poluchit-vypisku-iz-egrn',
  'chto-pokazyvaet-vypiska-iz-egrn',
  'elektronnaya-vypiska-iz-egrn',
  'dlya-chego-nuzhna-vypiska-iz-egrn',
  'dlya-chego-nuzhna-vypiska-iz-egrn-na-zemelnyj-uchastok',
  'dlya-chego-nuzhna-vypiska-iz-egrn-ob-obekte-nedvizhimosti',
  'kadastrovaya-spravka',
  'kadastrovaya-spravka-iz-egrn',
  'kadastrovaya-vypiska',
  'kadastrovaya-vypiska-na-zemlyu',
  'kadastrovaya-vypiska-ob-obekte-nedvizhimosti',
  'kak-zakazat-kadastrovyj-pasport',
  'kak-zakazat-kadastrovyj-pasport-cherez-internet',
  'kak-zakazat-kadastrovuyu-spravku-o-kadastrovoj-stoimosti',
  'kadastrovyj-pasport-kvartiry-zakazat',
  'kadastrovyj-pasport-na-dom-zakazat',
  'gde-mozhno-zakazat-kadastrovyj-pasport',
  'gde-mozhno-zakazat-kadastrovyj-pasport-na-kvartiru',
  'gde-poluchit-vypisku-iz-egrn',
  'gde-poluchit-vypisku-iz-egrn-na-kvartiru',
  'gde-mozhno-poluchit-vypisku-iz-egrn',
  'gde-mozhno-poluchit-spravku-egrn',
  'arest-kvartiry-obremeneniem',
  'gde-proverit-kvartiru-na-obremenenie',
  'kak-bystro-snimaetsya-obremenenie',
  // batch 3 (2026-03-29)
  'chem-otlichaetsya-kadastrovyj-pasport-ot-tehnicheskogo',
  'chem-otlichaetsya-kadastrovyj-pasport-ot-vypiski',
  'dlya-chego-nuzhen-kadastrovyj-pasport',
  'dlya-chego-nuzhen-kadastrovyj-plan-territorii',
  'dlya-chego-nuzhna-vypiska-egrn',
  'eksplikatsiya-kvartiry-kak-zakazat-dokument-dlya-razlichnyh-zhiznennyh-situatsij',
  'gde-brat-kadastrovyj-pasport-na-kvartiru',
  'gde-delayut-kadastrovyj-pasport-na-kvartiru',
  'gde-mozhno-poluchit-kadastrovyj-pasport-na-kvartiru',
  'gde-najti-kadastrovyj-pasport-zemelnogo-uchastka',
  'gde-oformlyayut-kadastrovyj-pasport',
  'gde-poluchit-kadastrovyj-pasport-kvartiry',
  'gde-poluchit-kadastrovyj-pasport-na-dom',
  'gde-poluchit-kadastrovyj-pasport-na-kvartiru',
  'gde-poluchit-kadastrovyj-pasport-na-zemelnyj-uchastok',
  'gde-poluchit-kadastrovyj-pasport-na-zemlyu',
  'gde-poluchit-kadastrovyj-pasport-zemelnogo-uchastka',
  'gde-poluchit-kadastrovyj-plan',
  'gde-poluchit-kadastrovyj-plan-uchastka',
  'gde-poluchit-vypisku-iz-egrp',
  'gde-poluchit-vypisku-iz-egrp-na-kvartiru',
  'gde-vydayut-kadastrovyj-pasport-na-zemelnyj-uchastok',
  'gde-vzyat-kadastrovyj-pasport',
  'gde-vzyat-kadastrovyj-pasport-na-dom',
  'gde-vzyat-kadastrovyj-pasport-na-kvartiru',
  // batch 4 (2026-03-29)
  'gde-zakazat-kadastrovyj-pasport',
  'gde-zakazat-kadastrovyj-pasport-na-dom',
  'gde-zakazat-kadastrovyj-pasport-na-kvartiru',
  'gde-zakazat-kadastrovyj-pasport-na-zemelnyj-uchastok',
  'gde-zakazat-kadastrovuyu-vypisku',
  'gde-vzyat-kadastrovyj-pasport-zemelnogo-uchastka',
  'kadastrovyj-pasport',
  'kadastrovyj-pasport-kvartiry',
  'kadastrovyj-pasport-na-dom',
  'kadastrovyj-pasport-na-zemelnyj-uchastok',
  'kadastrovyj-pasport-na-zemlyu',
  'kadastrovyj-pasport-zemelnogo-uchastka',
  'kak-snyat-obremenenie-s-kvartiry',
  'obremenenie-na-kvartiru',
  'proverit-obremenenie-na-kvartiru',
  'arest-nedvizhimosti',
  'poluchit-vypisku-iz-egrn',
  'poluchit-vypisku-iz-egrn-onlajn',
  'poluchit-vypisku-egrn-bystro',
  'zakazat-vypisku-iz-egrn',
  'zakazat-vypisku-egrn-onlajn',
  'kadastrovaya-stoimost-kvartiry',
  'kadastrovaya-stoimost-zemelnogo-uchastka',
  'uznat-vladeltsa-kvartiry-po-kadastrovomu-nomeru',
  'spravka-ob-obremenenii-onlajn',
]);

type ScoreLabel = 'HIGH' | 'MED' | 'LOW' | 'SKIP';

export function scoreSlug(slug: string): [number, ScoreLabel] {
  const s = slug.toLowerCase();

  // SKIP — pure map browsing, free, DIY
  const skipPatterns = [
    'publichnaya-kadastrovaya-karta',
    'publichnoj-kadastrovoj-karte',
    'besplatno',
    'cherez-gosuslugi',
    'cherez-mfc',
    'chto-takoe',
    'istoriya',
  ];
  if (skipPatterns.some(p => s.includes(p))) return [0, 'SKIP'];

  // HIGH — direct order intent
  const highPatterns = [
    'zakazat', 'poluchit-vypisku', 'poluchit-spravku',
    'vypiska-iz-egrn', 'vypiska-egrn',
    'spravka-ob-obremenenii', 'spravka-o-zaloge',
    'proverit-sobstvennika', 'proverit-vladeltsa',
    'uznat-vladeltsa', 'uznat-sobstvennika',
    'kadastrovyj-pasport', 'kadastrovaya-spravka',
    'kadastrovyj-plan', 'kadastrovaya-vypiska',
    'stoimost-vypiski', 'tsena-vypiski', 'onlajn-vypiska',
  ];
  if (highPatterns.some(p => s.includes(p))) return [3, 'HIGH'];

  // MED — problem-aware
  const medPatterns = [
    'obremenenie', 'arest', 'zalog', 'ipoteka',
    'sobstvennik', 'vladel', 'proverit', 'uznat',
    'kadastrovyj-nomer', 'kadastrovaya-stoimost',
    'perehod-prav', 'kadastrovyj-uchet', 'registratsiya',
  ];
  if (medPatterns.some(p => s.includes(p))) return [2, 'MED'];

  return [1, 'LOW'];
}

// Fetch all published posts via WP REST API and score them
const accounts = await wordpressDb.getUserWordpressAccounts(1);
const { siteUrl, username, appPassword } = accounts[0];

let page = 1;
const allPosts: { id: number; slug: string; title: string }[] = [];

while (true) {
  const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
  const resp = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,slug,title&status=publish`,
    { headers: { Authorization: auth } }
  );
  if (!resp.ok) break;
  const posts = await resp.json() as any[];
  if (!posts.length) break;
  allPosts.push(...posts.map((p: any) => ({ id: p.id, slug: p.slug, title: p.title?.rendered || p.slug })));
  page++;
}

// Load positions for enhanced scoring
const posData = loadPositions();
console.log(`[search-metrics] Loaded positions from ${posData.updated}, ${posData.queries.length} queries`);
console.log(`  Google: top1=${posData.summary.top1} top5=${posData.summary.top5} top10=${posData.summary.top10}`);
console.log(`  Яндекс: все позиции null (не в ТОП-100 ни по одному запросу)`);
console.log(`  ИИ-упоминаний: 1 (КРИТИЧНО — нужны FAQ-схемы и answer-first структура)\n`);

const scored = allPosts
  .filter(p => !IMPROVED.has(p.slug))
  .map(p => {
    const [baseScore, label] = scoreSlug(p.slug);
    const gOpportunity = getGoogleOpportunity(p.slug);
    // Enhanced score: slug pattern × 10, plus search signal bonus
    const enhancedScore = baseScore * 10 + gOpportunity;
    return { ...p, score: enhancedScore, baseScore, label, gOpportunity };
  })
  .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

const counts = { HIGH: 0, MED: 0, LOW: 0, SKIP: 0 };
scored.forEach(p => counts[p.label]++);

console.log(`\n=== ОЧЕРЕДЬ (${scored.length} статей) ===`);
console.log(`HIGH=${counts.HIGH}  MED=${counts.MED}  LOW=${counts.LOW}  SKIP=${counts.SKIP}\n`);

let curLabel = '';
for (const p of scored) {
  if (p.label !== curLabel) {
    const names: Record<string, string> = {
      HIGH: '🔥 ВЫСОКИЙ', MED: '🟡 СРЕДНИЙ', LOW: '⬇️  НИЗКИЙ', SKIP: '⛔ ПРОПУСТИТЬ',
    };
    console.log(`\n--- ${names[p.label]} ---`);
    curLabel = p.label;
  }
  const gStr = p.gOpportunity > 0 ? `  gBonus=+${p.gOpportunity}` : '';
  console.log(`  score=${p.score}  id=${p.id}${gStr}  ${p.slug}`);
}
