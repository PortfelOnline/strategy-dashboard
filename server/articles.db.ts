import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { articleAnalyses, ArticleAnalysis, InsertArticleAnalysis } from "../drizzle/schema";

let _db: ReturnType<typeof drizzle> | null = null;

async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function saveArticleAnalysis(
  userId: number,
  data: Omit<InsertArticleAnalysis, 'userId'>
): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(articleAnalyses).values({ ...data, userId });
  return (result as any)?.[0]?.insertId ?? (result as any)?.insertId ?? null;
}

export async function getUserAnalysisHistory(
  userId: number,
  limit = 50
): Promise<ArticleAnalysis[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(articleAnalyses)
    .where(eq(articleAnalyses.userId, userId))
    .orderBy(desc(articleAnalyses.createdAt))
    .limit(limit);
}

export async function getAnalysisById(
  userId: number,
  id: number
): Promise<ArticleAnalysis | null> {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(articleAnalyses)
    .where(and(eq(articleAnalyses.userId, userId), eq(articleAnalyses.id, id)))
    .limit(1);

  return result[0] || null;
}

export async function deleteAnalysis(userId: number, id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .delete(articleAnalyses)
    .where(and(eq(articleAnalyses.userId, userId), eq(articleAnalyses.id, id)));

  return true;
}
