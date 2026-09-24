import { describe, expect, it } from "vitest";
import { chooseHypothesis, scoreCandidate } from "./seoImprovementScorer";

const base = { url: "https://100zem.ru/kadastr/servitut/", segment: "article" as const, impressions: 150, clicks: 5, ctr: 0.03, position: 18, indexStatus: null, queued: false, lastImprovedAt: null, lostHypotheses: [] as string[] };

describe("SEO improvement scorer", () => {
  it("makes position 8-30 with 100+ impressions high priority", () => expect(scoreCandidate(base).priority).toBe("high"));
  it("rejects a URL improved 10 days ago", () => expect(scoreCandidate({ ...base, lastImprovedAt: new Date(Date.now() - 10 * 86400000) }).eligible).toBe(false));
  it("keeps reestr diagnostic-only", () => expect(scoreCandidate({ ...base, url: "https://100zem.ru/reestr/77/", segment: "reestr" }).eligible).toBe(false));
  it("chooses exactly one primary hypothesis for several defects", () => expect(chooseHypothesis({ badQuality: true, lowCtr: true, internalLinks: 1 })).toBe("content_quality"));
});
