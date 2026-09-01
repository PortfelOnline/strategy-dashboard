import { describe, expect, it } from 'vitest';
import { buildSeoBrief, formatSeoBrief } from './seoBrief';

describe('seo brief', () => {
  it('derives intent and stable terms from top results', () => {
    const brief = buildSeoBrief('как заказать выписку', [
      { position: 1, title: 'Как заказать выписку?', url: 'https://example.ru/a', domain: 'example.ru', snippet: 'Выписка ЕГРН онлайн быстро' },
      { position: 2, title: 'Выписка ЕГРН онлайн', url: 'https://example.ru/b', domain: 'example.ru', snippet: 'Как заказать выписку ЕГРН онлайн' },
    ]);
    expect(brief.intent).toBe('how-to');
    expect(brief.lsi).toContain('выписка');
    expect(formatSeoBrief(brief)).toContain('не добавляй объём');
  });
});

