import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { getCookies } from "./cookie-extractor";
import type { BacklinkPost } from "../../drizzle/schema";

puppeteer.use(StealthPlugin());

// Yandex Q (formerly Яндекс.Кью) lives at yandex.ru/q/
export async function publishToKw(post: BacklinkPost): Promise<string> {
  const cookies = await getCookies();
  const yndxCookies = cookies.filter(c =>
    c.domain.includes("yandex.ru") || c.domain.includes("yandex.com")
  );

  const browser = await (puppeteer as any).launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  let page: any;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setCookie(...yndxCookies.map((c: any) => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite as any,
    })));

    // Search for relevant questions using the anchor as topic
    const topic = encodeURIComponent((post.anchorText ?? "кадастровый номер").substring(0, 60));
    await page.goto(`https://yandex.ru/q/search?text=${topic}`, { waitUntil: "networkidle2", timeout: 30000 });

    // Find a question link and click it
    let questionUrl = "";
    const links = await page.$$('a[href*="/q/"]');
    for (const link of links.slice(0, 8)) {
      const href = await link.getProperty("href").then((h: any) => h.jsonValue() as Promise<string>);
      if (!href.includes("/q/search") && href.includes("/q/")) {
        await page.goto(href, { waitUntil: "networkidle2", timeout: 10000 });
        questionUrl = page.url();
        break;
      }
    }
    if (!questionUrl) throw new Error("Could not find a Yandex Q question to answer on search page");

    // Click the answer button
    const answerBtnSel = 'button[data-testid="answer-button"], a[href*="answer"], button[class*="answer"]';
    const answerBtn = await page.$(answerBtnSel);
    if (!answerBtn) throw new Error("Could not find answer button on Yandex Q");
    await answerBtn.click();
    await new Promise(r => setTimeout(r, 1000));

    // Type answer in the editor
    const answerEditors = await page.$$('[contenteditable="true"]');
    const answerEditor  = answerEditors[answerEditors.length - 1];
    await answerEditor.click();
    await page.keyboard.type(post.article ?? "");
    await new Promise(r => setTimeout(r, 1500));

    // Submit
    const submitSel = 'button[type="submit"], button[data-testid="submit-answer"]';
    const submit = await page.waitForSelector(submitSel, { timeout: 10000 });
    await submit?.click();
    await new Promise(r => setTimeout(r, 3000));

    return questionUrl;
  } catch (err) {
    if (page) await page.screenshot({ path: `/tmp/backlinks-error-kw-${Date.now()}.png` }).catch(() => {});
    throw err;
  } finally {
    await browser.close();
  }
}
