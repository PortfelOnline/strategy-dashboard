import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

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

  // Gemini API гео-блокирует часть локаций (FAILED_PRECONDITION "User location is not
  // supported"). GEMINI_PROXY (HTTP-прокси в поддерживаемом регионе, напр. EU-сервер n)
  // направляет запрос через разрешённый IP.
  const fetchOpts: any = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    signal: controller.signal,
  };
  if (process.env.GEMINI_PROXY) {
    const { ProxyAgent } = await import('undici');
    fetchOpts.dispatcher = new ProxyAgent(process.env.GEMINI_PROXY);
  }

  let response: Response;
  try {
    response = await fetch(url, fetchOpts);
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

/** Image provider chain: Flow/Gemini bridge first, then Gemini REST. */
export async function generateImageWithFallback(prompt: string): Promise<string> {
  const errors: string[] = [];

  // 1. Flow/Gemini bridge via agy CLI
  try {
    const result = generateAgyImage(prompt);
    console.log(`[ImgGen] agy (Gemini) generated: ${result.slice(-60)}`);
    return result;
  } catch (e: any) {
    const msg = (e?.message || String(e)).slice(0, 120);
    errors.push(`agy: ${msg}`);
    console.warn(`[ImgGen] agy (Gemini) failed: ${msg} — trying Gemini REST`);
  }

  // 2. Gemini REST (separate key/quota from Flow bridge)
  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await generateGeminiImage(prompt);
      console.log('[ImgGen] Gemini REST generated');
      return result;
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 120);
      errors.push(`gemini-rest: ${msg}`);
      console.warn(`[ImgGen] Gemini REST failed: ${msg}`);
    }
  }

  throw new Error(`No Flow/Gemini image provider available — ${errors.join(' | ')}`);
}
