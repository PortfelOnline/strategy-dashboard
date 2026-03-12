import { GoogleGenAI, PersonGeneration } from "@google/genai";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

// ── Image generation (Imagen 3) ───────────────────────────────────────────────

export async function generateGeminiImage(
  prompt: string,
  aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" = "1:1"
): Promise<{ b64: string; mimeType: string }> {
  const ai = getClient();

  const response = await ai.models.generateImages({
    model: "imagen-3.0-generate-001",
    prompt,
    config: {
      numberOfImages: 1,
      aspectRatio,
      personGeneration: PersonGeneration.ALLOW_ADULT,
    },
  });

  const img = response.generatedImages?.[0]?.image;
  if (!img?.imageBytes) throw new Error("Imagen 3 returned no image");

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

const INDUSTRY_VISUAL: Record<string, string> = {
  retail: "vibrant Indian clothing boutique with colorful kurtas and sarees on racks, warm golden lighting, modern store interior",
  real_estate: "modern Indian residential apartment exterior with blue sky, clean architecture, city backdrop",
  restaurant: "Indian restaurant with beautifully plated food, warm ambient lighting, clean tableware",
  ecommerce: "hands holding smartphone showing online shopping interface, Indian home setting, soft natural light",
  coaching: "Indian student at desk with open books and laptop, bright study room, focused expression",
  services: "Indian service professional in neat uniform with tools, outdoor residential setting, confident posture",
};

const FORMAT_ASPECT: Record<string, "1:1" | "9:16" | "16:9" | "4:5"> = {
  carousel: "1:1",
  feed_post: "1:1",
  story: "9:16",
  reel: "9:16",
};

export function buildVisualPrompt(
  industry: string,
  format: string,
  hook: string
): { prompt: string; aspectRatio: "1:1" | "9:16" | "16:9" | "4:5" } {
  const setting = INDUSTRY_VISUAL[industry] ?? "Indian small business owner working on smartphone";
  const aspectRatio = FORMAT_ASPECT[format] ?? "1:1";

  const prompt = [
    `Commercial social media photo for an Indian small business marketing campaign.`,
    `Scene: ${setting}.`,
    `Mood: Aspirational, warm, confident. Modern Indian entrepreneurial aesthetic.`,
    `Lighting: Natural daylight or warm indoor lighting. Clean, professional composition.`,
    `Color palette: Deep blues and warm orange accents.`,
    `Style: Photorealistic, high-resolution editorial photography. No text, no overlays, no logos.`,
    `The image should visually complement this message: "${hook.slice(0, 120)}".`,
    `Do NOT include any text, watermarks, or graphics in the image.`,
  ].join(" ");

  return { prompt, aspectRatio };
}
