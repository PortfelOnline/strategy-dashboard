const EMOJI_RE = /\p{Extended_Pictographic}/u;

const CONTEXT_EMOJIS: Array<[RegExp, string]> = [
  [/провер|осмотр|риск|ошибк|нельзя|вниман/i, '🔍'],
  [/документ|справк|выписк|паспорт|договор/i, '📄'],
  [/стоим|цен|оплат|рубл/i, '💰'],
  [/срок|дн|час|когда|период/i, '⏱️'],
  [/закон|прав|регистрац|росреестр/i, '⚖️'],
  [/шаг|порядок|сначала|затем|инструкц/i, '📌'],
  [/преимущ|польз|удоб|совет|рекоменд/i, '💡'],
];

function emojiForText(text: string, fallbackIndex: number): string {
  for (const [pattern, emoji] of CONTEXT_EMOJIS) {
    if (pattern.test(text)) return emoji;
  }
  return ['📌', '✅', '💡'][fallbackIndex % 3];
}

/**
 * Add one contextual marker to long prose paragraphs that lack any emoji.
 * Service metadata and FAQ answers are intentionally excluded: they must stay
 * compact and machine-readable. The operation is deterministic and idempotent.
 */
export function ensureParagraphEmojis(html: string, maxInjections = 24): string {
  let injected = 0;
  let fallbackIndex = 0;

  return html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs: string, inner: string, offset: number, source: string) => {
    if (injected >= maxInjections) return full;
    if (/\b(?:article-meta|article-editorial|seo-|schema|no-emoji)\b/i.test(attrs)) return full;

    const before = source.slice(0, offset);
    const openDetails = (before.match(/<details\b/gi) || []).length;
    const closedDetails = (before.match(/<\/details\s*>/gi) || []).length;
    if (openDetails > closedDetails) return full;

    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 180 || EMOJI_RE.test(text)) return full;

    const emoji = emojiForText(text, fallbackIndex++);
    injected++;
    return `<p${attrs}>${emoji} ${inner}</p>`;
  });
}
