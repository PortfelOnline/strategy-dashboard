import { GoogleGenAI, PersonGeneration } from "@google/genai";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

// ── Image generation (Imagen 4 — requires paid Gemini plan) ──────────────────

export async function generateGeminiImage(
  prompt: string,
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" = "1:1"
): Promise<{ b64: string; mimeType: string }> {
  const ai = getClient();

  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio,
      personGeneration: PersonGeneration.ALLOW_ADULT,
    },
  });

  const img = response.generatedImages?.[0]?.image;
  if (!img?.imageBytes) throw new Error("Imagen returned no image");

  return { b64: img.imageBytes, mimeType: "image/jpeg" };
}

// ── Video generation (Veo 2) ──────────────────────────────────────────────────

const VEO_POLL_INTERVAL_MS = 5_000;
const VEO_TIMEOUT_MS = 180_000; // 3 min max wait

export async function generateVeoVideo(
  prompt: string,
  aspectRatio: "9:16" | "16:9" = "9:16",
  durationSeconds: number = 8
): Promise<{ b64: string; mimeType: string }> {
  const ai = getClient();

  let op = await (ai.models as any).generateVideos({
    model: "veo-2.0-generate-001",
    prompt,
    config: { aspectRatio, durationSeconds },
  });

  const deadline = Date.now() + VEO_TIMEOUT_MS;

  while (!op.done) {
    if (Date.now() > deadline) throw new Error("Veo 2 generation timed out (3 min)");
    await new Promise((r) => setTimeout(r, VEO_POLL_INTERVAL_MS));
    op = await (ai.operations as any).getVideosOperation({ operation: op });
  }

  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video?.videoBytes) throw new Error("Veo 2 returned no video");

  return { b64: video.videoBytes, mimeType: "video/mp4" };
}

// ── Visual prompt builder ─────────────────────────────────────────────────────

// ── DALL-E 3 image generation (OpenAI) ───────────────────────────────────────

export async function generateDalleImage(
  prompt: string,
  size: "1024x1024" | "1792x1024" | "1024x1792" = "1792x1024"
): Promise<{ b64: string; mimeType: string }> {
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!apiKey) throw new Error("BUILT_IN_FORGE_API_KEY is not configured");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size, quality: "hd", response_format: "b64_json" }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DALL-E 3 error ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("DALL-E 3 returned no image");

  return { b64, mimeType: "image/jpeg" };
}

// ── Visual prompt builder (competitor-inspired styles) ────────────────────────

// Proven ad visual styles based on top Indian proptech competitors
// (Wati, Privyr, Interakt, Gallabox): WhatsApp mockups + agent scenarios outperform
// generic property photos in conversion for AI-agent / automation products.
const INDUSTRY_VISUAL: Record<string, string> = {
  real_estate: "Split-scene divided by a clean vertical glowing line down the center. LEFT HALF — Indian male real estate agent in his 30s in a formal suit, slumped forward asleep at his office desk, head resting on his arms, eyes shut, ZZZ floating above him, closed laptop on desk, property floor plans scattered, dim moody lighting, luxury apartment building photos pinned to the wall behind him — ONLY ONE PERSON in this panel. RIGHT HALF — the same desk but empty of people: an open laptop glowing with a WhatsApp chat interface showing green and grey chat bubbles auto-populating (blank rounded shapes, no readable text), a smartphone beside it showing incoming notification glow, city skyline with luxury residential towers visible through a window in the background, bright hopeful lighting. Photorealistic commercial advertising photo. NO text, NO words, NO letters anywhere in the image.",
  retail: "Split-scene divided by a clean vertical line. LEFT HALF — Indian shop owner in his 40s sitting behind counter, head in hands, surrounded by empty shelves, worried expression, late evening. RIGHT HALF — same shop owner smiling broadly, arms crossed proudly, shelves full, cash register glowing, vibrant daylight. Photorealistic commercial advertising photo.",
  restaurant: "Split-scene divided by a clean vertical line. LEFT HALF — Indian restaurant owner in chef apron standing in empty dining room, looking at his watch anxiously, closing time, chairs up on tables. RIGHT HALF — same restaurant packed full of happy Indian diners, owner smiling confidently near the entrance. Photorealistic commercial advertising photo.",
  ecommerce: "Split-scene divided by a clean vertical line. LEFT HALF — young Indian woman seller sitting at desk overwhelmed, staring at laptop screen, stacks of unshipped packages behind her, stressed expression. RIGHT HALF — same woman relaxed and happy, laptop glowing, packages neatly organized, smiling at camera. Photorealistic commercial advertising photo.",
  coaching: "Split-scene divided by a clean vertical line. LEFT HALF — Indian male tutor or coach sitting alone in empty classroom at night, textbooks piled up, looking discouraged. RIGHT HALF — same tutor teaching enthusiastically to a group of engaged Indian students, bright modern classroom. Photorealistic commercial advertising photo.",
  services: "Split-scene divided by a clean vertical line. LEFT HALF — Indian plumber or electrician in work clothes sitting on curb outside, tool bag beside him, looking at silent phone, expression of frustration. RIGHT HALF — same man busy working in a home, tools in hand, smiling confidently while homeowner gives thumbs up in background. Photorealistic commercial advertising photo.",
};

