export type ArticleStatus = 'todo' | 'in_progress' | 'done';

export interface PosSnapshot {
  date: string; // YYYY-MM-DD
  googlePos: number | null;
  yandexPos: number | null;
}

// ─── News ────────────────────────────────────────────────────────────────────
export interface KadmapNews {
  postId: number;
  slug: string;
  title: string;
  keyword?: string; // for SERP position check
  publishedAt: string; // YYYY-MM-DD
  images?: number;
}

export interface NewsProgress {
  googlePos?: number | null;
  yandexPos?: number | null;
  prevGooglePos?: number | null;
  prevYandexPos?: number | null;
  posCheckedAt?: string;
  posHistory?: PosSnapshot[];
  top3Google?: { pos: number; domain: string; title: string }[];
}

export const KADMAP_NEWS: KadmapNews[] = [
  {
    postId: 333241,
    slug: 'rosreestr-2026-proverka-obremenij-stala-obyazatelnoj-pri-ipotechnykh-sdelkakh',
    title: 'Росреестр 2026: проверка обременений стала обязательной при ипотечных сделках',
    keyword: 'росреестр 2026 проверка обременений',
    publishedAt: '2026-03-25',
    images: 5,
  },
];

export const NEWS_STORAGE_KEY = 'kadmap_news_progress';

