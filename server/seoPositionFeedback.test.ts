import { describe, expect, it } from "vitest";
import { normalizeYandexIndexStatus, segmentForUrl } from "./seoPositionFeedback";

describe("SEO position feedback signal normalization", () => {
  it.each([
    ["https://100zem.ru/kadastr/servitut/", "article"],
    ["https://100zem.ru/novosti/izmeneniya-egrn/", "news"],
    ["https://100zem.ru/reestr/77-01/", "reestr"],
  ] as const)("segments %s as %s", (url, expected) => {
    expect(segmentForUrl(url)).toBe(expected);
  });

  it("maps Yandex BAD_QUALITY into the controlled bad_quality status", () => {
    expect(normalizeYandexIndexStatus("BAD_QUALITY")).toBe("bad_quality");
  });
});
