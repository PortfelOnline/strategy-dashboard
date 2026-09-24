/**
 * Обещания адреса страницы.
 *
 * Ключ для статьи берётся из заголовка, а уточнение нередко живёт только в
 * адресе: `/kadastr/kak-poluchit-kadastrovyj-pasport-na-garazh-v-gsk/` при
 * заголовке «Как получить кадастровый паспорт на гараж». Генератор такого
 * уточнения не видел — и выпускал статью, в которой слова «ГСК» не было ни
 * разу (найдено 31.07.2026 при разборе дублей). Адрес обещал одно, текст
 * давал другое: пользователь уходит, страница не ранжируется по своему же
 * уточнению.
 *
 * Здесь мы вытаскиваем из адреса слова, которых нет в заголовке, и проверяем,
 * раскрыты ли они в тексте. Сравнение идёт в транслите — адрес латиницей, а
 * текст кириллицей, поэтому кириллицу приводим к той же схеме, что WordPress
 * использует для слагов.
 */

/** Схема транслитерации WordPress для русских слагов. */
const RU_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Служебные слова слага — они ничего не обещают. */
const STOP_WORDS = new Set([
  'kak', 'chto', 'gde', 'kogda', 'pochemu', 'skolko', 'kakie', 'kakoj',
  'na', 'v', 'vo', 'po', 'pri', 'dlya', 'iz', 'ot', 'do', 'za', 'k', 's', 'so',
  'o', 'ob', 'i', 'ili', 'a', 'no', 'ne', 'li', 'eto', 'takoe', 'svoj', 'ego',
  'onlajn', 'onlain', 'sajt', 'sajte', 'stranitsa',
]);

/** Приводит кириллицу к слаг-транслиту; латиница и цифры остаются как есть. */
export function translitToSlug(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map(ch => (ch in RU_TO_LAT ? RU_TO_LAT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Грубая основа слова: падежные окончания в транслите отличаются в хвосте. */
function stem(word: string): string {
  return word.length > 6 ? word.slice(0, 6) : word;
}

function words(text: string): string[] {
  return translitToSlug(text).split(' ').filter(Boolean);
}

/**
 * Слова адреса, которых нет в заголовке, — это и есть обещания страницы.
 * Год и прочие числа отбрасываем: они уточняют не тему, а свежесть.
 */
export function extractSlugPromises(url: string, title: string): string[] {
  let slug = '';
  try {
    slug = new URL(url).pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  } catch {
    slug = url.replace(/\/+$/, '').split('/').pop() ?? '';
  }
  // хвост -2 / -3 — метка дубля, а не смысл
  slug = slug.replace(/-\d+$/, '');

  const titleStems = new Set(words(title).map(stem));
  const seen = new Set<string>();
  const promises: string[] = [];

  for (const word of slug.split('-').filter(Boolean)) {
    if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    const s = stem(word);
    if (titleStems.has(s) || seen.has(s)) continue;
    seen.add(s);
    promises.push(word);
  }
  return promises;
}

/** Сколько раз обещание реально встречается в тексте статьи. */
export function countPromiseMentions(html: string, promise: string): number {
  const haystack = ` ${translitToSlug(html.replace(/<[^>]+>/g, ' '))} `;
  const needle = stem(promise);
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    // считаем только начало слова, иначе «gsk» ловится внутри чужих слов
    if (haystack[at - 1] === ' ') count++;
    from = at + needle.length;
  }
  return count;
}

/**
 * Обещания, которые текст не отрабатывает. Одного упоминания мало: уточнение
 * из адреса должно быть раскрыто, а не помянуто вскользь.
 */
export function findUncoveredPromises(
  html: string,
  promises: string[],
  minMentions = 2,
): string[] {
  return promises.filter(p => countPromiseMentions(html, p) < minMentions);
}

/** Блок для промпта: чего именно ждёт от статьи её собственный адрес. */
export function buildSlugPromiseBlock(url: string, promises: string[]): string {
  if (promises.length === 0) return '';
  return `
🔗 АДРЕС СТРАНИЦЫ ОБЕЩАЕТ БОЛЬШЕ, ЧЕМ ЗАГОЛОВОК
Адрес: ${url}
Уточнения из адреса, которых нет в заголовке: ${promises.join(', ')}
Это транслит — расшифруй сам (например «gsk» = ГСК, гаражно-строительный кооператив; «gosuslugi» = портал Госуслуг; «novostrojke» = новостройка).
ОБЯЗАТЕЛЬНО: под каждое уточнение — отдельный H2-раздел (250+ слов) и упоминания по тексту. Пользователь пришёл именно за этим уточнением; статья «вообще про тему» его не удержит.
`;
}
