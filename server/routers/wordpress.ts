import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as wp from "../_core/wordpress";
import * as wpDb from "../wordpress.db";
import { getDb } from "../db";
import { contentPosts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const wordpressRouter = router({
  /**
   * List connected WordPress sites
   */
  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    return wpDb.getUserWordpressAccounts(ctx.user.id);
  }),

  /**
   * Connect a new WordPress site (validates credentials first)
   */
  addAccount: protectedProcedure
    .input(z.object({
      siteUrl:     z.string().url(),
      siteName:    z.string().min(1),
      username:    z.string().min(1),
      appPassword: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        await wp.testConnection(input.siteUrl, input.username, input.appPassword);
      } catch (error: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error?.message || "Failed to connect to WordPress site",
        });
      }

      try {
        await wpDb.upsertWordpressAccount(ctx.user.id, {
          siteUrl:     input.siteUrl,
          siteName:    input.siteName,
          username:    input.username,
          appPassword: input.appPassword,
        });
        return { success: true, siteName: input.siteName };
      } catch (error) {
        console.error("[WordPress Router] addAccount error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save WordPress account",
        });
      }
    }),

  /**
   * Publish a content post to a WordPress site
   */
  publishPost: protectedProcedure
    .input(z.object({
      accountId: z.number(),
      postId:    z.number(),
      title:     z.string(),
      content:   z.string(),
      status:    z.enum(["publish", "draft"]).default("publish"),
    }))
    .mutation(async ({ ctx, input }) => {
      const account = await wpDb.getWordpressAccountById(ctx.user.id, input.accountId);
      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "WordPress account not found" });
      }

      let wpResult: { id: number; link: string };
      try {
        wpResult = await wp.publishPost(
          account.siteUrl,
          account.username,
          account.appPassword,
          { title: input.title, content: input.content, status: input.status }
        );
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error?.message || "Failed to publish to WordPress",
        });
      }

      if (input.status === "publish") {
        const db = await getDb();
        if (db) {
          await db
            .update(contentPosts)
            .set({ status: "published", publishedAt: new Date() })
            .where(eq(contentPosts.id, input.postId));
        }
      }

      return { success: true, wpPostId: wpResult.id, link: wpResult.link };
    }),

  /**
   * Disconnect a WordPress site
   */
  disconnectAccount: protectedProcedure
    .input(z.object({ accountId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const success = await wpDb.deactivateWordpressAccount(ctx.user.id, input.accountId);
      if (!success) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      return { success: true };
    }),
});
