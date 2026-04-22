import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import * as db from "../db";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";
import { initOrchestrator } from "../orchestrator";
import { initArticleScheduler } from "../articleScheduler";
import { initContentScheduler } from "../contentScheduler";
import { getLastNPublished } from "../backlinks.db";
import { buildRssFeed } from "../publishers/rss";
import { initBacklinkScheduler } from "../backlinkScheduler";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // DEV ONLY: instant login without OAuth — GET /api/dev/login
  if (process.env.NODE_ENV === "development" || process.env.ENABLE_DEV_LOGIN === "true") {
    app.get("/api/dev/login", async (req, res) => {
      try {
        const openId = "dev-user-local";
        await db.upsertUser({ openId, name: "Dev User", email: "dev@local.dev", lastSignedIn: new Date() });
        const token = await sdk.createSessionToken(openId, { name: "Dev User", expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.redirect("/");
      } catch (err) {
        console.error("[dev/login] error:", err);
        res.status(500).send(`Dev login failed: ${err}`);
      }
    });
  }

  // Serve locally generated images (DALL-E uploads)
  app.use("/uploads", express.static("public/uploads"));


  // LLM proxy: POST /api/llm — calls Groq (text) or Fireworks (images via tRPC)
  app.post("/api/llm", async (req, res) => {
    try {
      const { system, prompt, model } = req.body as { system?: string; prompt: string; model?: string };
      const apiUrl = (process.env.BUILT_IN_FORGE_API_URL ?? 'https://api.groq.com/openai').replace(/\/$/, '');
      const apiKey = process.env.BUILT_IN_FORGE_API_KEY ?? '';
      const llmModel = model ?? 'llama-3.3-70b-versatile';
      const messages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ];
      const upstream = await fetch(`${apiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: llmModel, messages, temperature: 0.8 }),
      });
      if (!upstream.ok) {
        const err = await upstream.text();
        return res.status(upstream.status).json({ error: err });
      }
      const data = await upstream.json() as any;
      res.json({ content: data.choices?.[0]?.message?.content ?? '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/rss/dzen", async (_req, res) => {
    try {
      const posts = await getLastNPublished("dzen", 20);
      res.set("Content-Type", "application/rss+xml; charset=utf-8");
      res.send(buildRssFeed(posts));
    } catch (err) {
      console.error("[RSS /rss/dzen]", err);
      res.status(500).send("RSS error");
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  // Handle malformed URLs (e.g. unresolved %VITE_* env vars) without crashing
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof URIError) {
      res.status(400).send('Bad Request');
      return;
    }
    next(err);
  });

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    initOrchestrator();
    initArticleScheduler();
    initContentScheduler();
    initBacklinkScheduler();
  });
}

// Prevent unhandled rejections/exceptions from crashing the process
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

startServer().catch(console.error);
