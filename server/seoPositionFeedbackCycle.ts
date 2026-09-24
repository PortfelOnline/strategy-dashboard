import type { SeoPositionFeedbackRepository } from "./seoPositionFeedback.db";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PublishCycleResult {
  cycleId: number;
  url: string;
  published: boolean;
  beforeContentHash: string | null;
  afterContentHash: string | null;
}

/**
 * A failed or incomplete WordPress publish remains queued. This is deliberately
 * separate from selection so a failure can never start a measurement cooldown.
 */
export async function applyPublishResults(
  repository: SeoPositionFeedbackRepository,
  results: PublishCycleResult[],
  now = new Date(),
): Promise<void> {
  await Promise.all(results.filter((result) => result.published).map((result) =>
    repository.updateCycle(result.cycleId, {
      status: "published",
      beforeContentHash: result.beforeContentHash,
      afterContentHash: result.afterContentHash,
      publishedAt: now,
      nextMeasurementAt: new Date(now.getTime() + 21 * DAY_MS),
      cooldownUntil: new Date(now.getTime() + 30 * DAY_MS),
    }),
  ));
}
