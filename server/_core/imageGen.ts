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
            aspect_ratio: '1:1',
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
          width: 1024,
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

/**
 * Generate an image via Pollinations (https://pollinations.ai) — бесплатно, без API-ключа.
 * Возвращает file:// путь к локальному файлу. Модель/размер настраиваются через env
 * POLLINATIONS_MODEL/POLLINATIONS_WIDTH/POLLINATIONS_HEIGHT.
 */
// Pollinations: СТРОГО 1 запрос в полёте на IP (concurrency=1; иначе "Queue full for IP" 429).
// Генерация занимает 17–45с (замерено 2026-06-26). Сериализуем по ЗАВЕРШЕНИЮ — следующий
// запрос стартует только ПОСЛЕ возврата предыдущего (release в finally), а не по таймеру.
// Конкурентные вызовы (Promise.allSettled на N картинок) выстраиваются в очередь.
let _pollTail: Promise<void> = Promise.resolve();
function _acquirePollinationsSlot(): Promise<() => void> {
  let release!: () => void;
  const done = new Promise<void>((r) => (release = r));
  const prev = _pollTail;
  _pollTail = prev.then(() => done);
  return prev.then(() => release);
}
// Pollinations 403-ит дефолтный Node/Python User-Agent → шлём браузерный.
const POLL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0 Safari/537.36';

export async function generatePollinationsImage(prompt: string, timeoutMs = 120_000): Promise<string> {
  const release = await _acquirePollinationsSlot();
  try {
    const model = process.env.POLLINATIONS_MODEL ?? 'flux';
    const width = Number(process.env.POLLINATIONS_WIDTH ?? 1024);
    const height = Number(process.env.POLLINATIONS_HEIGHT ?? 1024);
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const base = process.env.POLLINATIONS_URL ?? 'https://image.pollinations.ai';
    // enhance=true прогоняет промпт через LLM-улучшайзер Pollinations (богаче детализация).
    // Включается POLLINATIONS_ENHANCE=1 (по умолчанию выкл — может слегка дрейфовать в сторону
    // «западной» эстетики, что для русского блога нежелательно; включать осознанно).
    const enhance = process.env.POLLINATIONS_ENHANCE === '1' ? '&enhance=true' : '';
    const url =
      `${base.replace(/\/$/, '')}/prompt/${encodeURIComponent(prompt)}` +
      `?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true${enhance}`;

    // Retry-on-429/403 как страховка (чужая нагрузка на IP / транзиентный блок UA).
    let response: Response;
    const maxAttempts = 6;
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': POLL_UA } });
      } finally {
        clearTimeout(timer);
      }
      if ((response.status === 429 || response.status === 403) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(3000 * (attempt + 1), 15000) + Math.floor(Math.random() * 2000)));
        continue;
      }
      break;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Pollinations error: ${response.status} - ${err.slice(0, 200)}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      const body = await response.text();
      throw new Error(`Pollinations returned non-image (${contentType}): ${body.slice(0, 120)}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const tmpPath = path.join(tmpdir(), `poll-img-${Date.now()}.${ext}`);
    writeFileSync(tmpPath, buffer);
    return `file://${tmpPath}`;
  } finally {
    release();
  }
}

/**
 * Image provider chain: Pollinations first (бесплатно, без ключа — основной генератор),
 * затем Gemini (agy CLI → Gemini REST) и FLUX (Fireworks) как запасные, если они
 * сконфигурированы. Pollinations отключается через POLLINATIONS_DISABLED=1.
 */
export async function generateImageWithFallback(prompt: string): Promise<string> {
  const errors: string[] = [];

  // 1. Pollinations (primary — бесплатно, без API-ключа)
  if (process.env.POLLINATIONS_DISABLED !== '1') {
    try {
      const result = await generatePollinationsImage(prompt);
      console.log(`[ImgGen] Pollinations generated: ${result.slice(-60)}`);
      return result;
    } catch (e: any) {
      const msg = (e?.message || String(e)).slice(0, 120);
      errors.push(`pollinations: ${msg}`);
      console.warn(`[ImgGen] Pollinations failed: ${msg} — trying Gemini/FLUX`);
    }
  }

  // 2. Gemini via agy CLI
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
