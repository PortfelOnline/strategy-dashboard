/**
 * Post-generation quality fixers for kadastrmap articles.
 *
 * Pipeline LLM occasionally drops the FAQ block, generates fewer questions
 * than required, or produces under-target word count. Rather than retry the
 * whole expensive LLM call, these functions patch the HTML deterministically
 * before checkArticleQuality runs.
 */

const FAQ_BLOCK_REGEX = /<h2[^>]*>\s*(?:Часто задаваемые вопросы|FAQ)[^<]*<\/h2>([\s\S]*?)(?=<h2\b|<\/article>|<\/main>|$)/i;
const FAQ_ITEM_REGEX = /<details\b/gi;

/**
 * Generic FAQ template adapted to cadastre / real-estate articles.
 * Each entry produces a <details>/<summary>/<p> block matching the existing
 * `.faq-item` selector used by kadastrmap CSS and the FAQPage JSON-LD
 * generator that scans for `<h2>Часто задаваемые вопросы</h2>` siblings.
 *
 * Templates use {{keyword}} as a placeholder for the article's focus phrase.
 */
const GENERIC_FAQ_TEMPLATES: { q: string; a: string }[] = [
  {
    q: 'Что такое {{keyword}} и для чего он нужен?',
    a: '{{keyword}} — это официальная информация из Единого государственного реестра недвижимости (ЕГРН). Документ нужен для подтверждения сведений об объекте недвижимости: характеристик, прав, обременений, кадастровой стоимости. Используется при сделках купли-продажи, оформлении ипотеки, наследовании, разделе имущества, оспаривании кадастровой стоимости, а также для подачи в государственные органы и суды.',
  },
  {
    q: 'Сколько стоит заказать {{keyword}} онлайн?',
    a: 'Стоимость зависит от типа документа и срочности. Базовые справки по объекту недвижимости от 299–599 руб., расширенные выписки 1190 руб., кадастровые планы от 1190 руб. Точную цену можно увидеть в калькуляторе на странице <a href="/spravki/">/spravki/</a>. При заказе двух и более документов действует скидка. Электронная доставка на email включена в цену, дополнительная оплата не требуется.',
  },
  {
    q: 'Сколько по времени готовится {{keyword}}?',
    a: 'Срок готовности зависит от типа документа. Стандартные справки об объекте недвижимости приходят за 5 минут – 24 часа в электронном виде на email. Кадастровые планы и расширенные выписки готовятся 1–3 рабочих дня. Ситуационные планы с подписью кадастрового инженера — 1–3 рабочих дня. Сроки указаны на странице заказа <a href="/spravki/">/spravki/</a> для каждого документа отдельно.',
  },
  {
    q: 'Как заказать {{keyword}} через 100zem.ru?',
    a: 'Заказ оформляется на странице <a href="/spravki/">/spravki/</a> за несколько шагов: выберите нужный документ из списка, введите кадастровый номер или адрес объекта, укажите email и телефон для связи, оплатите онлайн картой или через СБП. После оплаты заявка автоматически уходит в обработку, готовый документ приходит на указанный email в формате PDF. Никаких походов в МФЦ или Росреестр не требуется.',
  },
  {
    q: 'Имеет ли {{keyword}} юридическую силу?',
    a: 'Электронные документы, которые мы предоставляем, носят справочный характер — это официально разрешено пунктом 27 статьи 62 ФЗ № 218 от 13.07.2015 «О государственной регистрации недвижимости». Для предоставления в большинство государственных и коммерческих организаций, банков (для ипотеки), при подготовке к сделке, для информационных целей такая форма подходит. Если требуется именно выписка с электронно-цифровой подписью Росреестра — заказывайте её напрямую на сайте rosreestr.gov.ru.',
  },
  {
    q: 'Какие данные нужны для заказа {{keyword}}?',
    a: 'Для оформления заявки достаточно знать кадастровый номер объекта недвижимости или его точный адрес. Кадастровый номер можно посмотреть в правоустанавливающих документах (свидетельство о собственности, выписка ЕГРН) или на публичной кадастровой карте. Если кадастровый номер неизвестен — введите адрес: система автоматически найдёт объект в базе. Также понадобится email для получения готового документа и телефон для связи в случае уточнений.',
  },
  {
    q: 'Можно ли использовать {{keyword}} для ипотеки или сделки?',
    a: 'Для предварительной проверки объекта перед сделкой или ипотекой — да, документ подходит. Банк или покупатель смогут увидеть площадь, владельца, обременения (залог, арест, ипотека), кадастровую стоимость. Для финальной регистрации сделки в Росреестре потребуется выписка с ЭЦП — её заказывают непосредственно в Росреестре или через нотариуса. Наш документ удобен на этапе проверки и предварительных переговоров.',
  },
  {
    q: 'Что делать, если объект не найден в базе?',
    a: 'Если по введённому кадастровому номеру или адресу объект не находится — это означает, что в ЕГРН по нему отсутствуют актуальные сведения. Причины: объект не поставлен на кадастровый учёт, неверно введён номер или адрес, объект снят с учёта. Проверьте правильность ввода кадастрового номера (формат XX:XX:XXXXXXX:XX). Если данные верны — обратитесь в Росреестр через МФЦ для постановки объекта на учёт или уточнения статуса.',
  },
  {
    q: 'Какие сведения об объекте я получу?',
    a: 'Документ содержит: кадастровый номер, адрес, площадь, назначение и категорию объекта, кадастровую стоимость на текущую дату, сведения о владельце (ФИО или наименование организации), наличие обременений (ипотека, арест, аренда), даты регистрации и изменений прав. Информация выгружается из ЕГРН и актуальна на момент формирования документа. Срок действия сведений — до 30 дней с даты выдачи (для большинства практических целей).',
  },
  {
    q: 'Как оплатить заказ {{keyword}}?',
    a: 'Оплата производится онлайн в момент оформления заявки на странице <a href="/spravki/">/spravki/</a>. Доступные способы: банковская карта (Visa, Mastercard, МИР), СБП (Система быстрых платежей) по QR-коду, MirPay, Halva, оплата через Сбербанк Онлайн. Безопасность платежей обеспечивается платёжным шлюзом, реквизиты карты не сохраняются на сайте. После успешной оплаты автоматически придёт чек на email и заявка уйдёт в работу.',
  },
];

