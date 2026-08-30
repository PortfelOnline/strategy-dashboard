import { describe, expect, it } from 'vitest';
import { ensureParagraphEmojis } from './contentQuality';

describe('content paragraph emoji quality gate', () => {
  it('adds a contextual emoji to a long ordinary paragraph', () => {
    const paragraph = '<p>Проверьте документы продавца и сведения об объекте перед подписанием договора. '.repeat(8) + '</p>';
    const result = ensureParagraphEmojis(paragraph);
    expect(result).toMatch(/<p>🔍 /);
  });

  it('does not modify short, already decorated, or FAQ paragraphs', () => {
    const html = [
      '<p>Короткий текст.</p>',
      '<p>✅ Уже отмечено. ' + 'Подробное содержание. '.repeat(30) + '</p>',
      '<details class="faq-item"><summary>Вопрос</summary><p>' + 'Ответ. '.repeat(50) + '</p></details>',
    ].join('');
    expect(ensureParagraphEmojis(html)).toBe(html);
  });
});
