import type { SeoHypothesis, SeoSegment } from "./seoPositionFeedback.db";

export interface CandidateInput { url: string; segment: SeoSegment; impressions: number; clicks: number; ctr: number; position: number | null; indexStatus: string | null; queued: boolean; lastImprovedAt: Date | null; lostHypotheses: string[]; segmentMedianCtr?: number | null; }
export interface CandidateScore { eligible: boolean; priority: "high" | "medium" | "low"; score: number; reason: string; }
const DAY = 86400000;

export function chooseHypothesis(input: { badQuality?: boolean; crawledNotIndexed?: boolean; lowCtr?: boolean; internalLinks?: number; stale?: boolean; missingIntent?: boolean }): SeoHypothesis {
  if (input.badQuality || input.crawledNotIndexed) return "content_quality";
  if (input.missingIntent) return "intent_gap";
  if (input.lowCtr) return "ctr_metadata";
  if ((input.internalLinks ?? 3) < 3) return "internal_links";
  if (input.stale) return "freshness";
  return "snippet";
}

export function scoreCandidate(input: CandidateInput, now = new Date()): CandidateScore {
  if (input.segment === "reestr") return { eligible: false, priority: "low", score: 0, reason: "reestr_diagnostic_only" };
  if (input.segment !== "article" && input.segment !== "news") return { eligible: false, priority: "low", score: 0, reason: "unsupported_segment" };
  if (input.lastImprovedAt && now.getTime() - input.lastImprovedAt.getTime() < 30 * DAY) return { eligible: false, priority: "low", score: 0, reason: "url_cooldown" };
  const high = input.indexStatus === "bad_quality" || input.indexStatus === "crawled_not_indexed" || (input.position != null && input.position >= 8 && input.position <= 30 && input.impressions >= 100);
  const lowCtr = input.position != null && input.position >= 1 && input.position <= 20 && input.impressions >= 100 && input.segmentMedianCtr != null && input.ctr < input.segmentMedianCtr * .7;
  const medium = (input.position != null && input.position >= 31 && input.position <= 50 && input.impressions >= 300) || lowCtr;
  const priority = high ? "high" : medium ? "medium" : "low";
  return { eligible: high || medium || input.queued, priority, score: (high ? 100 : medium ? 50 : 0) + (input.queued ? 10 : 0), reason: high ? "high_potential" : medium ? "medium_potential" : input.queued ? "fallback_queue" : "insufficient_signal" };
}
