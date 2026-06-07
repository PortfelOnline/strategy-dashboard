import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const IMAGE_API_URL = process.env.IMAGE_API_URL ?? 'https://api.together.xyz';
const IMAGE_API_KEY = process.env.IMAGE_API_KEY ?? '';
const IMAGE_MODEL = process.env.IMAGE_MODEL ?? 'black-forest-labs/FLUX.1.1-pro';

const IS_FIREWORKS = IMAGE_API_URL.includes('fireworks.ai');

/**
 * Generate an image and return either:
 * - an HTTP URL (Together AI / OpenAI-compatible)
 * - a local file:// path (Fireworks binary response)
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
      const modelPath = IMAGE_MODEL.startsWith('accounts/') ? IMAGE_MODEL : `accounts/fireworks/models/${IMAGE_MODEL}`;
      response = await fetch(
        `${IMAGE_API_URL.replace(/\/$/, '')}/v1/workflows/${modelPath}/text_to_image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'image/jpeg',
            Authorization: `Bearer ${IMAGE_API_KEY}`,
          },
          body: JSON.stringify({
            prompt,
            aspect_ratio: '16:9',
            num_inference_steps: IMAGE_MODEL.includes('schnell')
              ? 4
              : Number(process.env.IMAGE_STEPS ?? 32),
            guidance_scale: IMAGE_MODEL.includes('schnell') ? 0 : 3.5,
          }),
          signal: controller.signal,
        },
      );
    } else {
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
    throw new Error(`Image generation error: ${response.status} - ${err.slice(0, 200)}`);
  }

  if (IS_FIREWORKS) {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
      const tmpPath = path.join(tmpdir(), `fw-img-${Date.now()}.${ext}`);
      writeFileSync(tmpPath, buffer);
      return `file://${tmpPath}`;
    }

    const rawText = await response.text();
    if (rawText.trim().startsWith('<')) {
      throw new Error('Fireworks returned HTML (transient server error) - retry later');
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
 * Generate an image via Google Gemini image generation (nano-banana).
 * Returns a file:// path to a local image saved in tmpdir.
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
    throw new Error(`Gemini image error: ${response.status} - ${err.slice(0, 200)}`);
  }

  const json: any = await response.json();
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData || p.inline_data;
    if (inline?.data) {
      const buffer = Buffer.from(inline.data, 'base64');
      const mime = inline.mimeType || inline.mime_type || 'image/png';
      const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
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
 * Parses markdown image output and returns file:///absolute/path.
 */
export function generateAgyImage(prompt: string, timeoutMs = 120_000): string {
  const output = execFileSync(
    AGY_BIN,
    ['-p', `Generate a high-quality photo: ${prompt}. Respond with the image only, no text.`],
    { timeout: timeoutMs, encoding: 'utf8' },
  );
  const match = output.match(/!\[[^\]]*\]\(([^)]+)\)/);
  if (!match) throw new Error(`agy returned no image path: ${output.slice(0, 200)}`);
  return `file://${match[1]}`;
}

/**
 * Image provider chain: Gemini first (agy CLI → Gemini REST), then FLUX (Fireworks)
 * as a fallback when Gemini limits/quota are exhausted. Keeps using free Gemini quota
 * while it lasts, and degrades to cheap-but-reliable FLUX schnell instead of failing.
 */
export async function generateImageWithFallback(prompt: string): Promise<string> {
  const errors: string[] = [];

  // 1. Gemini via agy CLI (primary)
  try {
    const result = generateAgyImage(prompt);
    console.log(`[ImgGen] agy (Gemini) generated: ${result.slice(-60)}`);
    return result;
  } catch (e: any) {
    const msg = (e?.message || String(e)).slice(0, 120);
    errors.push(`agy: ${msg}`);
    console.warn(`[ImgGen] agy (Gemini) failed: ${msg} — trying Gemini REST`);
  }

  // 2. Gemini REST (separate key/quota from agy)
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await generateGeminiImage(prompt);
      console.log('[ImgGen] Gemini REST generated');
      return result;
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 120);
      errors.push(`gemini-rest: ${msg}`);
      console.warn(`[ImgGen] Gemini REST failed: ${msg} — falling back to FLUX`);
    }
  }

  // 3. FLUX on Fireworks (fallback when Gemini limits are exhausted)
  if (process.env.IMAGE_API_KEY) {
    console.log('[ImgGen] Falling back to FLUX (Fireworks)');
    return generateDallEImage(prompt);
  }

  throw new Error(`No image provider available — ${errors.join(' | ')}; IMAGE_API_KEY (FLUX) not configured`);
}
