import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as metaApi from "../_core/meta";
import * as metaDb from "../meta.db";
import { getDb } from "../db";
import { contentPosts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const metaRouter = router({
  /**
   * Get Meta OAuth URL for user to authenticate
   */
  getOAuthUrl: publicProcedure
    .input(z.object({
      state: z.string(),
    }))
    .query(({ input }) => {
      const oauthUrl = metaApi.getMetaOAuthUrl(input.state);
      return { oauthUrl };
    }),

  /**
   * Handle OAuth callback and store credentials
   */
  handleOAuthCallback: protectedProcedure
    .input(z.object({
      code: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Exchange code for access token
        const tokenResponse = await metaApi.exchangeMetaCode(input.code);

        // Get user info
        const user = await metaApi.getMetaUser(tokenResponse.access_token);

        // Get Instagram accounts
        const instagramAccounts = await metaApi.getInstagramAccounts(tokenResponse.access_token);

        // Get Facebook pages
        const facebookPages = await metaApi.getFacebookPages(tokenResponse.access_token);

        // Store Instagram accounts
        for (const account of instagramAccounts) {
          await metaDb.upsertMetaAccount(ctx.user.id, {
            accountType: "instagram_business",
            accountId: account.id,
            accountName: account.username || account.name,
            accessToken: tokenResponse.access_token,
            expiresAt: tokenResponse.expires_in
              ? new Date(Date.now() + tokenResponse.expires_in * 1000)
              : undefined,
          });
        }

        // Store Facebook pages
        for (const page of facebookPages) {
          await metaDb.upsertMetaAccount(ctx.user.id, {
            accountType: "facebook_page",
            accountId: page.id,
            accountName: page.name,
            accessToken: page.access_token,
          });
        }

        return {
          success: true,
          instagramAccounts: instagramAccounts.length,
          facebookPages: facebookPages.length,
        };
      } catch (error) {
        console.error("[Meta OAuth] Error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to authenticate with Meta",
        });
      }
    }),

  /**
   * Get user's connected Meta accounts
   */
  getAccounts: protectedProcedure
    .query(async ({ ctx }) => {
      const accounts = await metaDb.getUserMetaAccounts(ctx.user.id);
      return accounts;
    }),

  /**
   * Publish content to Instagram
   */
  publishToInstagram: protectedProcedure
    .input(z.object({
      accountId: z.string(),
      postId: z.number(),
      caption: z.string(),
      imageUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get Meta account
        const account = await metaDb.getMetaAccount(ctx.user.id, input.accountId);
        if (!account) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Instagram account not found",
          });
        }

        // Publish to Instagram
        const result = await metaApi.postToInstagram(
          input.accountId,
          account.accessToken,
          input.caption,
          input.imageUrl
        );

        // Update post status in database
        const db = await getDb();
        if (db) {
          await db
            .update(contentPosts)
            .set({
              status: "published",
              publishedAt: new Date(),
            })
            .where(eq(contentPosts.id, input.postId));
        }

        return {
          success: true,
          postId: result.id,
        };
      } catch (error) {
        console.error("[Meta API] Instagram publish error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to publish to Instagram",
        });
      }
    }),

  /**
   * Publish content to Facebook page
   */
  publishToFacebook: protectedProcedure
    .input(z.object({
      pageId: z.string(),
      postId: z.number(),
      message: z.string(),
      imageUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get Meta account
        const account = await metaDb.getMetaAccount(ctx.user.id, input.pageId);
        if (!account) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Facebook page not found",
          });
        }

        // Publish to Facebook
        const result = await metaApi.postToFacebookPage(
          input.pageId,
          account.accessToken,
          input.message,
          input.imageUrl
        );

        // Update post status in database
        const db = await getDb();
        if (db) {
          await db
            .update(contentPosts)
            .set({
              status: "published",
              publishedAt: new Date(),
            })
            .where(eq(contentPosts.id, input.postId));
        }

        return {
          success: true,
          postId: result.id,
        };
      } catch (error) {
        console.error("[Meta API] Facebook publish error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to publish to Facebook",
        });
      }
    }),

  /**
   * Disconnect Meta account
   */
  disconnectAccount: protectedProcedure
    .input(z.object({
      accountId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const success = await metaDb.deactivateMetaAccount(ctx.user.id, input.accountId);
        if (!success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Account not found",
          });
        }

        return { success: true };
      } catch (error) {
        console.error("[Meta API] Disconnect error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to disconnect account",
        });
      }
    }),
});
