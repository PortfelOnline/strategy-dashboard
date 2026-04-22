import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import { backlinkPosts, BacklinkPost, InsertBacklinkPost } from "../drizzle/schema";

export async function insertBacklinkPost(data: Omit<InsertBacklinkPost, "id" | "createdAt">): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(backlinkPosts).values(data);
    const id = (result as any)?.[0]?.insertId ?? (result as any)?.insertId;
    if (typeof id !== "number") throw new Error("Insert did not return insertId");
    return id;
  } catch (err) {
    console.error("[backlinks.db] insertBacklinkPost failed:", err);
    throw err;
  }
}

export async function getAllBacklinkPosts(): Promise<BacklinkPost[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(backlinkPosts).orderBy(desc(backlinkPosts.createdAt));
}

export async function getBacklinkPost(id: number): Promise<BacklinkPost | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(backlinkPosts).where(eq(backlinkPosts.id, id)).limit(1);
  return rows[0];
}

export async function getFirstPending(platform: "dzen" | "spark" | "kw"): Promise<BacklinkPost | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(backlinkPosts)
    .where(and(eq(backlinkPosts.platform, platform), eq(backlinkPosts.status, "pending")))
    .orderBy(backlinkPosts.createdAt)
    .limit(1);
  return rows[0];
}

export async function updateBacklinkPost(
  id: number,
  data: Partial<Pick<BacklinkPost, "status" | "publishedUrl" | "publishedAt" | "errorMsg" | "title" | "article">>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(backlinkPosts).set(data).where(eq(backlinkPosts.id, id));
  } catch (err) {
    console.error("[backlinks.db] updateBacklinkPost failed:", err);
    throw err;
  }
}

export async function deleteBacklinkPost(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.delete(backlinkPosts).where(eq(backlinkPosts.id, id));
  } catch (err) {
    console.error("[backlinks.db] deleteBacklinkPost failed:", err);
    throw err;
  }
}

export async function getStatsByPlatform(): Promise<{ dzen: number; spark: number; kw: number; thisWeek: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const all = await db.select().from(backlinkPosts).where(eq(backlinkPosts.status, "published"));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return {
    dzen:     all.filter(r => r.platform === "dzen").length,
    spark:    all.filter(r => r.platform === "spark").length,
    kw:       all.filter(r => r.platform === "kw").length,
    thisWeek: all.filter(r => r.publishedAt && r.publishedAt >= weekAgo).length,
  };
}

export async function getLastNPublished(platform: "dzen" | "spark" | "kw", limit = 20): Promise<BacklinkPost[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Include pending+published so RSS feed has content even before Puppeteer publishing
  const { inArray } = await import("drizzle-orm");
  return db.select().from(backlinkPosts)
    .where(and(eq(backlinkPosts.platform, platform), inArray(backlinkPosts.status, ["pending", "published"])))
    .orderBy(desc(backlinkPosts.createdAt))
    .limit(limit);
}
