/**
 * Fetch titles for all IMPROVED articles from WP REST API,
 * convert to short Russian search queries, and copy to bot server.
 *
 * Run: npx tsx scripts/update-bot-queries.ts
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import * as wordpressDb from '../server/wordpress.db';

// All improved slugs (sync with score-articles.ts IMPROVED set)
const IMPROVED = new Set([
  // batch 1
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
  // batch 2
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
  // batch 3
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

// Fetch WP creds
const accounts = await wordpressDb.getUserWordpressAccounts(1);
const { siteUrl, username, appPassword } = accounts[0];
const auth = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');

// Fetch all published posts (paginated)
let page = 1;
const allPosts: { slug: string; title: string }[] = [];

while (true) {
  const resp = await fetch(
    `${siteUrl}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=slug,title&status=publish`,
    { headers: { Authorization: auth } }
  );
  if (!resp.ok) break;
  const posts = await resp.json() as any[];
  if (!posts.length) break;
  allPosts.push(...posts.map((p: any) => ({
    slug: p.slug,
    title: (p.title?.rendered ?? p.slug).replace(/<[^>]+>/g, '').trim(),
  })));
  page++;
}

console.log(`Fetched ${allPosts.length} published posts`);

// Filter to only IMPROVED slugs
const improvedPosts = allPosts.filter(p => IMPROVED.has(p.slug));
console.log(`Matched ${improvedPosts.length} improved articles`);

// Convert title to short Russian search query
function titleToQuery(title: string): string {
  let q = title
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    // Numeric HTML entities (e.g. &#8212; → —)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Strip parenthetical content (e.g. "(до 60 символов)")
  q = q.replace(/\s*\([^)]*\)/g, '').trim();

  // Cut at em-dash / colon / pipe / comma (title suffix usually explains, prefix is the query)
  const splitAt = q.search(/[:\u2014\u2013|,]/);
  if (splitAt > 10) q = q.slice(0, splitAt).trim();

  // Strip "до N симв" / "до 60" Yoast counter artifacts
  q = q.replace(/\s+до\s+\d+(\s+симв[а-я]*)?\s*$/i, '').trim();
  // Remove trailing punctuation
  q = q.replace(/[.,!?;()\[\]]+$/, '').trim();

  // Max 7 words
  const words = q.split(/\s+/);
  if (words.length > 7) q = words.slice(0, 7).join(' ');

  return q.toLowerCase().trim();
}

const queries = improvedPosts
  .map(p => titleToQuery(p.title))
  .filter(q => q.length > 3)
  .filter((q, i, arr) => arr.indexOf(q) === i)
  .sort();

console.log(`\nGenerated ${queries.length} unique queries:`);
queries.forEach((q, i) => console.log(`  ${String(i + 1).padStart(3)}. ${q}`));

// Write to temp file
const tmpFile = '/tmp/kadastrmap_queries.txt';
writeFileSync(tmpFile, queries.join('\n') + '\n', 'utf8');
console.log(`\nWritten ${queries.length} queries to ${tmpFile}`);

// SCP to bot server
const keyPath = `${process.env.HOME}/.ssh/id_ed25519`;
const botServer = '167.86.116.15';
const botPath = '/root/yandex_bot/outputs/queries/kadastrmap_queries.txt';

try {
  console.log(`Copying to ${botServer}:${botPath} ...`);
  execFileSync('scp', [
    '-i', keyPath!,
    '-o', 'StrictHostKeyChecking=no',
    tmpFile,
    `root@${botServer}:${botPath}`,
  ], { stdio: 'inherit' });
  console.log('Done! Bot queries updated.');
} catch (e: any) {
  console.error('SCP failed:', e.message);
  console.log(`\nManual copy:\n  scp ${tmpFile} root@${botServer}:${botPath}`);
  process.exit(1);
}
