import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { botsRouter } from "./router.js";
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

// Static assets are public (JS/CSS needed to render the login page itself)
app.use(express.static(STATIC, { index: false }));

// Login page is public
app.get("/login", (_req, res) => res.sendFile(path.join(STATIC, "index.html")));

// All HTML routes require auth (SPA)
app.use("*", requireAuth, (_req, res) => res.sendFile(path.join(STATIC, "index.html")));

app.listen(PORT, () => {
  console.log(`\n✅  Bot Dashboard: http://localhost:${PORT}`);
  console.log(`Auth: ${process.env.AUTH_PASSWORD ? "custom password set" : "default 'admin' — set AUTH_PASSWORD in .env!"}\n`);
  initOrchestrator();
});
