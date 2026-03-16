import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { botsRouter } from "./router.js";
import { createServer } from "http";
import { connect } from "net";
import { getVncContainerIp } from "./bots.js";
import { initOrchestrator } from "./orchestrator.js";
import { login, logout, isAuthenticated, requireAuth } from "./auth.js";

declare const __dirname: string;

const PORT = parseInt(process.env.PORT || "4000");
const STATIC = path.join(__dirname, "public");

const app = express();
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

// noVNC viewer (public - requires auth via token in URL or session)
const NOVNC_DIR = path.join(__dirname, '..', 'novnc');
if (fs.existsSync(NOVNC_DIR)) {
  app.use('/novnc', express.static(NOVNC_DIR));
}

// Static assets are public (JS/CSS needed to render the login page itself)
app.use(express.static(STATIC, { index: false }));

// Login page is public
app.get("/login", (_req, res) => res.sendFile(path.join(STATIC, "index.html")));

// All HTML routes require auth (SPA)
app.use("*", requireAuth, (_req, res) => res.sendFile(path.join(STATIC, "index.html")));

const httpServer = createServer(app);

// WebSocket proxy: /vnc-ws → websockify in yandex_bot container (port 5901)
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/vnc-ws') {
    const containerIp = getVncContainerIp();
    if (!containerIp) { socket.destroy(); return; }
    const target = connect(5901, containerIp, () => {
      // Resend the full HTTP upgrade request headers to websockify
      const headers = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n';
      target.write(headers);
      if (head && head.length > 0) target.write(head);
    });
    socket.pipe(target);
    target.pipe(socket);
    target.on('error', () => { try { socket.destroy(); } catch {} });
    socket.on('error', () => { try { target.destroy(); } catch {} });
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`\n✅  Bot Dashboard: http://localhost:${PORT}`);
  console.log(`Auth: ${process.env.AUTH_PASSWORD ? "custom password set" : "default 'admin' — set AUTH_PASSWORD in .env!"}\n`);
  initOrchestrator();
});
