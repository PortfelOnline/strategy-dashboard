import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const execFileAsync = promisify(execFile);

const SCRIPT_DIR   = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH  = path.join(SCRIPT_DIR, "extract-cookies.py");
const COOKIES_PATH = path.join(SCRIPT_DIR, ".safari-cookies.json");
const MAX_AGE_MS   = 6 * 60 * 60 * 1000; // 6 hours

export type PuppeteerCookie = {
  name:     string;
  value:    string;
  domain:   string;
  path:     string;
  expires:  number;
  httpOnly: boolean;
  secure:   boolean;
  sameSite: "Lax" | "Strict" | "None";
};

async function refresh(): Promise<void> {
  const { stderr } = await execFileAsync("python3", [SCRIPT_PATH], { cwd: SCRIPT_DIR });
  if (!String(stderr).startsWith("OK")) {
    throw new Error(`Cookie extractor failed: ${String(stderr).trim()}`);
  }
}

export async function getCookies(): Promise<PuppeteerCookie[]> {
  const stale =
    !fs.existsSync(COOKIES_PATH) ||
    Date.now() - fs.statSync(COOKIES_PATH).mtimeMs >= MAX_AGE_MS;

  if (stale) await refresh();

  return JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8")) as PuppeteerCookie[];
}
