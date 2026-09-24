import { describe, expect, it } from "vitest";
import { validateArticleForPublish } from "./articlePublishGate";

describe("article publish gate", () => {
  it("rejects a failed publish candidate before it can receive a published cycle", () => {
    const result = validateArticleForPublish("<h2>Коротко</h2><p>Текст</p>", { targetWords: 100, targetFaq: 1 });
    expect(result.pass).toBe(false);
    expect(result.issues).toContain("missing_table");
  });
});
