import { describe, expect, it } from "vitest";
import { evaluateDueCycles, evaluateSeoOutcome } from "./seoOutcomeEvaluator";
import { createInMemorySeoPositionFeedbackRepository } from "./seoPositionFeedback.db";

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

  it("finalizes a 28-day loss and applies the 90-day hypothesis cooldown", async () => {
    const repository = createInMemorySeoPositionFeedbackRepository();
    const before = await repository.saveSnapshot({
      url: "https://100zem.ru/kadastr/a/", segment: "article", source: "google",
      periodStart: new Date("2026-07-01"), periodEnd: new Date("2026-07-28"),
      impressions: 200, clicks: 10, ctr: .05, position: 10, indexStatus: null,
    });
    const cycle = await repository.createCycle({ url: before.url, segment: "article", snapshotBeforeId: before.id, hypothesis: "snippet", status: "published" });
    await repository.updateCycle(cycle.id, { publishedAt: new Date("2026-08-01"), nextMeasurementAt: new Date("2026-08-29") });
    const after = await repository.saveSnapshot({ ...before, periodStart: new Date("2026-08-02"), periodEnd: new Date("2026-08-29"), impressions: 220, clicks: 10, position: 13 });

    await evaluateDueCycles(repository, new Date("2026-08-29"), async () => after);

    const updated = await repository.updateCycle(cycle.id, {});
    expect(updated?.status).toBe("lost");
    expect(updated?.cooldownUntil?.toISOString()).toBe("2026-11-27T00:00:00.000Z");
  });
});
