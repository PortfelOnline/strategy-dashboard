import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { botsRouter } from "./router.js";
import { initOrchestrator } from "./orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "4000");

async function start() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // tRPC API (no auth)
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: botsRouter,
      createContext: () => ({}),
    })
  );

  if (isDev) {
    // Vite dev server as middleware
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.resolve(__dirname, ".."),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve built static files
    const distPath = path.resolve(__dirname, "../dist/public");
    app.use(express.static(distPath));
    app.use("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, () => {
    console.log(`Bot Dashboard running on http://localhost:${PORT}`);
    initOrchestrator();
  });
}

start().catch(console.error);
