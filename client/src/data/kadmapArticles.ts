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
  // Средний приоритет
  {
    postId: 0,
    slug: 'snyat-obremenenie-posle-pogasheniya-ipoteki',
    title: 'Снять обременение после погашения ипотеки',
    priority: 'medium',
    reason: 'Ипотечный кластер — переход к заказу выписки',
  },
  {
    postId: 0,
    slug: 'proverit-kvartiru-na-dolgi-pered-pokupkoy',
    title: 'Проверить квартиру на долги перед покупкой',
    priority: 'medium',
    reason: 'Покупатели вторичного жилья',
  },
  {
    postId: 0,
    slug: 'kak-uznat-obremenenie-na-kvartiru',
    title: 'Как узнать обременение на квартиру',
    priority: 'medium',
    reason: 'Высокочастотный запрос',
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
    notes: 'Эталонная статья — все PageSpeed/SEO оптимизации применены',
  },
  5535: {
    status: 'done',
    wordsAfter: 2877,
    doneAt: '2026-03-25',
    notes: '17 H2, 10 FAQ, 9 тематических картинок, метадеск обновлён',
  },
};
