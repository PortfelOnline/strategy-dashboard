import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { metaAccounts, InsertMetaAccount, MetaAccount } from "../drizzle/schema";
import { ENV } from './_core/env';

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
 * Create or update Meta account
 */
export async function upsertMetaAccount(
  userId: number,
  account: Omit<InsertMetaAccount, 'userId'>
): Promise<MetaAccount | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const existing = await db
      .select()
      .from(metaAccounts)
      .where(
        and(
          eq(metaAccounts.userId, userId),
          eq(metaAccounts.accountId, account.accountId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(metaAccounts)
        .set({
          ...account,
          updatedAt: new Date(),
        })
        .where(eq(metaAccounts.id, existing[0].id));

      return existing[0];
    } else {
      await db.insert(metaAccounts).values({
        ...account,
        userId,
      });

      const result = await db
        .select()
        .from(metaAccounts)
        .where(
          and(
            eq(metaAccounts.userId, userId),
            eq(metaAccounts.accountId, account.accountId)
          )
        )
        .limit(1);

      return result[0] || null;
    }
  } catch (error) {
    console.error("[Database] Failed to upsert Meta account:", error);
    throw error;
  }
}

/**
 * Get user's Meta accounts
 */
export async function getUserMetaAccounts(userId: number): Promise<MetaAccount[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    return await db
      .select()
      .from(metaAccounts)
      .where(and(eq(metaAccounts.userId, userId), eq(metaAccounts.isActive, 1)));
  } catch (error) {
    console.error("[Database] Failed to get Meta accounts:", error);
    return [];
  }
}

/**
 * Get specific Meta account
 */
export async function getMetaAccount(
  userId: number,
  accountId: string
): Promise<MetaAccount | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const result = await db
      .select()
      .from(metaAccounts)
      .where(
        and(
          eq(metaAccounts.userId, userId),
          eq(metaAccounts.accountId, accountId)
        )
      )
      .limit(1);

    return result[0] || null;
  } catch (error) {
    console.error("[Database] Failed to get Meta account:", error);
    return null;
  }
}

/**
 * Deactivate Meta account
 */
export async function deactivateMetaAccount(
  userId: number,
  accountId: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    await db
      .update(metaAccounts)
      .set({ isActive: 0, updatedAt: new Date() })
      .where(
        and(
          eq(metaAccounts.userId, userId),
          eq(metaAccounts.accountId, accountId)
        )
      );

    return true;
  } catch (error) {
    console.error("[Database] Failed to deactivate Meta account:", error);
    return false;
  }
}

/**
 * Update Meta account token
 */
export async function updateMetaAccountToken(
  userId: number,
  accountId: string,
  accessToken: string,
  expiresAt?: Date
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    await db
      .update(metaAccounts)
      .set({
        accessToken,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(metaAccounts.userId, userId),
          eq(metaAccounts.accountId, accountId)
        )
      );

    return true;
  } catch (error) {
    console.error("[Database] Failed to update Meta account token:", error);
    return false;
  }
}
