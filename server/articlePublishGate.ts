export interface ArticlePublishGateOptions {
  targetWords: number;
  targetFaq: number;
  minH2?: number;
}

export interface ArticlePublishGateResult {
  pass: boolean;
  wordCount: number;
  faqCount: number;
  h2Count: number;
  hasTable: boolean;
  issues: string[];
}

export function getEnhancePassLimit(raw: string | undefined): number {
  const parsed = raw === undefined ? 4 : Number(raw);
  if (!Number.isFinite(parsed)) return 4;
  return Math.min(6, Math.max(1, Math.floor(parsed)));
}

function countWords(html: string): number {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.split(/\s+/).length : 0;
}

/**
 * Final safety gate before an article is sent to WordPress.
 * It checks only deterministic structural defects; SEO scoring remains a
 * separate, advisory concern. The function has no network or persistence side
 * effects and is therefore safe to use in both batch and manual flows.
 */
export function validateArticleForPublish(
  html: string,
  options: ArticlePublishGateOptions,
): ArticlePublishGateResult {
  const source = typeof html === 'string' ? html.trim() : '';
  const wordCount = countWords(source);
  const faqCount = (source.match(/<details\b[^>]*class=["'][^"']*\bfaq-item\b[^"']*["'][^>]*>/gi) || []).length;
  const h2Count = (source.match(/<h2\b/gi) || []).length;
  const hasTable = /<table\b/i.test(source);
  const issues: string[] = [];
  const minH2 = options.minH2 ?? 3;

  if (!source) issues.push('empty_content');
  if (/<(?:html|head|body)\b/i.test(source)) issues.push('document_wrapper_in_content');
  if (/\[object\s+Object\]|\bundefined\b|\bnull\b|lorem ipsum/i.test(source)) issues.push('placeholder_text');
  if (/```|(^|\n)\s{0,3}#{1,6}\s|\*\*[^*]+\*\*/.test(source)) issues.push('markdown_leak');
  if (wordCount < Math.max(1, options.targetWords)) issues.push(`word_count=${wordCount}/${options.targetWords}`);
  if (faqCount < Math.max(0, options.targetFaq)) issues.push(`faq_count=${faqCount}`);
  if (h2Count < minH2) issues.push(`h2_count=${h2Count}`);
  if (!hasTable) issues.push('missing_table');

  return { pass: issues.length === 0, wordCount, faqCount, h2Count, hasTable, issues };
}
