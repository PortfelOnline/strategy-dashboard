import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

let browser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  const b = await (puppeteer as any).launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      '--window-size=1366,768',
    ],
  });
  b.on('disconnected', () => { browser = null; launchPromise = null; });
  return b;
}

export async function getBrowser(): Promise<Browser> {
  if (browser?.connected) return browser;
  if (!launchPromise) launchPromise = launch().then(b => { browser = b; return b; });
  return launchPromise;
}

export async function fetchPageHtml(url: string, waitMs = 1500): Promise<string> {
  const b = await getBrowser();
  let page: Page | null = null;
  try {
    page = await b.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Small random delay to mimic human behaviour
    await new Promise(r => setTimeout(r, waitMs + Math.random() * 1000));
    return await page.content();
  } finally {
    await page?.close().catch(() => {});
  }
}
