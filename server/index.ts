import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { botsRouter } from "./router.js";
import { initOrchestrator } from "./orchestrator.js";
import { login, logout, isAuthenticated, requireAuth } from "./auth.js";
import { getVncContainerIp } from "./bots.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== "production";
const PORT = parseInt(process.env.PORT || "4000");

async function start() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());
  app.use(cookieParser());

  // --- Auth endpoints (public) ---
  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body || {};
    if (!password) { res.status(400).json({ error: "password required" }); return; }
    const ok = login(password, res);
    if (ok) { res.json({ ok: true }); }
    else { res.status(401).json({ error: "Wrong password" }); }
  });

  app.post("/api/auth/logout", (_req, res) => {
    logout(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  });

  // --- Protected API ---
  app.use("/api/trpc", requireAuth, createExpressMiddleware({
    router: botsRouter,
    createContext: () => ({}),
  }));

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.resolve(__dirname, ".."),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "../dist/public");
    app.get("/login", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    app.use(requireAuth, express.static(distPath));
    app.use("*", requireAuth, (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // --- noVNC static files ---
  const noVncPath = path.resolve(__dirname, "../novnc");
  if (fs.existsSync(noVncPath)) {
    app.use("/novnc", express.static(noVncPath));
  }

  // --- VNC WebSocket proxy at /vnc-ws ---
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    const containerIp = getVncContainerIp() || "127.0.0.1";
    const tcp = net.createConnection({ host: containerIp, port: 5900 });

    tcp.on("data", (data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
    tcp.on("close", () => ws.close());
    tcp.on("error", () => ws.close());

    ws.on("message", (data) => { tcp.write(data as Buffer); });
    ws.on("close", () => tcp.destroy());
    ws.on("error", () => tcp.destroy());
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/vnc-ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, () => {
    console.log(`Bot Dashboard running on http://localhost:${PORT}`);
    console.log(`Auth: ${process.env.AUTH_PASSWORD ? "custom password set" : "default password 'admin' — set AUTH_PASSWORD in .env!"}`);
    initOrchestrator();
  });
}

start().catch(console.error);
