/**
 * Social Media Agent
 * Pipeline: URL → scrape → extract → trends → hooks → content × N → images × N → upload → save drafts
 */
import { writeFileSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { invokeLLM } from "../_core/llm";
import { generateImageWithFallback } from "../_core/imageGen";
import { createContentPost } from "../db";

const SSH_HOST = "root@5.42.109.72";
const PUBLIC_BASE = "https://get-my-agent.com/ai-uploads";
const UPLOAD_DIR = path.resolve(process.cwd(), "public/uploads");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentInput {
  url: string;
  userId: number;
  platforms?: Array<"facebook" | "instagram">;
  language?: string;
  industry?: string;
}

export interface AgentStep {
  step: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface AgentResult {
  posts: Array<{ id: number; platform: string; title: string; mediaUrl?: string }>;
  steps: AgentStep[];
}

export type ProgressCallback = (step: AgentStep) => void;

// ─── Step 1: Fetch & parse URL ────────────────────────────────────────────────

async function fetchUrl(url: string): Promise<{ title: string; description: string; body: string; ogImage?: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SocialAgentBot/1.0)" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const getTag = (pattern: RegExp) => (html.match(pattern)?.[1] ?? "").trim();

  const title = getTag(/<title[^>]*>([^<]{1,200})<\/title>/i)
    || getTag(/property="og:title"[^>]*content="([^"]{1,200})"/i)
    || getTag(/name="og:title"[^>]*content="([^"]{1,200})"/i);

  const description = getTag(/property="og:description"[^>]*content="([^"]{1,400})"/i)
    || getTag(/name="description"[^>]*content="([^"]{1,400})"/i)
    || getTag(/content="([^"]{20,400})"[^>]*name="description"/i);

  const ogImage = getTag(/property="og:image"[^>]*content="([^"]{1,500})"/i)
    || getTag(/content="([^"]{1,500})"[^>]*property="og:image"/i);

  // Extract readable body text: strip tags, scripts, styles, collapse whitespace
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);

  return { title, description, body, ogImage: ogImage || undefined };
}

// ─── Step 2: Extract key info via Groq ───────────────────────────────────────

interface ExtractedInfo {
  topic: string;
  keyFeatures: string[];
  targetAudience: string;
  valueProposition: string;
  priceOrOffer?: string;
  callToAction: string;
  suggestedImageStyle: string;
}

async function extractKeyInfo(page: ReturnType<typeof fetchUrl> extends Promise<infer T> ? T : never, sourceUrl: string): Promise<ExtractedInfo> {
  const prompt = `Analyze this webpage content and extract key information for social media marketing.
URL: ${sourceUrl}
Title: ${page.title}
Description: ${page.description}
Body text (truncated): ${page.body.slice(0, 1500)}

Extract and return JSON with this exact structure:
{
  "topic": "one-line topic summary",
  "keyFeatures": ["feature1", "feature2", "feature3"],
  "targetAudience": "who this is for",
  "valueProposition": "main benefit/value in one sentence",
  "priceOrOffer": "price or offer if mentioned, or null",
  "callToAction": "best CTA for social media",
  "suggestedImageStyle": "describe the ideal image for this content (photo style, subject, mood)"
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You are a social media marketing expert. Extract structured info from web content. Always respond with valid JSON only, no markdown." },
      { role: "user", content: prompt },
    ],
  });

  try {
    const clean = (typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "").replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(clean) as ExtractedInfo;
  } catch {
    return {
      topic: page.title || "Content from URL",
      keyFeatures: [page.description || "See link for details"],
      targetAudience: "Indian business owners",
      valueProposition: page.description || "Check out this amazing offer",
      callToAction: "Visit the link in bio",
      suggestedImageStyle: "Professional product/service photography, Indian context",
    };
  }
}

// ─── Step 3: Fetch trending topics ───────────────────────────────────────────

async function fetchTrends(geo = "IN"): Promise<string[]> {
  try {
    const res = await fetch(`https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TrendBot/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const matches = xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g);
    return [...matches].map(m => m[1]).filter(Boolean).slice(0, 6);
  } catch {
    return [];
  }
}

