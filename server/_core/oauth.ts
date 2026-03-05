import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import * as metaApi from "./meta";
import * as metaDb from "../meta.db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });

  // Meta (Facebook/Instagram) OAuth callback
  app.get("/api/oauth/meta/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const error = getQueryParam(req, "error");

    if (error) {
      console.error("[Meta OAuth] User denied access:", error);
      return res.redirect("/?meta_error=access_denied");
    }

    if (!code) {
      return res.redirect("/?meta_error=no_code");
    }

    // Get current user from session cookie
    let userId: number | null = null;
    try {
      const cookieName = COOKIE_NAME;
      const sessionToken = req.cookies?.[cookieName];
      if (sessionToken) {
        const session = await sdk.verifySession(sessionToken);
        if (session?.openId) {
          const user = await db.getUserByOpenId(session.openId);
          userId = user?.id ?? null;
        }
      }
    } catch (e) {
      console.error("[Meta OAuth] Failed to get session user:", e);
    }

    if (!userId) {
      return res.redirect("/accounts?meta_error=not_logged_in");
    }

    try {
      // Exchange code for access token
      const tokenResponse = await metaApi.exchangeMetaCode(code);

      // Get Facebook pages
      const facebookPages = await metaApi.getFacebookPages(tokenResponse.access_token);

      // Get Instagram business accounts from pages
      const instagramAccounts = await metaApi.getInstagramAccountsFromPages(
        tokenResponse.access_token,
        facebookPages
      );

      let connected = 0;

      // Store Facebook pages
      for (const page of facebookPages) {
        await metaDb.upsertMetaAccount(userId, {
          accountType: "facebook_page",
          accountId: page.id,
          accountName: page.name,
          accessToken: page.access_token,
        });
        connected++;
      }

      // Store Instagram accounts
      for (const account of instagramAccounts) {
        await metaDb.upsertMetaAccount(userId, {
          accountType: "instagram_business",
          accountId: account.id,
          accountName: account.username || account.name,
          accessToken: account.pageAccessToken,
        });
        connected++;
      }

      console.log(`[Meta OAuth] Connected ${connected} accounts for user ${userId}`);
      res.redirect(`/accounts?meta_success=${connected}`);
    } catch (err) {
      console.error("[Meta OAuth] Callback error:", err);
      res.redirect("/accounts?meta_error=auth_failed");
    }
  });
}