function buildFaqHtml(keyword: string, neededCount: number, existingCount: number): string {
  const out: string[] = [];
  const toAdd = Math.min(neededCount, GENERIC_FAQ_TEMPLATES.length);
  for (let i = 0; i < toAdd; i++) {
    const tpl = GENERIC_FAQ_TEMPLATES[i];
    const q = tpl.q.replace(/\{\{keyword\}\}/g, keyword);
    const a = tpl.a.replace(/\{\{keyword\}\}/g, keyword);
    const open = i === 0 && existingCount === 0 ? ' open' : '';
    out.push(
      `<details class="faq-item"${open}><summary>${q}</summary><p>${a}</p></details>`,
    );
  }
  return out.join('\n');
}

/**
 * Ensure the article contains at least `targetFaq` FAQ items. If fewer
 * `<details>` blocks are found, append generic templates to the existing
 * FAQ section or create a new one before the closing CTA.
 *
 * Idempotent: if FAQ count already meets target, returns html unchanged.
 */
export function ensureMinFaq(html: string, keyword: string, targetFaq: number = 10): string {
  const existingFaqs = (html.match(FAQ_ITEM_REGEX) || []).length;
  if (existingFaqs >= targetFaq) return html;
  const missing = targetFaq - existingFaqs;

  const faqHtml = buildFaqHtml(keyword, missing, existingFaqs);
  if (!faqHtml) return html;

  const blockMatch = html.match(FAQ_BLOCK_REGEX);
  if (blockMatch) {
    // FAQ section exists — append generated items at its end
    const blockStart = blockMatch.index ?? 0;
    const blockBody = blockMatch[1];
    const newBody = `${blockBody}\n${faqHtml}\n`;
    return (
      html.slice(0, blockStart + blockMatch[0].length - blockBody.length) +
      newBody +
      html.slice(blockStart + blockMatch[0].length)
    );
  }

  // FAQ section is absent — create one. Inject before <h2>Вывод</h2> if found,
  // otherwise before end of content.
  const wrap = `\n<h2>Часто задаваемые вопросы</h2>\n${faqHtml}\n`;
  const concludingH2 = /<h2[^>]*>\s*(?:Вывод|Заключение)[^<]*<\/h2>/i;
  if (concludingH2.test(html)) {
    return html.replace(concludingH2, (m) => `${wrap}${m}`);
  }
  return html + wrap;
}

/**
 * Heuristic word-count for HTML (strip tags, count whitespace-delimited tokens).
 * Mirrors articles.ts:countWords so callers can decide whether to invoke a
 * fixer without exporting from the main router.
 */
export function htmlWordCount(html: string): number {
  return (html.replace(/<[^>]+>/g, ' ').match(/\S+/g) || []).length;
}
