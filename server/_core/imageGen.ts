import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

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
      // Fireworks: /v1/workflows/{model_id}/text_to_image → binary JPEG
      const modelPath = IMAGE_MODEL.startsWith('accounts/') ? IMAGE_MODEL : `accounts/fireworks/models/${IMAGE_MODEL}`;
      response = await fetch(
        `${IMAGE_API_URL.replace(/\/$/, '')}/v1/workflows/${modelPath}/text_to_image`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'image/jpeg',
            Authorization: `Bearer ${IMAGE_API_KEY}`,
          },
          body: JSON.stringify({
            prompt,
            aspect_ratio: '1:1',
            guidance_scale: 3.5,
            num_inference_steps: 4,
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
