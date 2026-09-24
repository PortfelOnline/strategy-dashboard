import type { PageQueryInput, PageSnapshotInput, SeoSegment } from "./seoPositionFeedback.db";

export type YandexIndexStatus =
  | "bad_quality"
  | "crawled_not_indexed"
  | "searchable"
  | "noindex"
  | "http_error"
  | "redirect"
  | "not_canonical"
  | "parse_error"
  | "unknown";

export interface NormalizedGscSnapshot {
  snapshot: Omit<PageSnapshotInput, "source">;
  queries: PageQueryInput[];
}

export function segmentForUrl(rawUrl: string): SeoSegment {
  let pathname = rawUrl;
  try { pathname = new URL(rawUrl, "https://100zem.ru").pathname; } catch { /* use raw path */ }
  if (pathname.startsWith("/kadastr/")) return "article";
  if (pathname.startsWith("/novosti/")) return "news";
  if (pathname.startsWith("/reestr/")) return "reestr";
  return "other";
}

export function normalizeYandexIndexStatus(status: string | null | undefined): YandexIndexStatus {
  switch ((status ?? "").trim().toUpperCase()) {
    case "BAD_QUALITY": return "bad_quality";
    case "CRAWLED - CURRENTLY NOT INDEXED":
    case "CRAWLED_CURRENTLY_NOT_INDEXED": return "crawled_not_indexed";
    case "SEARCHABLE": return "searchable";
    case "META_NO_INDEX": return "noindex";
    case "HTTP_ERROR": return "http_error";
    case "REDIRECT": return "redirect";
    case "NOT_CANONICAL": return "not_canonical";
    case "PARSE_ERROR": return "parse_error";
    default: return "unknown";
  }
}

export function normalizeGscSnapshot(input: {
  url: string; periodStart: Date; periodEnd: Date; clicks?: number; impressions?: number; ctr?: number; position?: number; queries?: PageQueryInput[];
}): NormalizedGscSnapshot {
  return {
    snapshot: {
      url: input.url, segment: segmentForUrl(input.url), periodStart: input.periodStart, periodEnd: input.periodEnd,
      clicks: Number(input.clicks ?? 0), impressions: Number(input.impressions ?? 0), ctr: Number(input.ctr ?? 0),
      position: input.position == null ? null : Number(input.position), indexStatus: null,
    },
    queries: [...(input.queries ?? [])]
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query))
      .slice(0, 50),
  };
}
