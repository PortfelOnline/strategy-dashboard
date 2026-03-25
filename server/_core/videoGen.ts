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
  pexelsApiKey: string;
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
    const scale = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920";
    // Aggressive Ken Burns: 25% zoom + horizontal drift left→right for cinematic energy
    const zoomStep = (0.25 / frames).toFixed(6);
    const kb = `zoompan=z='min(zoom+${zoomStep}\\,1.25)':x='iw/2-(iw/zoom/2)+(iw*0.08)*(zoom-1)/0.25':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30`;

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

    const vf = [scale, kb, ...overlayFilters].join(",");

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

// ── Stock video (Pexels + FFmpeg) ─────────────────────────────────────────────

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

    // 2. Fetch + process each Pexels clip
    const clipPaths: string[] = [];
    for (let i = 0; i < opts.sections.length; i++) {
      const section = opts.sections[i];
      const pexelsRes = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(section.visual.slice(0, 60))}&per_page=1&orientation=portrait`,
        { headers: { Authorization: opts.pexelsApiKey } }
      );
      const pexelsData: any = await pexelsRes.json();
      const videoFiles: any[] = pexelsData?.videos?.[0]?.video_files ?? [];
      const file = videoFiles.find((f: any) => f.quality === "hd") ?? videoFiles[0];

      const clipOut = path.join(tmpDir, `clip_${i}.mp4`);

      if (!file?.link) {
        // Fallback: black clip
        execFileSync(FFMPEG, [
          "-y", "-f", "lavfi",
          "-i", `color=black:size=1080x1920:rate=30`,
          "-t", clipDuration.toFixed(1),
          "-c:v", "libx264",
          clipOut,
        ], { stdio: "pipe" });
      } else {
        const clipRes = await fetch(file.link);
        const rawClip = path.join(tmpDir, `raw_${i}.mp4`);
        fs.writeFileSync(rawClip, Buffer.from(await clipRes.arrayBuffer()));
        const label = escapeDrawtext(section.label);
        execFileSync(FFMPEG, [
          "-y", "-i", rawClip,
          "-t", clipDuration.toFixed(1),
          "-vf", isDrawtextSupported()
            ? `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,drawtext=text='${label}':fontsize=48:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.85`
            : `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`,
          "-c:v", "libx264", "-preset", "fast", "-crf", "24", "-an",
          clipOut,
        ], { stdio: "pipe", timeout: 60_000 });
      }
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
