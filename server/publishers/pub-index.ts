import { execFile } from "child_process";
import { writeFileSync } from "fs";
import { getFirstPending, updateBacklinkPost, insertBacklinkPost, getAllBacklinkPosts, getLastNPublished } from "../backlinks.db";
import { generateDzenArticle, generateSparkArticle, generateKwAnswer, PRIORITY_PAGES, pickNextPage } from "./content-generator";
import { buildRssFeed } from "./rss";
import { publishToDzen } from "./dzen";
import { publishToSpark } from "./spark";
import { publishToKw } from "./kw";
import { publishToTelegram } from "./telegram";
import type { BacklinkPost } from "../../drizzle/schema";

export type Platform = "dzen" | "spark" | "kw";

async function deployRss(): Promise<void> {
  try {
    const posts = await getLastNPublished("dzen", 20);
    if (!posts.length) return;
    const xml     = buildRssFeed(posts);
    const tmpFile = "/tmp/rss-dzen.xml";
    writeFileSync(tmpFile, xml, "utf-8");
    await new Promise<void>((resolve, reject) => {
      execFile("scp", [tmpFile, "root@kad:/application/rss-dzen.xml"], err => {
        if (err) reject(err); else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      execFile("ssh", ["root@kad", "chmod 644 /application/rss-dzen.xml"], err => {
        if (err) reject(err); else resolve();
      });
    });
    console.log(`[Backlinks] RSS deployed (${posts.length} posts) → https://kadastrmap.info/rss-dzen.xml`);
  } catch (err: any) {
    console.error("[Backlinks] RSS deploy failed (non-fatal):", err.message);
  }
}

async function deployTelegram(postId: number): Promise<void> {
  try {
    const { getBacklinkPost } = await import("../backlinks.db");
    const post = await getBacklinkPost(postId);
    if (!post) return;
    await publishToTelegram(post);
  } catch (err: any) {
    console.error("[Backlinks] Telegram deploy failed (non-fatal):", err.message);
  }
}

export async function generateAndQueue(platform: Platform, targetUrl?: string): Promise<number> {
  const all           = await getAllBacklinkPosts();
  const platformCount = all.filter(p => p.platform === platform).length;

  let page = pickNextPage(platformCount);
  if (targetUrl) {
    const found = PRIORITY_PAGES.find(p => p.url === targetUrl);
    if (found) page = found;
  }

  let title:   string;
  let article: string;

  if (platform === "dzen") {
    const r = await generateDzenArticle(page.url, page.anchor);
    title = r.title; article = r.article;
  } else if (platform === "spark") {
    const r = await generateSparkArticle(page.url, page.anchor);
    title = r.title; article = r.article;
  } else {
    const r = await generateKwAnswer(page.url, page.anchor);
    title = r.question; article = r.article;
  }

  const id = await insertBacklinkPost({ platform, targetUrl: page.url, anchorText: page.anchor, title, article, status: "pending" });

  if (platform === "dzen") {
    deployRss();                   // fire-and-forget RSS deploy
    deployTelegram(id);            // fire-and-forget Telegram post
  }

  return id;
}

export async function publishPost(post: BacklinkPost): Promise<void> {
  await updateBacklinkPost(post.id, { status: "publishing" });
  try {
    let publishedUrl: string;
    if (post.platform === "dzen")        publishedUrl = await publishToDzen(post);
    else if (post.platform === "spark")  publishedUrl = await publishToSpark(post);
    else                                 publishedUrl = await publishToKw(post);

    await updateBacklinkPost(post.id, { status: "published", publishedUrl, publishedAt: new Date() });
    console.log(`[Backlinks] Published ${post.platform} id=${post.id} -> ${publishedUrl}`);
    if (post.platform === "dzen") deployRss();
  } catch (err: any) {
    await updateBacklinkPost(post.id, { status: "failed", errorMsg: err.message ?? String(err) });
    console.error(`[Backlinks] FAILED ${post.platform} id=${post.id}:`, err.message);
    throw err;
  }
}

export async function publishNext(platform: Platform): Promise<void> {
  const post = await getFirstPending(platform);
  if (!post) { console.log(`[Backlinks] No pending posts for ${platform}`); return; }
  await publishPost(post);
}
