import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const IMAGE_API_URL = process.env.IMAGE_API_URL ?? 'https://api.together.xyz';
const IMAGE_API_KEY = process.env.IMAGE_API_KEY ?? '';
const IMAGE_MODEL   = process.env.IMAGE_MODEL   ?? 'black-forest-labs/FLUX.1.1-pro';

const IS_FIREWORKS = IMAGE_API_URL.includes('fireworks.ai');

/**
 * Generate an image and return either:
 * - an HTTP URL (Together AI / OpenAI-compatible)
 * - a local file:// path (Fireworks — binary PNG response)
 */
export async function generateDallEImage(prompt: string, timeoutMs = 90_000): Promise<string> {
  if (!IMAGE_API_KEY) {
    throw new Error('IMAGE_API_KEY not configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    if (IS_FIREWORKS) {
      // Fireworks: /v1/image_generation/{model_id} → binary JPEG
      const modelPath = IMAGE_MODEL.startsWith('accounts/') ? IMAGE_MODEL : `accounts/fireworks/models/${IMAGE_MODEL}`;
      response = await fetch(
        `${IMAGE_API_URL.replace(/\/$/, '')}/v1/image_generation/${modelPath}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'image/jpeg',
            Authorization: `Bearer ${IMAGE_API_KEY}`,
          },
          body: JSON.stringify({
            prompt,
            aspect_ratio: '16:9',
            // flux-1-dev / pro benefit from more steps for fine detail & photorealism.
            // Default 32 (was 28) — small quality bump; override via IMAGE_STEPS env.
            num_inference_steps: IMAGE_MODEL.includes('schnell')
              ? 4
              : Number(process.env.IMAGE_STEPS ?? 32),
            // FLUX distilled models work best at guidance_scale 3.5 (not 7+)
            guidance_scale: IMAGE_MODEL.includes('schnell') ? 0 : 3.5,
          }),
          signal: controller.signal,
        }
      );
    } else {
      // OpenAI-compatible (Together AI etc.)
      response = await fetch(`${IMAGE_API_URL.replace(/\/$/, '')}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${IMAGE_API_KEY}`,
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt,
          n: 1,
          width: 1792,
          height: 1024,
        }),
        signal: controller.signal,
      });
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Image generation error: ${response.status} – ${err.slice(0, 200)}`);
  }

  if (IS_FIREWORKS) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) {
      // Binary PNG/JPEG — save to temp file and return file:// path
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
      const tmpPath = path.join(tmpdir(), `fw-img-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, buffer);
      return `file://${tmpPath}`;
    }
    // Fallback: maybe JSON with base64 (strip BOM if present)
    const rawText = await response.text();
    if (rawText.trim().startsWith('<')) {
      throw new Error(`Fireworks returned HTML (transient server error) — retry later`);
    }
    const data = JSON.parse(rawText.replace(/^\uFEFF/, '')) as any;
    const b64 = data?.data?.[0]?.b64_json ?? data?.images?.[0];
    if (b64) {
      const buffer = Buffer.from(b64, 'base64');
      const tmpPath = path.join(tmpdir(), `fw-img-${Date.now()}.png`);
      writeFileSync(tmpPath, buffer);
      return `file://${tmpPath}`;
    }
    throw new Error('Fireworks returned unknown image format');
  }

  const data = (await response.json()) as { data: { url: string; b64_json?: string }[] };
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('Image API returned no URL');
  return url;
}

/**
 * Generate an image via Google Gemini 2.5 Flash Image Preview (nano-banana).
 * Returns a `file://` path to a local PNG saved in tmpdir.
 *
 * Used as a fallback when FLUX (Fireworks) is unavailable, rate-limited,
 * or proxied through a misconfigured corporate proxy returning HTML.
 *
 * Requires GEMINI_API_KEY env. Free tier has generous quotas (typically
 * 1500 RPD for nano-banana — enough for several daily batches).
 */
export async function generateGeminiImage(prompt: string, timeoutMs = 90_000): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini image error: ${response.status} – ${err.slice(0, 200)}`);
  }

  const json: any = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const buffer = Buffer.from(inline.data, 'base64');
      const mime = inline.mimeType || inline.mime_type || 'image/png';
      const ext = mime.includes('jpeg') ? 'jpg' : 'png';
      const tmpPath = path.join(tmpdir(), `gemini-img-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, buffer);
      return `file://${tmpPath}`;
    }
  }
  throw new Error('Gemini returned no inline image data');
}

const AGY_BIN = '/Users/evgenijgrudev/.local/bin/agy';

/**
 * Generate an image via the local `agy` CLI (Antigravity / Gemini image gen).
 * Parses the markdown image output `![name](/absolute/path.png)` and returns
 * `file:///absolute/path.png`. Unlimited quota — uses the user's local auth.
 */
export function generateAgyImage(prompt: string, timeoutMs = 120_000): string {
  const output = execFileSync(AGY_BIN, ['-p', `Generate a high-quality photo: ${prompt}. Respond with the image only, no text.`], {
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  // Parse `![alt](/abs/path.ext)` from markdown output
  const match = output.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (!match) throw new Error(`agy returned no image path: ${output.slice(0, 200)}`);
  const imgPath = match[1];
  return `file://${imgPath}`;
}

/**
 * Try agy (local Gemini CLI, unlimited quota) first.
 * Fall back to Gemini REST API, then FLUX.
 */
export async function generateImageWithFallback(prompt: string): Promise<string> {
  // 1. agy — local Gemini CLI, no rate limits from REST API
  try {
    const result = generateAgyImage(prompt);
    console.log(`[ImgGen] agy generated: ${result.slice(-60)}`);
    return result;
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn(`[ImgGen] agy failed: ${msg.slice(0, 120)} — trying Gemini REST`);
  }
  // 2. Gemini REST API
  if (process.env.GEMINI_API_KEY) {
    try {
      return await generateGeminiImage(prompt);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn(`[ImgGen] Gemini failed: ${msg.slice(0, 120)} — falling back to FLUX`);
    }
  }
  // 3. FLUX via Fireworks
  return generateDallEImage(prompt);
}
