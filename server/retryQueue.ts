import fs from 'node:fs';
import path from 'node:path';
import type { BatchOutcome } from './batchResults';

export function readRetryQueue(filePath: string): string[] {
  try {
    return Array.from(new Set(
      fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')),
    ));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** Atomically reconcile a URL queue after each batch (successes out, failures back in). */
export function reconcileRetryQueue(filePath: string, outcomes: BatchOutcome[]): void {
  const successes = new Set(outcomes.filter(item => item.ok).map(item => item.url));
  const failures = outcomes.filter(item => !item.ok).map(item => item.url);
  const next = readRetryQueue(filePath).filter(url => !successes.has(url));
  for (const url of failures) {
    if (!next.includes(url)) next.push(url);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, next.length ? `${next.join('\n')}\n` : '', { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}
