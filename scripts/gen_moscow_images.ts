import 'dotenv/config';
import { generateDallEImage } from '../server/_core/imageGen';
import { copyFileSync } from 'fs';

const SLUG = 'publichnaya-kadastrovaya-karta-moskvy';
const prompts = [
  'Aerial satellite view of Moscow city blocks with glowing cadastral boundary lines overlaid on rooftops and land parcels, deep blue night sky, golden property outlines, photorealistic, no text, no labels',
  'Official document and digital cadastral map on modern desk with laptop showing Moscow property map, warm office lighting, photorealistic, no text',
];

async function main() {
  for (let i = 0; i < prompts.length; i++) {
    console.log(`Generating image ${i+1}/${prompts.length}...`);
    try {
      const url = await generateDallEImage(prompts[i], 120_000);
      const srcPath = url.replace('file://', '');
      const outPath = `/tmp/${SLUG}-flux-${i+1}.jpg`;
      copyFileSync(srcPath, outPath);
      console.log(`✓ ${outPath}`);
    } catch(e: any) {
      console.error(`✗ ${e?.message ?? e}`);
    }
  }
}
main();
