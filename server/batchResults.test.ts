import { describe, expect, it } from 'vitest';
import { summarizeBatchOutcomes } from './batchResults';

describe('batch outcome accounting', () => {
  it('reconciles processed/failed and preserves the failed URL for retry', () => {
    const result = summarizeBatchOutcomes([
      { url: 'https://100zem.ru/a/', ok: true, kind: 'money' as const },
      { url: 'https://100zem.ru/b/', ok: false, kind: 'money' as const },
      { url: 'https://100zem.ru/c/', ok: true, kind: 'evergreen' as const },
    ]);

    expect(result).toEqual({
      attempted: 3,
      processed: 2,
      failed: 1,
      failedUrls: ['https://100zem.ru/b/'],
      money: 1,
      evergreen: 1,
    });
    expect(result.processed + result.failed).toBe(result.attempted);
  });
});
