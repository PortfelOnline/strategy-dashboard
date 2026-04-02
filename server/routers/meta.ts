import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as metaApi from "../_core/meta";
import * as metaDb from "../meta.db";
import { getDb } from "../db";
import { contentPosts } from "../../drizzle/schema";
import { eq, and, isNotNull, isNull } from "drizzle-orm";

export const metaRouter = router({
  /**
   * Get Meta OAuth URL for user to authenticate
   */
  getOAuthUrl: protectedProcedure
    .query(({ ctx }) => {
      // Encode userId in state so callback can find user even if cookie is blocked
      const state = Buffer.from(JSON.stringify({ userId: ctx.user.id, r: Math.random().toString(36).slice(2) })).toString('base64url');
      const oauthUrl = metaApi.getMetaOAuthUrl(state);
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
        // Exchange code for short-lived access token
        const tokenResponse = await metaApi.exchangeMetaCode(input.code);

        // Exchange for long-lived token (60 days instead of ~1 hour)
        const longLivedToken = await metaApi.exchangeForLongLivedToken(tokenResponse.access_token);
        const tokenToStore = longLivedToken || tokenResponse.access_token;
        // Long-lived tokens last ~60 days
        const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

        // Get user info
        const user = await metaApi.getMetaUser(tokenToStore);

        // Get Instagram accounts
        const instagramAccounts = await metaApi.getInstagramAccounts(tokenToStore);

        // Get Facebook pages
        const facebookPages = await metaApi.getFacebookPages(tokenToStore);

        // Store Instagram accounts
        for (const account of instagramAccounts) {
          await metaDb.upsertMetaAccount(ctx.user.id, {
            accountType: "instagram_business",
            accountId: account.id,
            accountName: account.username || account.name,
            accessToken: tokenToStore,
            expiresAt,
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

        // Extract plain text from JSON content (supports caption, hook+paragraphs+cta formats)
        let caption = input.caption;
        try {
          const parsed = JSON.parse(input.caption);
          const hashtags = Array.isArray(parsed.hashtags)
            ? '\n\n' + parsed.hashtags.join(' ')
            : (typeof parsed.hashtags === 'string' ? '\n\n' + parsed.hashtags : '');
          if (parsed.caption) {
            caption = parsed.caption + hashtags;
          } else if (parsed.hook || parsed.paragraphs) {
            const parts: string[] = [];
            if (parsed.hook) parts.push(parsed.hook);
            if (Array.isArray(parsed.paragraphs)) parts.push(...parsed.paragraphs);
            if (parsed.engagement_question) parts.push(parsed.engagement_question);
            if (parsed.cta) parts.push(parsed.cta);
            caption = parts.join('\n\n') + hashtags;
          }
        } catch {
          // Not JSON, use as-is
        }

        // Publish to Instagram
        const result = await metaApi.postToInstagram(
          input.accountId,
          account.accessToken,
          caption,
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
              metaPostId: result.id ? String(result.id) : null,
            } as any)
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

        // Extract plain text from JSON content (supports caption, hook+paragraphs+cta formats)
        let message = input.message;
        try {
          const parsed = JSON.parse(input.message);
          const hashtags = Array.isArray(parsed.hashtags)
            ? '\n\n' + parsed.hashtags.join(' ')
            : (typeof parsed.hashtags === 'string' ? '\n\n' + parsed.hashtags : '');
          if (parsed.caption) {
            message = parsed.caption + hashtags;
          } else if (parsed.hook || parsed.paragraphs) {
            const parts: string[] = [];
            if (parsed.hook) parts.push(parsed.hook);
            if (Array.isArray(parsed.paragraphs)) parts.push(...parsed.paragraphs);
            if (parsed.engagement_question) parts.push(parsed.engagement_question);
            if (parsed.cta) parts.push(parsed.cta);
            message = parts.join('\n\n') + hashtags;
          }
        } catch {
          // Not JSON, use as-is
        }

        // Publish to Facebook
        const result = await metaApi.postToFacebookPage(
          input.pageId,
          account.accessToken,
          message,
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
              metaPostId: result.id ? String(result.id) : null,
            } as any)
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
   * Poll server n relay for pending Meta OAuth code and process it
   */
  pollPendingAuth: protectedProcedure
    .mutation(async ({ ctx }) => {
      try {
        const res = await fetch("https://app.get-my-agent.com/strategy/meta/pending");
        const data = await res.json() as any;
        if (!data.ok || !data.code) {
          return { ready: false };
        }

        const { code } = data;

        // Exchange code for short-lived token
        const tokenResponse = await metaApi.exchangeMetaCode(code);

        // Exchange for long-lived token (60 days)
        const longLivedToken = await metaApi.exchangeForLongLivedToken(tokenResponse.access_token);
        const tokenToStore = longLivedToken || tokenResponse.access_token;
        const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

        // Get Facebook pages
        const facebookPages = await metaApi.getFacebookPages(tokenToStore);

        // Get Instagram accounts from pages
        const instagramAccounts = await metaApi.getInstagramAccountsFromPages(tokenToStore, facebookPages);

        // Store Facebook pages
        for (const page of facebookPages) {
          await metaDb.upsertMetaAccount(ctx.user.id, {
            accountType: "facebook_page",
            accountId: page.id,
            accountName: page.name,
            accessToken: page.access_token,
          });
        }

        // Store Instagram accounts
        for (const account of instagramAccounts) {
          await metaDb.upsertMetaAccount(ctx.user.id, {
            accountType: "instagram_business",
            accountId: account.id,
            accountName: account.username || account.name,
            accessToken: account.pageAccessToken,
            expiresAt,
          });
        }

        return {
          ready: true,
          instagramAccounts: instagramAccounts.length,
          facebookPages: facebookPages.length,
        };
      } catch (error) {
        console.error("[Meta Relay] pollPendingAuth error:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to process Meta auth" });
      }
    }),

  /**
   * Sync published posts from Meta (FB + IG) — updates status and postUrl by metaPostId
   */
  syncPosts: protectedProcedure
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No DB" });

      const accounts = await metaDb.getUserMetaAccounts(ctx.user.id);
      let updated = 0;

      // Build map: metaPostId -> postUrl from all connected accounts
      const remoteMap = new Map<string, string>(); // metaPostId -> permalink

      for (const account of accounts) {
        if (account.accountType === "facebook_page") {
          const posts = await metaApi.getPagePosts(account.accountId, account.accessToken);
          for (const p of posts) {
            remoteMap.set(p.id, p.permalink_url);
          }
          // Also map photo IDs → link (backward compat: old posts stored photo_id not post_id)
          const photos = await metaApi.getPagePhotos(account.accountId, account.accessToken);
          for (const ph of photos) {
            if (!remoteMap.has(ph.id)) remoteMap.set(ph.id, ph.link);
          }
        } else if (account.accountType === "instagram_business") {
          const media = await metaApi.getInstagramMedia(account.accountId, account.accessToken);
          for (const m of media) {
            remoteMap.set(m.id, m.permalink);
          }
        }
      }

      if (remoteMap.size === 0) return { updated: 0 };

      // Build full remote post details map for content-based matching
      const remoteDetails = new Map<string, { permalink: string; message?: string }>();
      for (const account of accounts) {
        if (account.accountType === "facebook_page") {
          const posts = await metaApi.getPagePosts(account.accountId, account.accessToken);
          for (const p of posts) remoteDetails.set(p.id, { permalink: p.permalink_url, message: p.message });
        } else if (account.accountType === "instagram_business") {
          const media = await metaApi.getInstagramMedia(account.accountId, account.accessToken);
          for (const m of media) remoteDetails.set(m.id, { permalink: m.permalink, message: m.caption });
        }
      }

      // Pass 1: match by metaPostId (published via app)
      const dbPosts = await db
        .select()
        .from(contentPosts)
        .where(and(eq(contentPosts.userId, ctx.user.id), isNotNull(contentPosts.metaPostId)));

      for (const post of dbPosts) {
        if (!post.metaPostId) continue;
        const remote = remoteDetails.get(post.metaPostId);
        if (!remote) continue;
        await db
          .update(contentPosts)
          .set({ status: "published", publishedAt: post.publishedAt ?? new Date(), postUrl: remote.permalink } as any)
          .where(eq(contentPosts.id, post.id));
        updated++;
      }

      // Pass 2: match published posts without metaPostId by content similarity
      const unlinkedPosts = await db
        .select()
        .from(contentPosts)
        .where(and(
          eq(contentPosts.userId, ctx.user.id),
          eq(contentPosts.status, "published"),
          isNull(contentPosts.metaPostId),
          isNull((contentPosts as any).postUrl),
        ));

      for (const post of unlinkedPosts) {
        // Extract hook/first sentence from post content for matching
        let hookText = "";
        try {
          const parsed = JSON.parse(post.content);
          hookText = (parsed.hook || parsed.paragraphs?.[0] || "").slice(0, 60).toLowerCase();
        } catch {
          hookText = post.content.slice(0, 60).toLowerCase();
        }
        if (!hookText) continue;

        // Find remote post whose message contains our hook text
        for (const [remoteId, remote] of remoteDetails) {
          if (!remote.message) continue;
          if (remote.message.toLowerCase().includes(hookText)) {
            await db
              .update(contentPosts)
              .set({ metaPostId: remoteId, postUrl: remote.permalink, publishedAt: post.publishedAt ?? new Date() } as any)
              .where(eq(contentPosts.id, post.id));
            remoteDetails.delete(remoteId); // prevent double-match
            updated++;
            break;
          }
        }
      }

      return { updated };
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

  /**
   * Fetch insights for a published post from Meta Graph API
   */
  getPostInsights: protectedProcedure
    .input(z.object({
      postId: z.number(),        // our DB post ID
      metaPostId: z.string(),    // Meta Graph post ID
      accountId: z.string(),     // Meta account ID (for token lookup)
    }))
    .query(async ({ ctx, input }) => {
      try {
        const account = await metaDb.getMetaAccount(ctx.user.id, input.accountId);
        if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

        const token = account.accessToken;
        const fields = "reach,impressions,like_count,comments_count,shares,saved";

        // Try IG insights first, then FB
        let insights: Record<string, number> = {};
        try {
          const igRes = await fetch(
            `https://graph.facebook.com/v19.0/${input.metaPostId}/insights?metric=reach,impressions,saved&access_token=${token}`
          );
          if (igRes.ok) {
            const igData = await igRes.json() as any;
            for (const item of igData?.data ?? []) {
              insights[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
            }
          }
        } catch {}

        // Also fetch basic fields (likes, comments work on both FB/IG)
        try {
          const basicRes = await fetch(
            `https://graph.facebook.com/v19.0/${input.metaPostId}?fields=${fields}&access_token=${token}`
          );
          if (basicRes.ok) {
            const basicData = await basicRes.json() as any;
            if (basicData.like_count !== undefined) insights.likes = basicData.like_count;
            if (basicData.comments_count !== undefined) insights.comments = basicData.comments_count;
            if (basicData.shares?.count !== undefined) insights.shares = basicData.shares.count;
          }
        } catch {}

        // Cache in DB
        const db = await getDb();
        if (db && (insights.reach || insights.impressions)) {
          await db.update(contentPosts).set({
            metaReach: insights.reach ?? null,
            metaImpressions: insights.impressions ?? null,
            metaLikes: insights.likes ?? null,
          } as any).where(eq(contentPosts.id, input.postId));
        }

        return {
          reach: insights.reach ?? null,
          impressions: insights.impressions ?? null,
          likes: insights.likes ?? null,
          comments: insights.comments ?? null,
          shares: insights.shares ?? null,
          saved: insights.saved ?? null,
        };
      } catch (error) {
        console.error("[Meta API] Insights error:", error);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to fetch insights" });
      }
    }),
});
