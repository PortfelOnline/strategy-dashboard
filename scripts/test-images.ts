import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

const URLS = ['https://kadastrmap.info/kadastr/kadastrovyj-pasport-na-kvartiru-mfts/'];

console.log('[test] Testing image filter fix...');
const t = Date.now();
await runBatchRewrite(1, URLS);
console.log(`[test] Done in ${((Date.now()-t)/60000).toFixed(1)} min`);
process.exit(0);
