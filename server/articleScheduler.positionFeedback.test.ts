import { describe, expect, it } from "vitest";
import { selectPositionFeedbackBatch } from "./articleScheduler";
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
});
