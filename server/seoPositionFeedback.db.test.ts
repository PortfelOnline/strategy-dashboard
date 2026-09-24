import { describe, expect, it } from "vitest";
import {
  createInMemorySeoPositionFeedbackRepository,
  type PageQueryInput,
} from "./seoPositionFeedback.db";

describe("SEO position feedback repository", () => {
  it("upserts a snapshot by URL, source, and period end", async () => {
    const repository = createInMemorySeoPositionFeedbackRepository();
    const base = {
      url: "https://100zem.ru/kadastr/servitut/",
      segment: "article" as const,
      source: "google" as const,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-28T00:00:00.000Z"),
      impressions: 120,
      clicks: 4,
      ctr: 0.0333,
      position: 18.4,
      indexStatus: null,
    };

    const first = await repository.saveSnapshot(base);
    const second = await repository.saveSnapshot({ ...base, clicks: 9 });

    expect(second.id).toBe(first.id);
    expect(await repository.countSnapshots()).toBe(1);
    expect((await repository.getLatestSnapshot(base.url, base.source))?.clicks).toBe(9);
  });

  it("keeps only the top 50 page queries by impressions and then clicks", async () => {
    const repository = createInMemorySeoPositionFeedbackRepository();
    const snapshot = await repository.saveSnapshot({
      url: "https://100zem.ru/kadastr/servitut/",
      segment: "article",
      source: "google",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-28T00:00:00.000Z"),
      impressions: 1000,
      clicks: 20,
      ctr: 0.02,
      position: 21,
      indexStatus: null,
    });
    const queries: PageQueryInput[] = Array.from({ length: 55 }, (_, index) => ({
      query: `запрос ${index + 1}`,
      impressions: index < 53 ? 100 : 200,
      clicks: index < 53 ? index : index === 53 ? 1 : 2,
      ctr: 0.01,
      position: 10,
    }));

    const saved = await repository.saveQueries(snapshot.id, queries);

    expect(saved).toHaveLength(50);
    expect(saved[0]?.query).toBe("запрос 55");
    expect(saved.at(-1)?.query).toBe("запрос 6");
  });
});
