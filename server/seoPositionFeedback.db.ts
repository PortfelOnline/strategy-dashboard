import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { seoImprovementCycles, seoPageQueries, seoPageSnapshots } from "../drizzle/schema";
import { getDb } from "./db";

export type SeoSegment = "article" | "news" | "reestr" | "other";
export type SeoSource = "google" | "yandex";
export type SeoHypothesis = "intent_gap" | "snippet" | "ctr_metadata" | "internal_links" | "freshness" | "content_quality";
export type SeoCycleStatus = "queued" | "published" | "measuring" | "won" | "lost" | "inconclusive";

export interface PageSnapshotInput {
  url: string;
  segment: SeoSegment;
  source: SeoSource;
  periodStart: Date;
  periodEnd: Date;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
  indexStatus: string | null;
}

export interface PageQueryInput {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number | null;
}

export interface ImprovementCycleInput {
  url: string;
  segment: SeoSegment;
  snapshotBeforeId: number | null;
  hypothesis: SeoHypothesis;
  status?: SeoCycleStatus;
  beforeContentHash?: string | null;
}

export interface SeoSnapshotRecord extends PageSnapshotInput { id: number; capturedAt: Date; }
export interface SeoQueryRecord extends PageQueryInput { id: number; snapshotId: number; }
export interface SeoCycleRecord extends ImprovementCycleInput {
  id: number;
  status: SeoCycleStatus;
  snapshotAfterId: number | null;
  outcomeReason: string | null;
  afterContentHash: string | null;
  queuedAt: Date;
  publishedAt: Date | null;
  nextMeasurementAt: Date | null;
  cooldownUntil: Date | null;
}

export interface SeoPositionFeedbackRepository {
  saveSnapshot(input: PageSnapshotInput): Promise<SeoSnapshotRecord>;
  saveQueries(snapshotId: number, queries: PageQueryInput[]): Promise<SeoQueryRecord[]>;
  getSnapshot(id: number): Promise<SeoSnapshotRecord | null>;
  getLatestSnapshot(url: string, source?: SeoSource): Promise<SeoSnapshotRecord | null>;
  createCycle(input: ImprovementCycleInput): Promise<SeoCycleRecord>;
  updateCycle(id: number, patch: Partial<Omit<SeoCycleRecord, "id" | "url" | "segment" | "queuedAt">>): Promise<SeoCycleRecord | null>;
  listDueCycles(now: Date): Promise<SeoCycleRecord[]>;
}

const toSnapshotRecord = (row: typeof seoPageSnapshots.$inferSelect): SeoSnapshotRecord => ({
  ...row,
  ctr: Number(row.ctr),
  position: row.position == null ? null : Number(row.position),
});

const toQueryRecord = (row: typeof seoPageQueries.$inferSelect): SeoQueryRecord => ({
  ...row,
  ctr: Number(row.ctr),
  position: row.position == null ? null : Number(row.position),
});

const toCycleRecord = (row: typeof seoImprovementCycles.$inferSelect): SeoCycleRecord => ({
  ...row,
  snapshotBeforeId: row.snapshotBeforeId ?? null,
  snapshotAfterId: row.snapshotAfterId ?? null,
  beforeContentHash: row.beforeContentHash ?? null,
  afterContentHash: row.afterContentHash ?? null,
  outcomeReason: row.outcomeReason ?? null,
  publishedAt: row.publishedAt ?? null,
  nextMeasurementAt: row.nextMeasurementAt ?? null,
  cooldownUntil: row.cooldownUntil ?? null,
});

function topQueries(queries: PageQueryInput[]) {
  return [...queries]
    .sort((left, right) => right.impressions - left.impressions || right.clicks - left.clicks || left.query.localeCompare(right.query))
    .slice(0, 50);
}

