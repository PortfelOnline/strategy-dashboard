import { describe, expect, it } from "vitest";
import { selectPositionFeedbackBatch, selectScoredPositionFeedbackBatch } from "./articleScheduler";
import { createInMemorySeoPositionFeedbackRepository } from "./seoPositionFeedback.db";
import { applyPublishResults } from "./seoPositionFeedbackCycle";

describe("position feedback scheduler fallback", () => {
  it("uses the first three queue URLs when GSC candidates are unavailable", () => {
    expect(selectPositionFeedbackBatch([], ["/kadastr/a/", "/kadastr/b/", "/kadastr/c/", "/kadastr/d/"]).urls)
      .toEqual(["/kadastr/a/", "/kadastr/b/", "/kadastr/c/"]);
  });

  it("keeps a failed WordPress publish queued without a cooldown", async () => {
    const repository = createInMemorySeoPositionFeedbackRepository();
    const cycle = await repository.createCycle({
      url: "https://100zem.ru/kadastr/a/",
      segment: "article",
      snapshotBeforeId: null,
      hypothesis: "content_quality",
    });

    await applyPublishResults(repository, [{
      cycleId: cycle.id,
      url: cycle.url,
      published: false,
      beforeContentHash: "before",
      afterContentHash: "after",
    }], new Date("2026-09-24T00:00:00Z"));

    const after = await repository.updateCycle(cycle.id, {});
    expect(after?.status).toBe("queued");
    expect(after?.cooldownUntil).toBeNull();
  });

  it("does not select reestr URLs or URLs improved during the 30-day cooldown", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const selected = selectScoredPositionFeedbackBatch([
      { url: "/reestr/77/", segment: "reestr" as const, impressions: 500, clicks: 10, ctr: .02, position: 12, indexStatus: null, queued: false, lastImprovedAt: null, lostHypotheses: [] },
      { url: "/kadastr/recent/", segment: "article" as const, impressions: 500, clicks: 10, ctr: .02, position: 12, indexStatus: null, queued: false, lastImprovedAt: new Date("2026-09-20T00:00:00Z"), lostHypotheses: [] },
      { url: "/kadastr/eligible/", segment: "article" as const, impressions: 500, clicks: 10, ctr: .02, position: 12, indexStatus: null, queued: false, lastImprovedAt: null, lostHypotheses: [] },
    ], now);

    expect(selected).toEqual(["/kadastr/eligible/"]);
  });
});
