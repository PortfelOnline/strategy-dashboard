/**
 * Video generation stubs.
 * Full implementation requires FFmpeg + Pexels API.
 * Returns placeholder URLs for now.
 */

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

export async function generateSlideshowVideo(opts: SlideshowVideoOptions): Promise<string> {
  // TODO: implement FFmpeg slideshow from images + text overlays + TTS voiceover
  throw new Error("Slideshow video generation not yet implemented. Use Content Generator to create the reel script, then record manually.");
}

export async function generateStockVideo(opts: StockVideoOptions): Promise<string> {
  // TODO: implement Pexels stock footage fetch + FFmpeg assembly + TTS voiceover
  throw new Error("Stock video generation not yet implemented. Use Content Generator to create the reel script, then use a video tool like CapCut or Canva.");
}