export function createInMemorySeoPositionFeedbackRepository(): SeoPositionFeedbackRepository & { countSnapshots(): Promise<number> } {
  let snapshotId = 0;
  let queryId = 0;
  let cycleId = 0;
  const snapshots = new Map<string, SeoSnapshotRecord>();
  const queries = new Map<number, SeoQueryRecord[]>();
  const cycles = new Map<number, SeoCycleRecord>();
  const keyFor = (input: Pick<PageSnapshotInput, "url" | "source" | "periodEnd">) => `${input.url}\u0000${input.source}\u0000${input.periodEnd.toISOString()}`;

  return {
    async saveSnapshot(input) {
      const key = keyFor(input);
      const existing = snapshots.get(key);
      const snapshot: SeoSnapshotRecord = { ...input, id: existing?.id ?? ++snapshotId, capturedAt: existing?.capturedAt ?? new Date() };
      snapshots.set(key, snapshot);
      return snapshot;
    },
    async saveQueries(id, input) {
      const saved = topQueries(input).map((query) => ({ ...query, id: ++queryId, snapshotId: id }));
      queries.set(id, saved);
      return saved;
    },
    async getSnapshot(id) { return snapshots.get([...snapshots.entries()].find(([, snapshot]) => snapshot.id === id)?.[0] ?? '') ?? null; },
    async getLatestSnapshot(url, source) {
      return [...snapshots.values()]
        .filter((snapshot) => snapshot.url === url && (!source || snapshot.source === source))
        .sort((left, right) => right.periodEnd.getTime() - left.periodEnd.getTime())[0] ?? null;
    },
    async createCycle(input) {
      const cycle: SeoCycleRecord = {
        ...input, id: ++cycleId, status: input.status ?? "queued", snapshotAfterId: null,
        outcomeReason: null, beforeContentHash: input.beforeContentHash ?? null, afterContentHash: null,
        queuedAt: new Date(), publishedAt: null, nextMeasurementAt: null, cooldownUntil: null,
      };
      cycles.set(cycle.id, cycle);
      return cycle;
    },
    async updateCycle(id, patch) {
      const cycle = cycles.get(id);
      if (!cycle) return null;
      const updated = { ...cycle, ...patch } as SeoCycleRecord;
      cycles.set(id, updated);
      return updated;
    },
    async listDueCycles(now) {
      return [...cycles.values()].filter((cycle) => cycle.nextMeasurementAt && cycle.nextMeasurementAt <= now);
    },
    async countSnapshots() { return snapshots.size; },
  };
}

export const seoPositionFeedbackRepository: SeoPositionFeedbackRepository = {
  async saveSnapshot(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.insert(seoPageSnapshots).values(input).onDuplicateKeyUpdate({
      set: { segment: input.segment, periodStart: input.periodStart, impressions: input.impressions, clicks: input.clicks, ctr: input.ctr, position: input.position, indexStatus: input.indexStatus, capturedAt: new Date() },
    });
    const row = await db.select().from(seoPageSnapshots).where(and(eq(seoPageSnapshots.url, input.url), eq(seoPageSnapshots.source, input.source), eq(seoPageSnapshots.periodEnd, input.periodEnd))).limit(1);
    if (!row[0]) throw new Error("Snapshot upsert did not return a row");
    return toSnapshotRecord(row[0]);
  },
  async saveQueries(snapshotId, input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const selected = topQueries(input);
    await db.delete(seoPageQueries).where(eq(seoPageQueries.snapshotId, snapshotId));
    if (selected.length) await db.insert(seoPageQueries).values(selected.map((query) => ({ ...query, snapshotId })));
    const rows = await db.select().from(seoPageQueries).where(eq(seoPageQueries.snapshotId, snapshotId));
    return rows.map(toQueryRecord).sort((left, right) => right.impressions - left.impressions || right.clicks - left.clicks || left.query.localeCompare(right.query));
  },
  async getSnapshot(id) {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(seoPageSnapshots).where(eq(seoPageSnapshots.id, id)).limit(1);
    return rows[0] ? toSnapshotRecord(rows[0]) : null;
  },
  async getLatestSnapshot(url, source) {
    const db = await getDb();
    if (!db) return null;
    const conditions = source ? and(eq(seoPageSnapshots.url, url), eq(seoPageSnapshots.source, source)) : eq(seoPageSnapshots.url, url);
    const rows = await db.select().from(seoPageSnapshots).where(conditions).orderBy(desc(seoPageSnapshots.periodEnd)).limit(1);
    return rows[0] ? toSnapshotRecord(rows[0]) : null;
  },
  async createCycle(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const result = await db.insert(seoImprovementCycles).values(input);
    const id = Number((result as any)[0]?.insertId ?? (result as any).insertId);
    const rows = await db.select().from(seoImprovementCycles).where(eq(seoImprovementCycles.id, id)).limit(1);
    if (!rows[0]) throw new Error("Cycle insert did not return a row");
    return toCycleRecord(rows[0]);
  },
  async updateCycle(id, patch) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    await db.update(seoImprovementCycles).set(patch).where(eq(seoImprovementCycles.id, id));
    const rows = await db.select().from(seoImprovementCycles).where(eq(seoImprovementCycles.id, id)).limit(1);
    return rows[0] ? toCycleRecord(rows[0]) : null;
  },
  async listDueCycles(now) {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(seoImprovementCycles)
      .where(and(inArray(seoImprovementCycles.status, ["published", "measuring"]), lte(seoImprovementCycles.nextMeasurementAt, now)))
      .orderBy(seoImprovementCycles.nextMeasurementAt);
    return rows.map(toCycleRecord);
  },
};
