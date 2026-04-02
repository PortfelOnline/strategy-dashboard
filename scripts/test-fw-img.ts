import 'dotenv/config';
import { generateDallEImage } from '../server/_core/imageGen';
const result = await generateDallEImage('cadastral map Russia real estate professional illustration')
  .then(r => `SUCCESS: ${r.slice(0, 100)}`)
  .catch(e => `FAIL: ${e.message}`);
console.log(result);
process.exit(0);