const DALLE_SIZE: Record<string, "1792x1024" | "1024x1024" | "1024x1792"> = {
  carousel: "1024x1024",
  feed_post: "1792x1024",
  story: "1024x1792",
  reel: "1024x1792",
};

export function buildVisualPrompt(
  industry: string,
  format: string,
  hook: string
): { prompt: string; aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" } {
  const baseScene = INDUSTRY_VISUAL[industry] ?? "Split-scene: Indian small business owner missing WhatsApp messages at night vs. AI bot instantly replying to all of them.";
  const aspectRatio = (format === "story" || format === "reel") ? "9:16" : "1:1";

  // Use hook text to add specific scene context — makes the image match the post content
  const cleanHook = hook.replace(/[#*_~`]/g, '').trim().slice(0, 120);
  const hookContext = cleanHook
    ? `The emotional moment being depicted relates to: "${cleanHook}". Adapt the scene to reflect this specific scenario — time of day, mood, and setting should match this context.`
    : '';

  const prompt = [
    baseScene,
    hookContext,
    `Mood: High-contrast emotional storytelling. Problem vs solution in one frame.`,
    `Style: Photorealistic, high-resolution commercial advertising photo.`,
    `CRITICAL: Absolutely NO text, NO letters, NO words, NO numbers, NO signs anywhere in the entire image. Chat bubbles on the phone screen must be completely empty colored shapes with zero readable content inside them. No watermarks, no logos, no captions, no UI labels.`,
  ].filter(Boolean).join(" ");

  return { prompt, aspectRatio };
}

export function buildVisualDalleSize(format: string): "1792x1024" | "1024x1024" | "1024x1792" {
  return DALLE_SIZE[format] ?? "1792x1024";
}

/**
 * Use LLM to generate a highly specific, context-aware DALL-E prompt
 * based on the full post content — hook, paragraphs, industry, and product details.
 */
export async function generateVisualPromptWithLLM(
  industry: string,
  format: string,
  hook: string,
  postContent?: string
): Promise<{ prompt: string; aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" }> {
  const aspectRatio = (format === "story" || format === "reel") ? "9:16" : "1:1";
  const orientation = (format === "story" || format === "reel") ? "vertical 9:16" : "horizontal 16:9";

  // Parse post content if JSON
  let fullText = hook;
  if (postContent) {
    try {
      const parsed = JSON.parse(postContent);
      const parts: string[] = [];
      if (parsed.hook) parts.push(parsed.hook);
      if (parsed.paragraphs?.length) parts.push(...parsed.paragraphs);
      if (parsed.cta) parts.push(parsed.cta);
      fullText = parts.join(" ") || hook;
    } catch {
      fullText = postContent.slice(0, 500);
    }
  }

  const { invokeLLM } = await import("./llm");
  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a professional advertising art director specializing in photorealistic social media visuals for Indian small business owners.
Your job: write a precise DALL-E image generation prompt.

Rules:
- Scene must be photorealistic, commercial-quality, emotionally compelling
- Must feature Indian people, Indian setting, Indian context
- Use a split-scene (before/after, problem/solution) format UNLESS the post is about a specific night-time or single-moment scenario — then use a single emotionally powerful scene
- Capture the exact TIME OF DAY, MOOD, and PRODUCT/SERVICE from the post
- NEVER include any text, letters, words, numbers, signs, logos, or watermarks in the image
- Orientation: ${orientation}
- Output ONLY the prompt text. No explanation, no JSON, just the prompt.`
      },
      {
        role: "user",
        content: `Industry: ${industry}
Post content: "${fullText}"

Write a specific DALL-E 3 prompt for this post's image. Make it match the exact scenario, product, time of day, and emotional moment described in the post.`
      }
    ],
    maxTokens: 400,
  });

  const llmPrompt = (result.choices[0]?.message?.content as string ?? "").trim();

  // Append absolute no-text rule
  const finalPrompt = llmPrompt
    + " CRITICAL: Absolutely NO text, NO letters, NO words, NO numbers, NO signs anywhere in the image. No watermarks. Photorealistic commercial advertising photo.";

  return { prompt: finalPrompt, aspectRatio };
}
