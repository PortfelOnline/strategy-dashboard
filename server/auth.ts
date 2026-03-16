import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const COOKIE_NAME = "bd_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_FILE = path.join(process.env.BOT_DIR || '/bot_work', 'outputs', 'sessions.json');

function loadTokens(): Set<string> {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      // Filter out expired tokens (older than 30 days)
      const cutoff = Date.now() - COOKIE_MAX_AGE;
      const valid = Object.entries(data as Record<string, number>)
        .filter(([, ts]) => ts > cutoff)
        .map(([t]) => t);
      return new Set(valid);
    }
  } catch {}
  return new Set<string>();
}

function saveTokens(tokens: Set<string>): void {
  try {
    const dir = path.dirname(TOKEN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Save tokens with timestamp
    const now = Date.now();
    const existing: Record<string, number> = {};
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        Object.assign(existing, JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')));
      }
    } catch {}
    for (const t of tokens) {
      if (!existing[t]) existing[t] = now;
    }
    // Remove tokens not in current set
    for (const k of Object.keys(existing)) {
      if (!tokens.has(k)) delete existing[k];
    }
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(existing, null, 2));
  } catch {}
}

const validTokens: Set<string> = loadTokens();

function getPassword(): string {
  return process.env.AUTH_PASSWORD || "admin";
}

function createToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  validTokens.add(token);
  saveTokens(validTokens);
  return token;
}

export function login(password: string, res: Response): boolean {
  if (password !== getPassword()) return false;
  const token = createToken();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: "strict",
  });
  return true;
}

export function logout(res: Response): void {
  validTokens.clear();
  saveTokens(validTokens);
  res.clearCookie(COOKIE_NAME);
}

export function isAuthenticated(req: Request): boolean {
  const token = req.cookies?.[COOKIE_NAME];
  return typeof token === "string" && validTokens.has(token);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthenticated(req)) {
    next();
    return;
  }
  if (req.path.startsWith("/api/")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.redirect("/login");
}
