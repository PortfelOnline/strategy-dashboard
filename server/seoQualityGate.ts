/**
 * Deterministic pre-publication checks for AI articles.
 *
 * The structural QA in articles.ts cannot detect a plausible-looking FAQ
 * that is unrelated to the article or contains invented service promises.
 * This module deliberately stays heuristic and explainable: it never rewrites
 * content, it only returns issues so the caller can keep the article in draft.
 */

export type SeoGateSeverity = 'block' | 'warn';

export interface SeoGateIssue {
  code: string;
  severity: SeoGateSeverity;
  message: string;
}

export interface SeoGateReport {
  ok: boolean;
  issues: SeoGateIssue[];
  faqCount: number;
}

const STOP_WORDS = new Set([
  'это', 'как', 'что', 'для', 'при', 'или', 'из', 'по', 'на', 'в', 'с', 'к',
  'об', 'от', 'до', 'не', 'и', 'а', 'но', 'также', 'можно', 'нужно', 'если',
  'когда', 'где', 'который', 'которая', 'которые', 'через', 'после', 'его',
  'ее', 'их', 'за', 'без', 'ли', 'либо',
]);

const DOMAIN_TERMS = new Set([
  'кадастр', 'кадастровый', 'недвижимость', 'объект', 'участок', 'дом',
  'квартира', 'егрн', 'выписка', 'право', 'обременение', 'стоимость',
  'адрес', 'регистрация', 'межевание', 'документ', 'росреестр', 'сделка',
]);

function tokens(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase('ru-RU').match(/[а-яёa-z0-9]{3,}/g) || [])
      .filter((token) => !STOP_WORDS.has(token)),
  );
}

function textOnly(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTopicEvidence(question: string, answer: string, topic: Set<string>): boolean {
  const qa = tokens(`${question} ${answer}`);
  if ([...topic].some((token) => qa.has(token))) return true;
  // Short branded/legal queries (e.g. «ФГУ ЗКП») often have no common
  // inflected form in the answer; two domain terms are a safe fallback.
  const domainHits = [...qa].filter((token) => DOMAIN_TERMS.has(token)).length;
  return domainHits >= 2;
}

/**
 * Check an article before it is sent to WordPress. The block list targets
 * known hallucination templates previously required by the old prompts.
 */
export function validateSeoArticle(
  html: string,
  keyword: string,
  title = '',
  minFaq = 0,
): SeoGateReport {
  const issues: SeoGateIssue[] = [];
  const plain = textOnly(html);
  const topic = tokens(`${keyword} ${title}`);

  if (!plain || plain.length < 300) {
    issues.push({ code: 'thin_content', severity: 'block', message: 'текст статьи короче 300 символов' });
  }
  if (/\[(?:реальный|вступление|подробн|краткое пояснение)[^\]]*\]/i.test(html)) {
    issues.push({ code: 'placeholder_content', severity: 'block', message: 'обнаружен незаполненный шаблонный маркер' });
  }

  const faqItems = [...html.matchAll(/<details\b[^>]*class=["'][^"']*faq-item[^"']*["'][^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/details>/gi)]
    .map((match) => ({ question: textOnly(match[1]), answer: textOnly(match[2]) }));

  if (minFaq > 0 && faqItems.length < minFaq) {
    issues.push({ code: 'faq_count', severity: 'warn', message: `FAQ: ${faqItems.length}/${minFaq}` });
  }

  faqItems.forEach((item, index) => {
    if (item.question.length < 12 || item.answer.length < 40) {
      issues.push({ code: 'faq_thin', severity: 'block', message: `FAQ #${index + 1}: слишком короткий вопрос или ответ` });
    } else if (!hasTopicEvidence(item.question, item.answer, topic)) {
      issues.push({ code: 'faq_irrelevant', severity: 'block', message: `FAQ #${index + 1}: вопрос/ответ не связан с темой «${keyword}»` });
    }
  });

  const unsupportedPromise = /гарантируем\s+возврат|срочн(?:ый|ого)\s+отч[её]т\s+в\s+(?:тво[её]м|вашем)\s+смартфон|отзывы\s+клиентов|действует\s+скидк|mirpay|halva|visa\s*,?\s*mastercard|срок\s+действия\s+сведений\s*[—-]?\s*до\s*30\s*дн/i;
  if (unsupportedPromise.test(plain)) {
    issues.push({
      code: 'unsupported_service_claim',
      severity: 'block',
      message: 'обнаружено неподтверждённое обещание сервиса/отзыв/платёжный факт',
    });
  }

  const blocking = issues.some((issue) => issue.severity === 'block');
  return { ok: !blocking, issues, faqCount: faqItems.length };
}