// ─── Step 4: Generate viral hook variants ────────────────────────────────────

async function generateHooks(info: ExtractedInfo, trends: string[], industry: string): Promise<string[]> {
  const trendCtx = trends.length > 0 ? `\nTrending in India right now: ${trends.slice(0, 4).join(", ")}` : "";
  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You generate viral social media hooks for Indian audiences. Return JSON only." },
      { role: "user", content: `Generate 3 viral hook variants for this content:
Topic: ${info.topic}
Industry: ${industry}
Value proposition: ${info.valueProposition}
Target audience: ${info.targetAudience}
${info.priceOrOffer ? `Price/Offer: ${info.priceOrOffer}` : ""}
${trendCtx}

Return JSON: { "hooks": ["hook1", "hook2", "hook3"] }
Rules: Use ₹ if relevant, be specific, create urgency or curiosity, max 15 words each.` },
    ],
  });
  try {
    const clean = (typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "").replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as { hooks: string[] };
    return parsed.hooks.slice(0, 3);
  } catch {
    return [info.valueProposition, `Why ${info.targetAudience} love this`, info.callToAction];
  }
}

// ─── Step 5: Generate platform-specific content ───────────────────────────────

async function generateFacebookPost(info: ExtractedInfo, hook: string, trends: string[], language: string): Promise<{ hook: string; paragraphs: string[]; cta: string; hashtags: string[]; imagePrompt: string }> {
  const trendCtx = trends.length > 0 ? `\nTrending context (weave in if relevant): ${trends.slice(0, 3).join(", ")}` : "";
  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You write viral Facebook posts for Indian audiences. Return JSON only." },
      { role: "user", content: `Write a Facebook post using this hook and info.
Hook: "${hook}"
Topic: ${info.topic}
Key features: ${info.keyFeatures.join(", ")}
Value proposition: ${info.valueProposition}
${info.priceOrOffer ? `Offer: ${info.priceOrOffer}` : ""}
CTA: ${info.callToAction}
Language: ${language}
${trendCtx}

Return JSON:
{
  "hook": "the opening hook (punchy, 1 line)",
  "paragraphs": ["para1 (problem/context)", "para2 (solution/offer)", "para3 (social proof/urgency)"],
  "cta": "call to action",
  "hashtags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7"],
  "imagePrompt": "detailed Flux image prompt for this post (photorealistic, Indian context, professional)"
}` },
    ],
  });
  try {
    const clean = (typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "").replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(clean);
  } catch {
    return { hook, paragraphs: [info.valueProposition], cta: info.callToAction, hashtags: ["#India", "#Business"], imagePrompt: info.suggestedImageStyle };
  }
}

async function generateInstagramCarousel(info: ExtractedInfo, hook: string, trends: string[], language: string): Promise<{ hook: string; slides: Array<{ slide: number; headline: string; body: string }>; caption: string; hashtags: string[]; imagePrompt: string }> {
  const trendCtx = trends.length > 0 ? `\nTrending context: ${trends.slice(0, 3).join(", ")}` : "";
  const response = await invokeLLM({
    messages: [
      { role: "system", content: "You create viral Instagram carousel posts for Indian audiences. Return JSON only." },
      { role: "user", content: `Create a 6-slide Instagram carousel using this hook and info.
Hook: "${hook}"
Topic: ${info.topic}
Key features: ${info.keyFeatures.join(", ")}
Value proposition: ${info.valueProposition}
${info.priceOrOffer ? `Offer: ${info.priceOrOffer}` : ""}
Language: ${language}
${trendCtx}

Return JSON:
{
  "hook": "the swipe-worthy first line",
  "slides": [
    {"slide": 1, "headline": "Cover — attention grabber", "body": ""},
    {"slide": 2, "headline": "The Problem", "body": "2-3 lines"},
    {"slide": 3, "headline": "Key Benefit 1", "body": "detail"},
    {"slide": 4, "headline": "Key Benefit 2", "body": "detail"},
    {"slide": 5, "headline": "Proof / Result", "body": "stats or testimonial"},
    {"slide": 6, "headline": "CTA", "body": "clear next step"}
  ],
  "caption": "engaging 120-word caption with emoji",
  "hashtags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10"],
  "imagePrompt": "Flux image prompt: cinematic, Indian context, 4:5 ratio style description"
}` },
    ],
  });
  try {
    const clean = (typeof response.choices?.[0]?.message?.content === "string" ? response.choices[0].message.content : "").replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(clean);
  } catch {
    return { hook, slides: [{ slide: 1, headline: hook, body: "" }, { slide: 2, headline: info.valueProposition, body: "" }], caption: info.valueProposition, hashtags: ["#India"], imagePrompt: info.suggestedImageStyle };
  }
}