export function loadNewsProgress(): Record<number, NewsProgress> {
  try {
    const raw = localStorage.getItem(NEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveNewsProgress(p: Record<number, NewsProgress>): void {
  localStorage.setItem(NEWS_STORAGE_KEY, JSON.stringify(p));
}

export interface KadmapArticle {
  postId: number;
  slug: string;
  title: string;
  keyword?: string; // main target keyword for SERP check
  priority: 'high' | 'medium' | 'low';
  wordsBefore?: number;
  seoScoreBefore?: number;
  wordstatW?: number; // Яндекс Wordstat базовая частотность (w)
  wordstatExact?: number; // Яндекс Wordstat точная частотность ([!w])
  reason: string; // why this article matters
  needsMap?: boolean; // whether wp outmap=1 should be set (map widget shown)
}

/** Auto-detect if an article should show the map widget (outmap=1 in WordPress) */
export function getMapFlag(slug: string): boolean {
  const mapSlugs = ['karta', 'raspolozhenie', 'plan', 'mezhevanie', 'sputnik', 'uchastok', 'kadastr-'];
  const noMapSlugs = ['obremenenie', 'arest', 'zalog', 'dolg', 'proverit', 'snyat', 'uznat'];
  const s = slug.toLowerCase();
  if (noMapSlugs.some(k => s.includes(k))) return false;
  if (mapSlugs.some(k => s.includes(k))) return true;
  return false;
}

export interface ArticleProgress {
  status: ArticleStatus;
  wordsAfter?: number;
  seoScoreAfter?: number;
  doneAt?: string; // ISO date
  notes?: string;
  googlePos?: number | null;
  yandexPos?: number | null;
  prevGooglePos?: number | null;
  prevYandexPos?: number | null;
  posCheckedAt?: string;
  posHistory?: PosSnapshot[];
  top3Google?: { pos: number; domain: string; title: string }[];
  top3Yandex?: { pos: number; domain: string; title: string }[];
}

// Sorted by conversion potential (buyer intent)
export const KADMAP_ARTICLES: KadmapArticle[] = [
  // ✅ ETALON
  {
    postId: 332861,
    slug: 'zakazat-spravku-ob-obremenenii-nedvizhimosti-v-moskve-poshagovoe-rukovodstvo',
    title: 'Заказать справку об обременении недвижимости в Москве — пошаговое руководство',
    priority: 'high',
    wordsBefore: 800,
    seoScoreBefore: 90,
    wordstatW: 0,
    wordstatExact: 0,
    reason: 'Эталонная статья — стандарт для всех остальных',
  },
  // ✅ DONE
  {
    postId: 5535,
    slug: 'kak-proverit-kvartiru-na-obremenenie-pri-pokupke',
    title: 'Как проверить квартиру на обременение при покупке',
    keyword: 'как проверить квартиру на обременение при покупке',
    priority: 'high',
    wordsBefore: 436,
    seoScoreBefore: 75,
    reason: 'Горячий buyer intent — человек готов купить документ',
  },
  {
    postId: 4299,
    slug: 'proverit-kvartiru-na-obremenenie-onlajn',
    title: 'Проверить квартиру на обременение онлайн',
    keyword: 'проверить квартиру на обременение онлайн',
    priority: 'high',
    wordstatW: 382,
    wordstatExact: 22,
    reason: 'Транзакционный запрос, высокий intent',
  },
  {
    postId: 4305,
    slug: 'kak-proverit-kvartiru-na-obremenenie',
    title: 'Как проверить квартиру на обременение',
    keyword: 'как проверить квартиру на обременение',
    priority: 'high',
    wordstatW: 960,
    wordstatExact: 84,
    reason: 'Основной информационный запрос кластера',
  },
  {
    postId: 5607,
    slug: 'proverit-kvartiru-arest-sudebnyh-pristavov',
    title: 'Проверить квартиру арест судебных приставов',
    keyword: 'проверить квартиру арест судебных приставов',
    priority: 'high',
    wordstatW: 65,
    wordstatExact: 0,
    reason: 'Buyer с острой проблемой — высокая конверсия',
  },
  {
    postId: 7129,
    slug: 'gde-proverit-kvartiru-na-obremenenie',
    title: 'Где проверить квартиру на обременение?',
    keyword: 'где проверить квартиру на обременение',
    priority: 'high',
    wordstatW: 29,
    wordstatExact: 0,
    reason: 'BOFU-запрос с явным intent купить',
  },
  // ✅ DONE — второй батч 2026-03-25
  {
    postId: 4302,
    slug: 'kak-uznat-est-li-obremenenie-na-kvartiru',
    title: 'Как узнать обременение на квартиру через интернет',
    keyword: 'как узнать обременение на квартиру',
    priority: 'high',
    wordstatW: 989,
    wordstatExact: 13,
    reason: 'Информационный + транзакционный интент',
  },
  {
    postId: 4308,
    slug: 'kak-uznat-nalozhen-li-arest-na-kvartiru',
    title: 'Как узнать наложен ли арест на квартиру?',
    keyword: 'как узнать наложен ли арест на квартиру',
    priority: 'high',
    wordstatW: 123,
    wordstatExact: 51,
    reason: 'Острая проблема — человек ищет выход',
  },
  {
    postId: 5522,
    slug: 'kak-uznat-kvartira-v-areste-ili-net',
    title: 'Как узнать квартира в аресте или нет',
    keyword: 'как узнать квартира в аресте или нет',
    priority: 'high',
    wordstatW: 108,
    wordstatExact: 33,
    reason: 'Бинарный вопрос с высоким intent',
  },
  {
    postId: 5558,
    slug: 'kak-uznat-kvartira-v-zaloge-ili-net',
    title: 'Как узнать квартира в залоге или нет',
    keyword: 'как узнать квартира в залоге или нет',
    priority: 'high',
    wordstatW: 177,
    wordstatExact: 48,
    reason: 'Залог/ипотека — горячий intent перед сделкой',
  },
  // ✅ DONE — кадастровая карта / расположение батч 2026-03-25
  {
    postId: 732,
    slug: 'raspolozhenie-po-kadastrovomu-nomeru',
    title: 'Расположение земельного участка по кадастровому номеру',
    keyword: 'расположение по кадастровому номеру',
    priority: 'high',
    wordsBefore: 200,
    seoScoreBefore: 55,
    wordstatW: 980,
    wordstatExact: 18,
    reason: 'G#3 — уже в топ-3, реврайт поднимет до #1',
    needsMap: true,
  },
  {
    postId: 1111,
    slug: 'kadastrovaya-publichnaya-karta-so-sputnika',
    title: 'Кадастровая публичная карта со спутника',
    keyword: 'кадастровая публичная карта со спутника',
    priority: 'high',
    wordsBefore: 1777,
    seoScoreBefore: 55,
    wordstatW: 290,
    wordstatExact: 0,
    reason: 'G#4 — реврайт до эталона переведёт в топ-1/2',
    needsMap: true,
  },
  {
    postId: 8751,
    slug: 'kadastrovyj-plan-kvartiry-po-adresu',
    title: 'Кадастровый план квартиры по адресу',
    keyword: 'кадастровый план квартиры по адресу',
    priority: 'high',
    wordsBefore: 2586,
    seoScoreBefore: 50,
    wordstatW: 0,
    wordstatExact: 0,
    reason: 'G#4 — низкий SEO score, нужен полный реврайт',
    needsMap: true,
  },
  // ── Снять обременение / арест ─────────────────────────────────────────────
  {
    postId: 331661,
    slug: 'kak-snyat-obremenenie-posle-pogasheniya-ipoteki',
    title: 'Как снять обременение после погашения ипотеки',
    keyword: 'как снять обременение после погашения ипотеки',
    priority: 'high',
    wordsBefore: 961,
    wordstatW: 1425,
    wordstatExact: 17,
    reason: 'Ипотечный кластер — переход к заказу выписки после снятия',
  },
  {
    postId: 333041,
    slug: 'kak-snyat-obremenenie-s-obekta-nedvizhimosti-poshagovaya-instruktsiya',
    title: 'Как снять обременение с объекта недвижимости — пошаговая инструкция',
    keyword: 'снять обременение с квартиры',
    priority: 'high',
    wordsBefore: 894,
    wordstatW: 7233,
    wordstatExact: 52,
    reason: 'Высокочастотный — люди ищут выход после ипотеки/залога',
  },
  {
    postId: 332987,
    slug: 'kak-snyat-obremenenie-s-ipotechnoj-kvartiry',
    title: 'Как снять обременение с ипотечной квартиры',
    keyword: 'как снять обременение с ипотечной квартиры',
    priority: 'high',
    wordsBefore: 336,
    wordstatW: 60,
    wordstatExact: 8,
    reason: 'Очень короткая статья (336 слов) — полный реврайт даст быстрый рост',
  },
  {
    postId: 332787,
    slug: 'kak-snyat-arest-s-kvartiry-chto-delat-sobstvenniku',
    title: 'Как снять арест с квартиры: что делать собственнику',
    keyword: 'как снять арест с квартиры',
    priority: 'high',
    wordsBefore: 733,
    wordstatW: 557,
    wordstatExact: 68,
    reason: 'Острая проблема — арест ФССП, смежный с обременением кластер',
  },
  // ── Собственник / владелец ────────────────────────────────────────────────
  {
    postId: 333052,
    slug: 'kak-uznat-vladeltsa-kvartiry-po-adresu-zakonnye-sposoby-i-vypiska',
    title: 'Как узнать владельца квартиры по адресу — законные способы и выписка',
    keyword: 'как узнать владельца квартиры по адресу',
    priority: 'high',
    wordsBefore: 721,
    wordstatExact: 193,
    reason: 'Высокий коммерческий интент — заказывают выписку ЕГРН',
  },
  {
    postId: 332955,
    slug: 'kak-proverit-sobstvennika-po-kadastrovomu-nomeru-onlajn',
    title: 'Как проверить собственника по кадастровому номеру онлайн',
    keyword: 'проверить собственника по кадастровому номеру',
    priority: 'medium',
    wordsBefore: 630,
    wordstatExact: 116,
    reason: 'Покупатели недвижимости — проверка перед сделкой',
  },
  // ── Кадастровая стоимость ─────────────────────────────────────────────────
  {
    postId: 333008,
    slug: 'kadastrovaya-stoimost-nedvizhimosti-v-rosreestre-kak-uznat',
    title: 'Кадастровая стоимость недвижимости в Росреестре — как узнать',
    keyword: 'кадастровая стоимость недвижимости по адресу',
    priority: 'high',
    wordsBefore: 636,
    wordstatExact: 22,
    reason: '~8000 запросов/мес — огромный трафиковый кластер',
  },
  {
    postId: 332921,
    slug: 'karta-kadastrovoj-stoimosti-kak-uznat-tsenu-nedvizhimosti-onlajn',
    title: 'Карта кадастровой стоимости — как узнать цену недвижимости онлайн',
    keyword: 'кадастровая стоимость по кадастровому номеру',
    priority: 'medium',
    wordsBefore: 537,
    wordstatW: 27269,
    wordstatExact: 582,
    reason: 'Карта + стоимость — синергия с кадастровым картой',
    needsMap: true,
  },
  // ── Выписка ЕГРН ─────────────────────────────────────────────────────────
  {
    postId: 332874,
    slug: 'zakazat-kadastrovuyu-vypisku-onlajn-tsena-sposoby-polucheniya',
    title: 'Заказать кадастровую выписку онлайн — цена, способы получения',
    keyword: 'заказать выписку из ЕГРН онлайн',
    priority: 'high',
    wordsBefore: 857,
    wordstatW: 0,
    wordstatExact: 0,
    reason: 'Транзакционный запрос — человек готов платить прямо сейчас',
  },
  {
    postId: 333098,
    slug: 'chto-nuzhno-znat-o-kadastrovyh-vypiskah',
    title: 'Кадастровые выписки ЕГРН: виды, сроки, форматы',
    keyword: 'кадастровая выписка ЕГРН что это',
    priority: 'medium',
    wordsBefore: 1213,
    wordstatW: 0,
    wordstatExact: 0,
    reason: 'Информационный хаб — охватывает весь ЕГРН кластер',
  },
  // ── Кадастровый номер ─────────────────────────────────────────────────────
  {
    postId: 333070,
    slug: 'kak-uznat-svedeniya-po-kadastrovomu-nomeru-egrn-i-karta',
    title: 'Как узнать сведения по кадастровому номеру — ЕГРН и карта',
    keyword: 'узнать сведения по кадастровому номеру',
    priority: 'medium',
    wordsBefore: 796,
    wordstatW: 139,
    wordstatExact: 9,
    reason: 'Объединяет карту и ЕГРН — широкий кластер',
  },
  // ── Долги (TODO — исправить postId) ───────────────────────────────────────
  {
    postId: 4312,
    slug: 'proverit-kvartiru-na-dolgi-pered-pokupkoy',
    title: 'Проверить квартиру на долги перед покупкой',
    priority: 'medium',
    reason: 'ID=4312 — attachment (изображение), не статья. Требует создания нового поста',
  },
  {
    postId: 5707,
    slug: 'vypiska-egrp-obremeneniem',
    title: 'Как узнать есть ли обременение на квартиру',
    keyword: 'выписка ЕГРН обременение',
    priority: 'medium',
    wordsBefore: 400,
    reason: 'Высокочастотный информационный запрос',
  },
];

export const STORAGE_KEY = 'kadmap_article_progress';

export function loadProgress(): Record<number, ArticleProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProgress(progress: Record<number, ArticleProgress>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

// Seed initial known statuses
// Positions snapshot 2026-03-25 (keys.so, Yandex):
// 17/25 запросов в топ-100, средняя позиция 28.7
// Лидеры: 8751/1111 (pos 4), 732 (pos 5), 5707 (pos 7), 332955/5607/333052 (pos 16-19)
// "—" = не в топ-100 (сайт не ранжируется по запросу)
const POS_SNAPSHOT_DATE = '2026-03-25';

export const INITIAL_PROGRESS: Record<number, ArticleProgress> = {
  332861: {
    status: 'done',
    wordsAfter: 3440,
    seoScoreAfter: 100,
    doneAt: '2026-03-01',
    notes: 'Эталонная статья — все PageSpeed/SEO оптимизации применены. Метадеск исправлен 2026-03-25 (убран хардкод цены)',
    yandexPos: null, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: null }],
  },
  5535: {
    status: 'done',
    wordsAfter: 2877,
    doneAt: '2026-03-25',
    notes: '17 H2, 10 FAQ, 9 тематических картинок, метадеск обновлён',
    yandexPos: 38, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 38 }],
  },
  4299: {
    status: 'done',
    wordsAfter: 3200,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, транзакционный интент. BLOCK_PRICE, [PRICE_3_DISC], отзывы',
    yandexPos: 24, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 24 }],
  },
  4305: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 3 H3, 11 FAQ, 9 картинок, how-to информационный интент. CTA=10 (доработано 2026-03-25)',
    yandexPos: 47, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 47 }],
  },
  5607: {
    status: 'done',
    wordsAfter: 3300,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, проблемный/срочный интент (арест ФССП). CTA=10 (доработано 2026-03-25)',
    yandexPos: 19, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 19 }],
  },
  7129: {
    status: 'done',
    wordsAfter: 3000,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, BOFU-сравнение сервисов. Таблица сравнения способов',
    yandexPos: 39, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 39 }],
  },
  4302: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, информационный+транзакционный интент. image016 из 2017/04/',
    yandexPos: 36, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 36 }],
  },
  4308: {
    status: 'done',
    wordsAfter: 3200,
    doneAt: '2026-03-25',
    notes: '15 H2, 3 H3, 10 FAQ, 9 картинок, острая проблема — арест на квартиру',
    yandexPos: 66, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 66 }],
  },
  5522: {
    status: 'done',
    wordsAfter: 3000,
    doneAt: '2026-03-25',
    notes: '15 H2, 10 FAQ, 9 картинок, бинарный вопрос. Таблица Арест vs Запрет',
    yandexPos: 22, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 22 }],
  },
  5558: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 10 FAQ, 9 картинок, залог/ипотека интент. Особенности по банкам (Сбер/ВТБ/Альфа)',
    yandexPos: 50, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 50 }],
  },
  331661: {
    status: 'done', wordsAfter: 2523, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2523 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: null, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: null }],
  },
  333041: {
    status: 'done', wordsAfter: 2336, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2336 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: null, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: null }],
  },
  332987: {
    status: 'done', wordsAfter: 2312, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2312 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: null, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: null }],
  },
  332787: {
    status: 'done', wordsAfter: 2622, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2622 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: null, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: null }],
  },
  333052: {
    status: 'done', wordsAfter: 2544, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2544 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: 19, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 19 }],
  },
  332955: {
    status: 'done', wordsAfter: 2256, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2256 слов, SEO 75/100, G#2. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: 16, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: 2, yandexPos: 16 }],
  },
  333008: {
    status: 'done', wordsAfter: 2105, doneAt: '2026-03-25',
    notes: 'Рерайт 2026-03-25: 2105 слов, SEO 75/100. Опубликовано + переобход Яндекс/Google/Bing',
    yandexPos: 37, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 37 }],
  },
  332921: { status: 'todo', notes: 'Карта кадастровой стоимости — 537 слов' },
  332874: { status: 'todo', notes: 'Заказать кадастровую выписку — 857 слов' },
  333098: { status: 'todo', notes: 'Кадастровые выписки ЕГРН — 1213 слов' },
  333070: { status: 'todo', notes: 'Сведения по кадастровому номеру — 796 слов' },
  4312: {
    status: 'todo',
    notes: 'ID=4312 — attachment (изображение), не статья. Требует создания нового поста с правильным postId',
  },
  5707: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 10 FAQ, 9 картинок, информационный запрос. 3 способа проверки. CTA=14, BLOCK_PRICE, отзывы',
    yandexPos: 7, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: null, yandexPos: 7 }],
  },
  732: {
    status: 'done',
    wordsAfter: 2450,
    doneAt: '2026-03-25',
    notes: '24 H2, 11 FAQ, 9 картинок, BLOCK_PRICE, CTA=9. Охранные зоны, межевание, реестровая ошибка, таблица способов. G#3 → цель #1',
    yandexPos: 5, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: 3, yandexPos: 5 }],
  },
  1111: {
    status: 'done',
    wordsAfter: 1800,
    doneAt: '2026-03-25',
    notes: '17 H2, 11 FAQ, 9 картинок, BLOCK_PRICE, CTA=9. Спутниковый режим, охранные зоны, сравнение с Google Maps, таблица. G#4 → цель #1/2',
    yandexPos: 4, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: 4, yandexPos: 4 }],
  },
  8751: {
    status: 'done',
    wordsAfter: 3500,
    doneAt: '2026-03-25',
    notes: '20 H2, 5 H3, 10 FAQ, 9 картинок, BLOCK_PRICE, CTA=9. Перепланировка, наследование, суд/раздел имущества. G#4 → цель #1/2',
    yandexPos: 4, posCheckedAt: POS_SNAPSHOT_DATE,
    posHistory: [{ date: POS_SNAPSHOT_DATE, googlePos: 4, yandexPos: 4 }],
  },
};
