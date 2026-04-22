import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getCookies } from "./cookie-extractor";
import type { BacklinkPost } from "../../drizzle/schema";

puppeteer.use(StealthPlugin());

export async function publishToSpark(post: BacklinkPost): Promise<string> {
  const cookies = await getCookies();
  const sparkCookies = cookies.filter(c =>
    c.domain.includes("yandex.ru") || c.domain.includes("yandex.com") || c.domain.includes("spark.ru")
  );

  const browser = await (puppeteer as any).launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let page: any;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...sparkCookies.map((c: any) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite as any,
    })));

    await page.goto("https://spark.ru/post/new", { waitUntil: "networkidle2", timeout: 30000 });

    if (page.url().includes("passport.yandex")) {
      throw new Error("Spark session expired — re-login in Safari to refresh Yandex session cookies");
    }

    // Title input
    const titleSel = 'input[name="title"], input[placeholder*="аголов"]';
    await page.waitForSelector(titleSel, { timeout: 15000 });
    await page.click(titleSel);
    await page.keyboard.type(post.title ?? "Статья об объектах недвижимости");

    // Body
    const allEditors = await page.$$('[contenteditable="true"]');
    const bodyEditor  = allEditors[allEditors.length - 1];
    await bodyEditor.click();
    await page.keyboard.type(post.article ?? "");
    await new Promise(r => setTimeout(r, 2000));

    // Publish
    const publishBtn = await page.waitForSelector('button[type="submit"], button[class*="submit"]', { timeout: 10000 });
    await publishBtn?.click();
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 });

    return page.url();
  } catch (err) {
    if (page) await page.screenshot({ path: `/tmp/backlinks-error-spark-${Date.now()}.png` }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
