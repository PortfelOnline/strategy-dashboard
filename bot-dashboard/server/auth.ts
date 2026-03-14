import type { Request, Response, NextFunction } from "express";
import * as crypto from "crypto";

const COOKIE_NAME = "bd_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
const validTokens = new Set<string>();

function getPassword(): string {
  return process.env.AUTH_PASSWORD || "admin";
}

function createToken(): string {
  const token = crypto.randomBytes(32).toString("hex");
  validTokens.add(token);
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
