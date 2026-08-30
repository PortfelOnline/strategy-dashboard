import { describe, expect, it } from 'vitest';
import { readRetryQueue, reconcileRetryQueue } from './retryQueue';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('durable article retry queue', () => {
  it('removes successes and keeps failed URLs after reloading the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'article-retry-'));
    const file = path.join(dir, 'needs-improve.txt');
    fs.writeFileSync(file, [
      'https://100zem.ru/a/',
      'https://100zem.ru/b/',
    ].join('\n') + '\n');

    reconcileRetryQueue(file, [
      { url: 'https://100zem.ru/a/', ok: true },
      { url: 'https://100zem.ru/b/', ok: false },
      { url: 'https://100zem.ru/c/', ok: false },
    ]);

    expect(readRetryQueue(file)).toEqual([
      'https://100zem.ru/b/',
      'https://100zem.ru/c/',
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