// ─── Step 6: Generate & upload image ─────────────────────────────────────────

async function generateAndUploadImage(prompt: string, aspect: "4:5" | "16:9" | "1:1", platform: string): Promise<string | undefined> {
  try {
    const localPath = await generateImageWithFallback(prompt);

    if (localPath.startsWith("file://")) {
      const filePath = localPath.replace("file://", "");
      const filename = path.basename(filePath);
      mkdirSync(UPLOAD_DIR, { recursive: true });
      const destLocal = path.join(UPLOAD_DIR, filename);

      // Copy to public/uploads
      const { copyFileSync } = await import("fs");
      copyFileSync(filePath, destLocal);

      // Upload to server
      try {
        execFileSync("scp", ["-o", "StrictHostKeyChecking=no", destLocal, `${SSH_HOST}:/var/www/ai-uploads/`], { timeout: 30000 });
        return `${PUBLIC_BASE}/${filename}`;
      } catch {
        return `/uploads/${filename}`;
      }
    }
    return localPath; // HTTP URL from Together AI etc.
  } catch (e) {
    console.error(`[SocialAgent] Image generation failed for ${platform}:`, e);
    return undefined;
  }
}


// ─── URL Discovery via SerpAPI + Trends ──────────────────────────────────────

export interface DiscoveredUrl {
  url: string;
  title: string;
  source: string;
}

const INDUSTRY_QUERIES: Record<string, string[]> = {
  real_estate: ["property India news", "real estate agent AI India", "Mumbai property market", "India home buying tips"],
  ecommerce:   ["ecommerce India trends", "D2C brand India", "online shopping India news"],
  restaurant:  ["restaurant India trends", "food delivery India", "cloud kitchen India"],
  default:     ["small business India AI", "digital marketing India", "startup India news"],
};

