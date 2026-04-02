import 'dotenv/config';
import axios from 'axios';
import https from 'https';

const BASE = 'https://kadastrmap.info/wp-json/wp/v2/posts';
const AUTH = 'Basic ' + Buffer.from('grudeves_vf97s8yc:uX$8LCdpGKH9Rcd').toString('base64');
const agent = new https.Agent({ rejectUnauthorized: false });

const SLUGS = [
  // Обременение/залог/арест
  'proverit-kvartiru-na-obremenenie-onlajn',
  'kak-proverit-kvartiru-na-obremenenie',
  'kak-uznat-obremenenie-na-kvartiru',
  'obremenenie-kvartiry',
  'arest-kvartiry-obremeneniem',
  'kak-uznat-kvartira-v-zaloge-ili-net',
  'kak-proverit-ne-v-zaloge-li-kvartira',
  'kak-uznat-nalozheno-li-obremenenie-na-kvartiru',
  'kak-uznat-nalozhen-li-arest-na-kvartiru',
  'snyat-obremenenie-s-kvartiry',
  'kak-snyat-obremenenie-s-kvartiry',
  // Собственник
  'kak-uznat-sobstvennika-kvartiry-po-adresu',
  'kak-uznat-sobstvennika-kvartiry-po-kadastrovomu-nomeru',
  'kak-proverit-sobstvennika-kvartiry',
  'kak-uznat-sobstvennika-nedvizhimosti-po-adresu',
  'kak-uznat-sobstvennika-uchastka',
  // Кадастровый паспорт
  'kadastrovyj-pasport-na-kvartiru',
  'kadastrovyj-pasport-kvartiry',
  // Расположение/план
  'raspolozhenie-po-kadastrovomu-nomeru',
  'kadastrovyj-plan-kvartiry',
  'kadastrovyj-plan-kvartiry-po-adresu',
  // Кадастровая стоимость
  'kadastrovaya-stoimost-nedvizhimosti-po-adresu',
  'kadastrovaya-stoimost-po-kadastrovomu-nomeru',
];

for (const slug of SLUGS) {
  const res = await axios.get(BASE, {
    params: { slug, _fields: 'id,link,slug,date_modified' },
    headers: { Authorization: AUTH },
    httpsAgent: agent,
  });
  const posts = res.data as any[];
  if (posts[0]) {
    console.log(posts[0].link);
  }
}
process.exit(0);
