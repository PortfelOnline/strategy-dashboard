import { describe, expect, it } from "vitest";
import { evaluateSeoOutcome } from "./seoOutcomeEvaluator";

describe("SEO position feedback outcome evaluator", () => {
  it("marks a 20% impression gain and two-position gain as won", () => {
    expect(evaluateSeoOutcome({ before: { impressions: 100, clicks: 4, position: 12 }, after: { impressions: 120, clicks: 5, position: 10 } }).status)
      .toBe("won");
  });

  it("keeps low-volume measurements inconclusive", () => {
    expect(evaluateSeoOutcome({ before: { impressions: 99, clicks: 1, position: 12 }, after: { impressions: 500, clicks: 5, position: 8 } }).status)
      .toBe("inconclusive");
  });

  it("marks a three-position loss without click growth as lost", () => {
    expect(evaluateSeoOutcome({ before: { impressions: 200, clicks: 10, position: 10 }, after: { impressions: 220, clicks: 10, position: 13 } }).status)
      .toBe("lost");
  });
});
