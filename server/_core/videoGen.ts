import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ENV } from "./env";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const OUT_DIR = path.join(process.cwd(), "public", "uploads");

// Check once if drawtext filter is available (requires libfreetype)
let _drawtextSupported: boolean | null = null;
function isDrawtextSupported(): boolean {
  if (_drawtextSupported === null) {
    try {
      const out = execFileSync(FFMPEG, ["-filters"], { encoding: "utf8", timeout: 5000 });
      _drawtextSupported = out.includes("drawtext");
    } catch {
      _drawtextSupported = false;
    }
  }
  return _drawtextSupported;
}

interface SlideshowVideoOptions {
  imageUrls: string[];
  textOverlays: string[];
  voiceover: string;
  outputFilename: string;
}

interface StockVideoOptions {
  sections: Array<{ label: string; visual: string; script: string }>;
  textOverlays: string[];
  voiceover: string;
  outputFilename: string;
}

// ── TTS via Gemini 2.5 Flash ──────────────────────────────────────────────────
// Returns raw PCM (L16, 24kHz mono) which FFmpeg converts to MP3

async function generateTTSAudio(text: string, outputPath: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured for TTS");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Say: ${text.slice(0, 4990)}` }], role: "user" }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Puck" }, // upbeat male, good for Indian market reels
            },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    // Fallback to OpenAI TTS if Gemini fails
    console.warn(`[TTS] Gemini failed (${res.status}), falling back to OpenAI TTS: ${err.slice(0, 200)}`);
    await generateTTSAudioOpenAI(text, outputPath);
    return;
  }

  const data: any = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.[0];
  if (!part?.inlineData?.data) {
    console.warn("[TTS] Gemini returned no audio data, falling back to OpenAI TTS");
    await generateTTSAudioOpenAI(text, outputPath);
    return;
  }

  // Gemini returns raw PCM L16 24kHz mono — pipe through FFmpeg to get MP3
  const pcmBuf = Buffer.from(part.inlineData.data, "base64");
  const pcmPath = outputPath.replace(/\.mp3$/, ".pcm");
  fs.writeFileSync(pcmPath, pcmBuf);

  execFileSync(FFMPEG, [
    "-y",
    "-f", "s16le",      // signed 16-bit little-endian PCM
    "-ar", "24000",     // 24kHz sample rate
    "-ac", "1",         // mono
    "-i", pcmPath,
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    outputPath,
  ], { stdio: "pipe", timeout: 30_000 });

  fs.unlinkSync(pcmPath);
}

// Fallback: OpenAI TTS
async function generateTTSAudioOpenAI(text: string, outputPath: string): Promise<void> {
  const apiKey = ENV.forgeApiKey;
  if (!apiKey) throw new Error("No TTS API key available");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "tts-1", voice: "nova", input: text.slice(0, 4000), response_format: "mp3" }),
  });

  if (!res.ok) throw new Error(`OpenAI TTS failed: ${res.status}`);
  fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
}

// ── Get audio duration ────────────────────────────────────────────────────────

function getAudioDuration(audioPath: string): number {
  try {
    const out = execFileSync(FFPROBE, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ], { encoding: "utf8", timeout: 10_000 }).trim();
    return parseFloat(out) || 20;
  } catch {
    return 20;
  }
}

// ── Download image ────────────────────────────────────────────────────────────

