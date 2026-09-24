import type { SeoCycleStatus } from "./seoPositionFeedback.db";

export interface SeoOutcomeMetrics {
  impressions: number;
  clicks: number;
  position: number | null;
}

export interface SeoOutcome {
  status: Extract<SeoCycleStatus, "won" | "lost" | "inconclusive">;
  reason: string;
}

/** Evaluate only comparable 28-day windows; sparse data is never a win or loss. */
export function evaluateSeoOutcome(input: { before: SeoOutcomeMetrics; after: SeoOutcomeMetrics }): SeoOutcome {
  const { before, after } = input;
  if (before.impressions < 100 || after.impressions < 100) {
    return { status: "inconclusive", reason: "insufficient_impressions" };
  }
  if (before.position == null || after.position == null) {
    return { status: "inconclusive", reason: "missing_position" };
  }
  const positionGain = before.position - after.position;
  const impressionGain = (after.impressions - before.impressions) / before.impressions;
  if (positionGain >= 2 && impressionGain >= 0.2) {
    return { status: "won", reason: "position_and_impressions_improved" };
  }
  if (after.position - before.position >= 3 && after.clicks <= before.clicks) {
    return { status: "lost", reason: "position_declined_without_click_growth" };
  }
  return { status: "inconclusive", reason: "no_decisive_change" };
}

export function measurementStatus(publishedAt: Date, now = new Date()): "published" | "measuring" | "evaluate" {
  const ageDays = (now.getTime() - publishedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays >= 28) return "evaluate";
  if (ageDays >= 21) return "measuring";
  return "published";
}
