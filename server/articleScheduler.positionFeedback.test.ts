import { describe, expect, it } from "vitest";
import { selectPositionFeedbackBatch } from "./articleScheduler";

describe("position feedback scheduler fallback", () => {
  it("uses the first three queue URLs when GSC candidates are unavailable", () => {
    expect(selectPositionFeedbackBatch([], ["/kadastr/a/", "/kadastr/b/", "/kadastr/c/", "/kadastr/d/"]).urls)
      .toEqual(["/kadastr/a/", "/kadastr/b/", "/kadastr/c/"]);
  });
});
