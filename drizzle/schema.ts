import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Content templates for different content pillars
 */
export const contentTemplates = mysqlTable("contentTemplates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  title: varchar("title", { length: 255 }).notNull(),
  pillarType: mysqlEnum("pillarType", ["desi_business_owner", "five_minute_transformation", "roi_calculator"]).notNull(),
  platform: mysqlEnum("platform", ["facebook", "instagram", "whatsapp", "youtube", "all"]).notNull(),
  language: mysqlEnum("language", ["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("hinglish").notNull(),
  prompt: text("prompt").notNull(),
  description: text("description"),
  isPublic: int("isPublic").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContentTemplate = typeof contentTemplates.$inferSelect;
export type InsertContentTemplate = typeof contentTemplates.$inferInsert;

/**
 * Generated content posts
 */
export const contentPosts = mysqlTable("contentPosts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  templateId: int("templateId").references(() => contentTemplates.id),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  platform: mysqlEnum("platform", ["facebook", "instagram", "whatsapp", "youtube"]).notNull(),
  language: varchar("language", { length: 50 }).default("hinglish").notNull(),
  status: mysqlEnum("status", ["draft", "scheduled", "published", "archived"]).default("draft").notNull(),
  scheduledAt: timestamp("scheduledAt"),
  publishedAt: timestamp("publishedAt"),
  contentFormat: mysqlEnum("contentFormat", ["carousel", "reel", "story", "feed_post"]),
  hashtags: text("hashtags"),
  mediaUrl: varchar("mediaUrl", { length: 512 }),
  engagement: int("engagement").default(0),
  metaPostId: varchar("metaPostId", { length: 255 }),   // Meta Graph API post ID (after publish)
  postUrl: varchar("postUrl", { length: 512 }),          // Permalink to the published post
  metaReach: int("metaReach"),                           // Cached from Meta Insights
  metaImpressions: int("metaImpressions"),
  metaLikes: int("metaLikes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContentPost = typeof contentPosts.$inferSelect;
export type InsertContentPost = typeof contentPosts.$inferInsert;
/**
 * Meta (Facebook/Instagram) account credentials
 */
export const metaAccounts = mysqlTable("metaAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  accountType: mysqlEnum("accountType", ["facebook_page", "instagram_business"]).notNull(),
  accountId: varchar("accountId", { length: 255 }).notNull(),
  accountName: varchar("accountName", { length: 255 }).notNull(),
  accessToken: text("accessToken").notNull(),
  refreshToken: text("refreshToken"),
  expiresAt: timestamp("expiresAt"),
  isActive: int("isActive").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MetaAccount = typeof metaAccounts.$inferSelect;
export type InsertMetaAccount = typeof metaAccounts.$inferInsert;

/**
 * WordPress site credentials (Application Password auth)
 */
export const wordpressAccounts = mysqlTable("wordpressAccounts", {
  id:          int("id").autoincrement().primaryKey(),
  userId:      int("userId").notNull().references(() => users.id),
  siteUrl:     varchar("siteUrl", { length: 512 }).notNull(),
  siteName:    varchar("siteName", { length: 255 }).notNull(),
  username:    varchar("username", { length: 255 }).notNull(),
  appPassword: text("appPassword").notNull(),
  isActive:    int("isActive").default(1).notNull(),
  createdAt:   timestamp("createdAt").defaultNow().notNull(),
  updatedAt:   timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WordpressAccount = typeof wordpressAccounts.$inferSelect;
export type InsertWordpressAccount = typeof wordpressAccounts.$inferInsert;

/**
 * History of AI article analyses
 */
export const articleAnalyses = mysqlTable("articleAnalyses", {
  id:                  int("id").autoincrement().primaryKey(),
  userId:              int("userId").notNull().references(() => users.id),
  url:                 varchar("url", { length: 512 }).notNull(),
  originalTitle:       varchar("originalTitle", { length: 512 }).notNull(),
  originalContent:     text("originalContent").notNull(),
  wordCount:           int("wordCount").default(0).notNull(),
  improvedTitle:       varchar("improvedTitle", { length: 512 }).notNull(),
  improvedContent:     text("improvedContent").notNull(),
  metaTitle:           varchar("metaTitle", { length: 512 }),
  metaDescription:     text("metaDescription"),
  keywords:            text("keywords"),         // JSON array string
  generalSuggestions:  text("generalSuggestions"), // JSON array string
  headings:            text("headings"),           // JSON array string
  seoScore:            int("seoScore").default(0).notNull(),
  serpKeyword:         varchar("serpKeyword", { length: 255 }),
  googlePos:           int("googlePos"),           // null = not in top-100
  yandexPos:           int("yandexPos"),           // null = not in top-100
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
});

export type ArticleAnalysis = typeof articleAnalyses.$inferSelect;
export type InsertArticleAnalysis = typeof articleAnalyses.$inferInsert;

/**
 * Saved competitor intel topics (keywords user wants to track)
 */
export const savedTopics = mysqlTable("savedTopics", {
  id:        int("id").autoincrement().primaryKey(),
  userId:    int("userId").notNull().references(() => users.id),
  keyword:   varchar("keyword", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SavedTopic = typeof savedTopics.$inferSelect;
export type InsertSavedTopic = typeof savedTopics.$inferInsert;

export const backlinkPosts = mysqlTable("backlink_posts", {
  id:           int("id").autoincrement().primaryKey(),
  platform:     mysqlEnum("platform", ["dzen", "spark", "kw"]).notNull(),
  targetUrl:    varchar("target_url", { length: 512 }).notNull(),
  anchorText:   varchar("anchor_text", { length: 512 }).notNull(),
  title:        varchar("title", { length: 512 }),
  article:      text("article"),
  status:       mysqlEnum("status", ["pending", "publishing", "published", "failed"]).notNull().default("pending"),
  publishedUrl: varchar("published_url", { length: 512 }),
  publishedAt:  timestamp("published_at"),
  errorMsg:     text("error_msg"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export type BacklinkPost = typeof backlinkPosts.$inferSelect;
export type InsertBacklinkPost = typeof backlinkPosts.$inferInsert;