async function resolveImagePath(url: string, tmpDir: string, idx: number): Promise<string> {
  if (url.startsWith("/uploads/")) {
    return path.join(process.cwd(), "public", url);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const imgPath = path.join(tmpDir, `img_${idx}.jpg`);
  fs.writeFileSync(imgPath, buf);
  return imgPath;
}

// ── Escape text for FFmpeg drawtext ──────────────────────────────────────────

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

// ── Slideshow video ───────────────────────────────────────────────────────────

export async function generateSlideshowVideo(opts: SlideshowVideoOptions): Promise<string> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = path.join(OUT_DIR, `tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const outPath = path.join(OUT_DIR, opts.outputFilename);
  const audioPath = path.join(tmpDir, "voiceover.mp3");

  try {
    // 1. TTS
    await generateTTSAudio(opts.voiceover, audioPath);
    const audioDuration = getAudioDuration(audioPath);
    const totalDuration = audioDuration + 0.5;
    const frames = Math.ceil(totalDuration * 30);

    // 2. Resolve image
    const imgPath = await resolveImagePath(opts.imageUrls[0], tmpDir, 0);

    // 3. Build vf chain
    // Scale to 200% for more dramatic pan — fast crop-based Ken Burns
    const scaleLarge = "scale=2160:3840:force_original_aspect_ratio=increase";
    const dur = totalDuration.toFixed(2);
    // Start top-left, end bottom-right — full diagonal sweep for maximum energy
    const kb = `fps=30,${scaleLarge},crop=1080:1920:'(iw-out_w)*min(t/${dur}\\,1)':'(ih-out_h)*min(t/${dur}\\,1)*0.6'`;

    // Text overlays — evenly spaced (skipped if drawtext/libfreetype not available)
    const overlayFilters: string[] = [];
    if (opts.textOverlays.length > 0 && isDrawtextSupported()) {
      const perSlide = totalDuration / opts.textOverlays.length;
      opts.textOverlays.forEach((text, i) => {
        const t0 = (i * perSlide).toFixed(1);
        const t1 = ((i + 1) * perSlide - 0.2).toFixed(1);
        const safe = escapeDrawtext(text.slice(0, 55));
        overlayFilters.push(
          `drawtext=text='${safe}':fontsize=50:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:box=1:boxcolor=black@0.4:boxborderw=10:x=(w-text_w)/2:y=h*0.74:enable='between(t\\,${t0}\\,${t1})'`
        );
      });
    }

    const vf = [kb, ...overlayFilters].join(",");

    // 4. FFmpeg assemble
    execFileSync(FFMPEG, [
      "-y",
      "-loop", "1",
      "-t", totalDuration.toFixed(2),
      "-i", imgPath,
      "-i", audioPath,
      "-vf", vf,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "24",
      "-c:a", "aac",
      "-b:a", "128k",
      "-pix_fmt", "yuv420p",
      "-t", totalDuration.toFixed(2),
      "-shortest",
      outPath,
    ], { stdio: "pipe", timeout: 180_000 });

    return `/uploads/${opts.outputFilename}`;
  } finally {
    try { execFileSync("rm", ["-rf", tmpDir]); } catch { /* ignore */ }
  }
}

// ── AI Image Slideshow (DALL-E per section) ────────────────────────────────────
// Generates one DALL-E image per reel section — Indian context, AI-agent narrative

// Narrative arc: scene 0 = problem, scene 1 = transformation, scene 2 = triumph
const SECTION_PROMPTS = [
  // Scene 0 — overwhelmed owner, chaos, missed opportunities
  [
    `Cinematic vertical photo, Indian male small business owner (30s, South Asian) slumped at a shop counter,`,
    `head in hands, expression of exhaustion and stress. Around him: a cluttered counter, ringing phone face-down,`,
    `unhappy customers in background waiting. Warm but chaotic shop interior (jewellery or textile store).`,
    `Shallow depth of field, moody dramatic lighting. Pure photorealistic, absolutely NO text anywhere in the image.`,
  ],
  // Scene 1 — glowing phone, magical transformation, AI energy
  [
    `Cinematic vertical photo, a modern smartphone levitating slightly above an open palm of Indian hands,`,
    `screen face-down showing only a soft pulsing green glow radiating outward — magical energy, technology at work.`,
    `Blurred warm Indian shop background with bokeh lights. Abstract sense of automation and intelligence.`,
    `Shallow focus, dramatic cinematic lighting. Pure photorealistic, absolutely NO text or symbols anywhere.`,
  ],
  // Scene 2 — confident owner, thriving shop, success
  [
    `Cinematic vertical photo, Indian male small business owner (30s, South Asian) standing tall and smiling confidently,`,
    `arms crossed, in a busy prosperous shop with happy customers in background. Bright warm golden lighting,`,
    `clean organized counter. Expression of calm control and success. Professional commercial photography style.`,
    `Shallow depth of field. Pure photorealistic, absolutely NO text anywhere in the image.`,
  ],
];

async function generateSectionImage(section: { label: string; visual: string; script: string }, tmpDir: string, idx: number): Promise<string> {
  // Use narrative arc prompts (0=problem, 1=AI transformation, 2=triumph), cycling for extra sections
  const promptLines = SECTION_PROMPTS[idx % SECTION_PROMPTS.length];
  const prompt = promptLines.join(" ");

  // DALL-E 3 via OpenAI — portrait 1024×1792 ≈ 9:16
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("No OpenAI API key for image generation");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "dall-e-3", prompt: prompt.slice(0, 1000), n: 1, size: "1024x1792", response_format: "b64_json" }),
  });
  if (!res.ok) throw new Error(`DALL-E 3 failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

  const data: any = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("DALL-E 3 returned no image");

  const imgPath = path.join(tmpDir, `section_${idx}.jpg`);
  fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
  return imgPath;
}

export async function generateStockVideo(opts: StockVideoOptions): Promise<string> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmpDir = path.join(OUT_DIR, `tmp_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const outPath = path.join(OUT_DIR, opts.outputFilename);
  const audioPath = path.join(tmpDir, "voiceover.mp3");

  try {
    // 1. TTS
    await generateTTSAudio(opts.voiceover, audioPath);
    const audioDuration = getAudioDuration(audioPath);
    const clipDuration = audioDuration / Math.max(opts.sections.length, 1);

    // 2. Generate DALL-E image per section + encode as clip with pan motion
    const clipPaths: string[] = [];
    for (let i = 0; i < opts.sections.length; i++) {
      const section = opts.sections[i];
      const clipOut = path.join(tmpDir, `clip_${i}.mp4`);

      let imgPath: string;
      try {
        imgPath = await generateSectionImage(section, tmpDir, i);
      } catch (err) {
        console.warn(`[videoGen] DALL-E failed for section ${i}, using black: ${err}`);
        execFileSync(FFMPEG, [
          "-y", "-f", "lavfi", "-i", `color=black:size=1080x1920:rate=30`,
          "-t", clipDuration.toFixed(1), "-c:v", "libx264", clipOut,
        ], { stdio: "pipe" });
        clipPaths.push(clipOut);
        continue;
      }

      // Dynamic pan/zoom — 200% scale, alternating directions per section for cinematic energy
      const dur = clipDuration.toFixed(2);
      // Even sections: left→right + top→bottom drift
      // Odd sections: right→left + bottom→top drift
      const xExpr = i % 2 === 0
        ? `(iw-out_w)*min(t/${dur}\\,1)`
        : `(iw-out_w)*(1-min(t/${dur}\\,1))`;
      const yExpr = i % 2 === 0
        ? `(ih-out_h)*min(t/${dur}\\,1)*0.6`
        : `(ih-out_h)*(1-min(t/${dur}\\,1)*0.6)`;
      const panVf = `fps=30,scale=2160:3840:force_original_aspect_ratio=increase,crop=1080:1920:'${xExpr}':'${yExpr}'`;
      execFileSync(FFMPEG, [
        "-y", "-loop", "1", "-t", dur,
        "-i", imgPath,
        "-vf", panVf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "24", "-an", "-pix_fmt", "yuv420p",
        clipOut,
      ], { stdio: "pipe", timeout: 60_000 });
      clipPaths.push(clipOut);
    }

    // 3. Concat
    const concatList = path.join(tmpDir, "concat.txt");
    fs.writeFileSync(concatList, clipPaths.map(p => `file '${p}'`).join("\n"));
    const concatVideo = path.join(tmpDir, "concat.mp4");
    execFileSync(FFMPEG, [
      "-y", "-f", "concat", "-safe", "0",
      "-i", concatList,
      "-c", "copy",
      concatVideo,
    ], { stdio: "pipe" });

    // 4. Add audio
    execFileSync(FFMPEG, [
      "-y", "-i", concatVideo, "-i", audioPath,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-shortest", outPath,
    ], { stdio: "pipe", timeout: 60_000 });

    return `/uploads/${opts.outputFilename}`;
  } finally {
    try { execFileSync("rm", ["-rf", tmpDir]); } catch { /* ignore */ }
  }
}
