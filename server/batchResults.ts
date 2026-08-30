export type BatchEntryKind = 'money' | 'evergreen' | 'improveExisting';

export interface BatchOutcome {
  url: string;
  ok: boolean;
  kind?: BatchEntryKind;
}

export interface BatchSummary {
  attempted: number;
  processed: number;
  failed: number;
  failedUrls: string[];
  money: number;
  evergreen: number;
}

/** Derive counters from individual outcomes so totals cannot drift apart. */
export function summarizeBatchOutcomes(outcomes: BatchOutcome[]): BatchSummary {
  return outcomes.reduce<BatchSummary>((summary, outcome) => {
    summary.attempted++;
    if (outcome.ok) summary.processed++;
    else {
      summary.failed++;
      summary.failedUrls.push(outcome.url);
    }
    if (outcome.ok && outcome.kind === 'money') summary.money++;
    if (outcome.ok && outcome.kind === 'evergreen') summary.evergreen++;
    return summary;
  }, { attempted: 0, processed: 0, failed: 0, failedUrls: [], money: 0, evergreen: 0 });
}
