import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getCookies } from "./cookie-extractor";
import type { BacklinkPost } from "../../drizzle/schema";

puppeteer.use(StealthPlugin());

export async function publishToDzen(post: BacklinkPost): Promise<string> {
  const cookies = await getCookies();
  const dzenCookies = cookies.filter(c =>
    c.domain.includes("dzen.ru") || c.domain.includes("yandex.ru") || c.domain.includes("yandex.com")
  );

  const browser = await (puppeteer as any).launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let page: any;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...dzenCookies.map((c: any) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite as any,
    })));

    await page.goto("https://dzen.ru/editor/create-article", { waitUntil: "networkidle2", timeout: 30000 });

    // Wait for editor
    await page.waitForSelector('[contenteditable="true"], [data-slate-editor="true"]', { timeout: 20000 });

    // Fill title — Dzen editor renders title as first contenteditable block
    const titleText  = post.title ?? "Статья о кадастре";
    const allEditors = await page.$$('[contenteditable="true"]');
    await allEditors[0].click();
    await page.keyboard.type(titleText);

    // Move to body (second contenteditable or Tab key)
    if (allEditors.length > 1) {
      await allEditors[1].click();
    } else {
      await page.keyboard.press("Tab");
    }
    await page.keyboard.type(post.article ?? "");
    await new Promise(r => setTimeout(r, 2000));

    // Click publish
    const publishBtn = await page.waitForSelector(
      'button[data-testid="publish"], button[class*="publish"], [data-action="publish"]',
      { timeout: 10000 }
    );
    await publishBtn?.click();

    // Wait for URL to contain /a/ (published article slug)
    await page.waitForFunction(
      () => location.href.includes("dzen.ru/a/"),
      { timeout: 30000 }
    );

    return page.url();
  } catch (err) {
    if (page) await page.screenshot({ path: `/tmp/backlinks-error-dzen-${Date.now()}.png` }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
