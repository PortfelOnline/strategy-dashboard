import { eq, and, lte, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, contentPosts, contentTemplates, savedTopics, InsertContentPost, InsertContentTemplate } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createContentPost(
  userId: number,
  post: Omit<InsertContentPost, 'userId'>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  const result = await db.insert(contentPosts).values({
    userId,
    title: post.title,
    content: post.content,
    platform: post.platform,
    language: post.language,
    status: post.status,
    hashtags: post.hashtags,
    mediaUrl: post.mediaUrl,
    scheduledAt: post.scheduledAt,
    templateId: post.templateId,
    contentFormat: post.contentFormat,
  });
  
  return result;
}

export async function getUserContentPosts(userId: number, status?: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  if (status) {
    return db.select().from(contentPosts)
      .where(and(
        eq(contentPosts.userId, userId),
        eq(contentPosts.status, status as any)
      ))
      .orderBy(desc(contentPosts.createdAt));
  }

  return db.select().from(contentPosts)
    .where(eq(contentPosts.userId, userId))
    .orderBy(desc(contentPosts.createdAt));
}

export async function getContentTemplates(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  return db.select().from(contentTemplates).where(eq(contentTemplates.userId, userId));
}

export async function createContentTemplate(
  userId: number,
  template: Omit<InsertContentTemplate, 'userId'>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  
  return db.insert(contentTemplates).values({
    ...template,
    userId,
  });
}

export async function updateContentPost(
  userId: number,
  postId: number,
  updates: Partial<Omit<InsertContentPost, 'userId'>>
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.update(contentPosts)
    .set(updates)
    .where(and(eq(contentPosts.id, postId), eq(contentPosts.userId, userId)));
}

export async function deleteContentPost(userId: number, postId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.delete(contentPosts)
    .where(and(eq(contentPosts.id, postId), eq(contentPosts.userId, userId)));
}

export async function getDueScheduledPosts() {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  return db.select().from(contentPosts).where(
    and(eq(contentPosts.status, 'scheduled'), lte(contentPosts.scheduledAt, now))
  );
}

// ── Saved Topics ─────────────────────────────────────────────────────────────

export async function getSavedTopics(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.select().from(savedTopics).where(eq(savedTopics.userId, userId));
}

export async function saveTopic(userId: number, keyword: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.insert(savedTopics).values({ userId, keyword });
}

export async function deleteTopic(userId: number, topicId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  return db.delete(savedTopics).where(and(eq(savedTopics.id, topicId), eq(savedTopics.userId, userId)));
}

// TODO: add more feature queries here as your schema grows.
