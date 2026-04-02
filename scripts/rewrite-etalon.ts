import 'dotenv/config';
import { runBatchRewrite } from '../server/routers/articles';

await runBatchRewrite(1, [
  'https://kadastrmap.info/kadastr/zakazat-spravku-ob-obremenenii-nedvizhimosti-v-moskve-poshagovoe-rukovodstvo/',
]);
