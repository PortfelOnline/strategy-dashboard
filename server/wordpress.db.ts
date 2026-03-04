import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { wordpressAccounts, InsertWordpressAccount, WordpressAccount } from "../drizzle/schema";

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

/**
 * Create or update WordPress account (upsert by userId + siteUrl + username)
 */
export async function upsertWordpressAccount(
  userId: number,
  account: Omit<InsertWordpressAccount, 'userId'>
): Promise<WordpressAccount | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const existing = await db
      .select()
      .from(wordpressAccounts)
      .where(
        and(
          eq(wordpressAccounts.userId, userId),
          eq(wordpressAccounts.siteUrl, account.siteUrl),
          eq(wordpressAccounts.username, account.username)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(wordpressAccounts)
        .set({ ...account, isActive: 1, updatedAt: new Date() })
        .where(eq(wordpressAccounts.id, existing[0].id));

      return existing[0];
    } else {
      await db.insert(wordpressAccounts).values({ ...account, userId });

      const result = await db
        .select()
        .from(wordpressAccounts)
        .where(
          and(
            eq(wordpressAccounts.userId, userId),
            eq(wordpressAccounts.siteUrl, account.siteUrl),
            eq(wordpressAccounts.username, account.username)
          )
        )
        .limit(1);

      return result[0] || null;
    }
  } catch (error) {
    console.error("[Database] Failed to upsert WordPress account:", error);
    throw error;
  }
}

/**
 * Get all active WordPress accounts for a user
 */
export async function getUserWordpressAccounts(userId: number): Promise<WordpressAccount[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    return await db
      .select()
      .from(wordpressAccounts)
      .where(and(eq(wordpressAccounts.userId, userId), eq(wordpressAccounts.isActive, 1)));
  } catch (error) {
    console.error("[Database] Failed to get WordPress accounts:", error);
    return [];
  }
}

/**
 * Get a specific WordPress account by numeric id
 */
export async function getWordpressAccountById(
  userId: number,
  id: number
): Promise<WordpressAccount | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const result = await db
      .select()
      .from(wordpressAccounts)
      .where(and(eq(wordpressAccounts.userId, userId), eq(wordpressAccounts.id, id)))
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error("[Database] Failed to get WordPress account:", error);
    return null;
  }
}

/**
 * Soft-delete a WordPress account (set isActive=0)
 */
export async function deactivateWordpressAccount(
  userId: number,
  id: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    await db
      .update(wordpressAccounts)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(and(eq(wordpressAccounts.userId, userId), eq(wordpressAccounts.id, id)));

    return true;
  } catch (error) {
    console.error("[Database] Failed to deactivate WordPress account:", error);
    return false;
  }
}