export async function discoverUrls({
  industry = "real_estate",
  geo = "IN",
  maxUrls = 6,
}: {
  industry?: string;
  geo?: string;
  maxUrls?: number;
}): Promise<DiscoveredUrl[]> {
  const serpKey = process.env.SERPAPI_KEY ?? "";
  const results: DiscoveredUrl[] = [];

  // 1. Get trending topics to seed queries
  const trends = await fetchTrends(geo).catch(() => []);
  const industryQueries = INDUSTRY_QUERIES[industry] ?? INDUSTRY_QUERIES.default;

  // Build search queries: blend 1-2 trending topics with industry seeds
  const trendSeeds = trends.slice(0, 2);
  const queries = [
    ...trendSeeds.map(t => `${t} ${industryQueries[0]}`),
    ...industryQueries.slice(0, 2),
  ].slice(0, 3);

  // 2. SerpAPI searches in parallel
  const searchPromises = queries.map(async (q) => {
    try {
      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&location=India&hl=en&gl=in&num=5&api_key=${serpKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return [];
      const data = await res.json() as { organic_results?: Array<{ link: string; title: string; displayed_link?: string }> };
      return (data.organic_results ?? []).map(r => ({
        url: r.link,
        title: r.title,
        source: new URL(r.link).hostname.replace(/^www\./, ""),
      }));
    } catch {
      return [];
    }
  });

  const allResults = (await Promise.all(searchPromises)).flat();

  // Deduplicate by hostname (prefer diversity of sources)
  const seen = new Set<string>();
  for (const r of allResults) {
    try {
      const host = new URL(r.url).hostname;
      if (!seen.has(host)) {
        seen.add(host);
        results.push(r);
      }
    } catch { /* skip invalid URLs */ }
    if (results.length >= maxUrls) break;
  }

  return results;
}

// ─── Main Agent ───────────────────────────────────────────────────────────────

export async function runSocialAgent(input: AgentInput, onProgress?: ProgressCallback): Promise<AgentResult> {
  const steps: AgentStep[] = [];
  const posts: AgentResult["posts"] = [];
  const platforms = input.platforms ?? ["facebook", "instagram"];
  const language = input.language ?? "english";
  const industry = input.industry ?? "real_estate";

  const log = (step: string, status: AgentStep["status"], detail?: string) => {
    const s: AgentStep = { step, status, detail };
    steps.push(s);
    onProgress?.(s);
  };

  // Step 1: Fetch URL
  log("Fetching URL", "running");
  let page: Awaited<ReturnType<typeof fetchUrl>>;
  try {
    page = await fetchUrl(input.url);
    log("Fetching URL", "done", `"${page.title.slice(0, 60)}"`);
  } catch (e: any) {
    log("Fetching URL", "error", e.message);
    throw new Error(`Failed to fetch URL: ${e.message}`);
  }

  // Step 2: Extract key info
  log("Extracting key info", "running");
  const info = await extractKeyInfo(page, input.url);
  log("Extracting key info", "done", info.topic);

  // Step 3: Fetch trends (parallel with next step)
  log("Fetching India trends", "running");
  const trendsPromise = fetchTrends("IN");

  // Step 4: Generate hooks (while trends load)
  const trends = await trendsPromise;
  log("Fetching India trends", "done", `${trends.length} trends found`);

  log("Generating viral hooks", "running");
  const hooks = await generateHooks(info, trends, industry);
  const bestHook = hooks[0];
  log("Generating viral hooks", "done", `"${bestHook.slice(0, 60)}"`);

  // Step 5: Generate content for all platforms in parallel
  log("Generating platform content", "running", `${platforms.join(" + ")}`);
  const contentPromises = platforms.map(platform =>
    platform === "facebook"
      ? generateFacebookPost(info, bestHook, trends, language).then(c => ({ platform, content: c, format: "feed_post" as const }))
      : generateInstagramCarousel(info, bestHook, trends, language).then(c => ({ platform, content: c, format: "carousel" as const }))
  );
  const contents = await Promise.all(contentPromises);
  log("Generating platform content", "done");

  // Step 6: Generate images in parallel
  log("Generating images (Flux)", "running");
  const imagePromises = contents.map(({ platform, content }) => {
    const prompt = (content as any).imagePrompt || info.suggestedImageStyle;
    const aspect = platform === "instagram" ? "4:5" as const : "16:9" as const;
    return generateAndUploadImage(prompt, aspect, platform);
  });
  const imageUrls = await Promise.all(imagePromises);
  log("Generating images (Flux)", "done", imageUrls.filter(Boolean).length + " images created");

  // Step 7: Save drafts
  log("Saving drafts", "running");
  for (let i = 0; i < contents.length; i++) {
    const { platform, content, format } = contents[i];
    const mediaUrl = imageUrls[i];
    const title = (content as any).hook?.slice(0, 100) || info.topic.slice(0, 100);
    const hashtags = ((content as any).hashtags as string[] || []).join(" ");

    try {
      const result = await createContentPost(input.userId, {
        title,
        content: JSON.stringify(content),
        platform: platform as any,
        language,
        hashtags,
        status: "draft",
        mediaUrl,
        contentFormat: format,
      });
      const id = (result as any)[0]?.insertId ?? (result as any)?.insertId ?? 0;
      posts.push({ id, platform, title, mediaUrl });
      log(`Saved ${platform} draft`, "done", `ID: ${id}`);
    } catch (e: any) {
      log(`Saved ${platform} draft`, "error", e.message);
    }
  }

  return { posts, steps };
}
