export type ArticleStatus = 'todo' | 'in_progress' | 'done';

export interface KadmapArticle {
  postId: number;
  slug: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  wordsBefore?: number;
  seoScoreBefore?: number;
  reason: string; // why this article matters
}

export interface ArticleProgress {
  status: ArticleStatus;
  wordsAfter?: number;
  seoScoreAfter?: number;
  doneAt?: string; // ISO date
  notes?: string;
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
    reason: 'Эталонная статья — стандарт для всех остальных',
  },
  // ✅ DONE
  {
    postId: 5535,
    slug: 'kak-proverit-kvartiru-na-obremenenie-pri-pokupke',
    title: 'Как проверить квартиру на обременение при покупке',
    priority: 'high',
    wordsBefore: 436,
    seoScoreBefore: 75,
    reason: 'Горячий buyer intent — человек готов купить документ',
  },
  // TODO — высокий приоритет
  {
    postId: 4299,
    slug: 'proverit-kvartiru-na-obremenenie-online',
    title: 'Проверить квартиру на обременение онлайн',
    priority: 'high',
    reason: 'Транзакционный запрос, высокий intent',
  },
  {
    postId: 4305,
    slug: 'kak-proverit-kvartiru-na-obremenenie',
    title: 'Как проверить квартиру на обременение',
    priority: 'high',
    reason: 'Основной информационный запрос кластера',
  },
  {
    postId: 5607,
    slug: 'proverit-kvartiru-arest-sudebnyh-pristavov',
    title: 'Проверить квартиру арест судебных приставов',
    priority: 'high',
    reason: 'Buyer с острой проблемой — высокая конверсия',
  },
  {
    postId: 7129,
    slug: 'gde-proverit-kvartiru-na-obremenenie',
    title: 'Где проверить квартиру на обременение?',
    priority: 'high',
    reason: 'BOFU-запрос с явным intent купить',
  },
  // ✅ DONE — второй батч 2026-03-25
  {
    postId: 4302,
    slug: 'kak-uznat-obremenenie-na-kvartiru',
    title: 'Как узнать обременение на квартиру через интернет',
    priority: 'high',
    reason: 'Информационный + транзакционный интент',
  },
  {
    postId: 4308,
    slug: 'kak-uznat-nalozhen-li-arest-na-kvartiru',
    title: 'Как узнать наложен ли арест на квартиру?',
    priority: 'high',
    reason: 'Острая проблема — человек ищет выход',
  },
  {
    postId: 5522,
    slug: 'kak-uznat-kvartira-v-areste-ili-net',
    title: 'Как узнать квартира в аресте или нет',
    priority: 'high',
    reason: 'Бинарный вопрос с высоким intent',
  },
  {
    postId: 5558,
    slug: 'kak-uznat-kvartira-v-zaloge-ili-net',
    title: 'Как узнать квартира в залоге или нет',
    priority: 'high',
    reason: 'Залог/ипотека — горячий intent перед сделкой',
  },
  // Средний приоритет — TODO
  {
    postId: 5464,
    slug: 'snyat-obremenenie-s-kvartiry-posle-pogasheniya-ipoteki',
    title: 'Снять обременение с квартиры после погашения ипотеки',
    priority: 'medium',
    reason: 'Ипотечный кластер — переход к заказу выписки',
  },
  {
    postId: 4312,
    slug: 'proverit-kvartiru-na-dolgi-pered-pokupkoy',
    title: 'Проверить квартиру на долги перед покупкой',
    priority: 'medium',
    reason: 'Покупатели вторичного жилья',
  },
  {
    postId: 5707,
    slug: 'kak-uznat-est-li-obremenenie-na-kvartiru',
    title: 'Как узнать есть ли обременение на квартиру',
    priority: 'medium',
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
export const INITIAL_PROGRESS: Record<number, ArticleProgress> = {
  332861: {
    status: 'done',
    wordsAfter: 3440,
    seoScoreAfter: 100,
    doneAt: '2026-03-01',
    notes: 'Эталонная статья — все PageSpeed/SEO оптимизации применены. Метадеск исправлен 2026-03-25 (убран хардкод цены)',
  },
  5535: {
    status: 'done',
    wordsAfter: 2877,
    doneAt: '2026-03-25',
    notes: '17 H2, 10 FAQ, 9 тематических картинок, метадеск обновлён',
  },
  4299: {
    status: 'done',
    wordsAfter: 3200,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, транзакционный интент. BLOCK_PRICE, [PRICE_3_DISC], отзывы',
  },
  4305: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 3 H3, 11 FAQ, 9 картинок, how-to информационный интент',
  },
  5607: {
    status: 'done',
    wordsAfter: 3300,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, проблемный/срочный интент (арест ФССП)',
  },
  7129: {
    status: 'done',
    wordsAfter: 3000,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, BOFU-сравнение сервисов. Таблица сравнения способов',
  },
  4302: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 11 FAQ, 9 картинок, информационный+транзакционный интент. image016 из 2017/04/',
  },
  4308: {
    status: 'done',
    wordsAfter: 3200,
    doneAt: '2026-03-25',
    notes: '15 H2, 3 H3, 10 FAQ, 9 картинок, острая проблема — арест на квартиру',
  },
  5522: {
    status: 'done',
    wordsAfter: 3000,
    doneAt: '2026-03-25',
    notes: '15 H2, 10 FAQ, 9 картинок, бинарный вопрос. Таблица Арест vs Запрет',
  },
  5558: {
    status: 'done',
    wordsAfter: 3100,
    doneAt: '2026-03-25',
    notes: '15 H2, 10 FAQ, 9 картинок, залог/ипотека интент. Особенности по банкам (Сбер/ВТБ/Альфа)',
  },
};
