/**
 * Fresh GSC opportunities — last 28 days from today
 * Articles in /kadastr/ with position 5-25 and impressions >= 200
 */
import 'dotenv/config';
import { google } from 'googleapis';

const GSC_SITE = process.env.GSC_SITE_URL ?? 'sc-domain:kadastrmap.info';
const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? process.env.GSC_KEY_FILE ?? '';

function getDateRange() {
  const end = new Date();
  end.setDate(end.getDate() - 3); // GSC has 3-day delay
  const start = new Date(end);
  start.setDate(start.getDate() - 28);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function main() {
  const { startDate, endDate } = getDateRange();
  console.log(`\nПериод: ${startDate} → ${endDate}\n`);

  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] });
  const gsc = google.searchconsole({ version: 'v1', auth });

  const pagesResp = await gsc.searchanalytics.query({
    siteUrl: GSC_SITE,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: 300,
      dimensionFilterGroups: [{
        filters: [{ dimension: 'page', operator: 'contains', expression: '/kadastr/' }]
      }],
    },
  });

  const pages = (pagesResp.data.rows ?? [])
    .filter(r => {
      const pos = r.position ?? 0;
      return pos >= 4 && pos <= 25 && (r.impressions ?? 0) >= 200;
    })
    .sort((a, b) => {
      const scoreA = (a.impressions ?? 0) * Math.log(a.position ?? 1);
      const scoreB = (b.impressions ?? 0) * Math.log(b.position ?? 1);
      return scoreB - scoreA;
    })
    .slice(0, 25);

  console.log('=== ТОП-25 перспективных страниц (impressions × gap) ===\n');
  for (const p of pages) {
    const slug = (p.keys?.[0] ?? '').replace('https://kadastrmap.info', '');
    console.log(
      `pos=${String((p.position ?? 0).toFixed(1)).padStart(5)}  ` +
      `impr=${String(p.impressions ?? 0).padStart(6)}  ` +
      `clicks=${String(p.clicks ?? 0).padStart(5)}  ` +
      `ctr=${((p.ctr ?? 0) * 100).toFixed(1).padStart(4)}%  ${slug}`
    );
  }

  // For top-20 get main query
  console.log('\n=== Главный запрос для топ-20 ===\n');
  const top20 = pages.slice(0, 20);
  for (const p of top20) {
    const pageUrl = p.keys?.[0] ?? '';
    const slug = pageUrl.replace('https://kadastrmap.info', '');
    const qResp = await gsc.searchanalytics.query({
      siteUrl: GSC_SITE,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 3,
        dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }] }],
      },
    });
    const queries = (qResp.data.rows ?? []).map(r => r.keys?.[0]).join(' | ');
    console.log(`pos=${String((p.position ?? 0).toFixed(1)).padStart(5)}  impr=${String(p.impressions ?? 0).padStart(6)}  ctr=${((p.ctr ?? 0)*100).toFixed(1).padStart(4)}%  ${slug}`);
    console.log(`       queries: ${queries}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
