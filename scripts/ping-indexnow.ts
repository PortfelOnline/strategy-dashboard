import 'dotenv/config';

const INDEXNOW_KEY = process.env.INDEXNOW_API_KEY ?? 'adf660ce05b748bf9cd55bd3fd3eb304';

// All 13 published articles (Polylang EN permalink: /en/{slug}/)
const URLS = [
  'https://get-my-agent.com/en/ai-transforming-real-estate-agent-workflows-2025/',
  'https://get-my-agent.com/en/top-5-ways-real-estate-agents-use-ai-close-more-deals/',
  'https://get-my-agent.com/en/complete-guide-ai-chatbots-real-estate-agents/',
  'https://get-my-agent.com/en/why-every-real-estate-agent-needs-ai-assistant-2025/',
  'https://get-my-agent.com/en/how-to-generate-real-estate-leads-with-ai-guide/',
  'https://get-my-agent.com/en/ai-vs-traditional-real-estate-marketing-what-works/',
  'https://get-my-agent.com/en/automate-real-estate-social-media-with-ai/',
  'https://get-my-agent.com/en/best-ai-tools-real-estate-agents-2025/',
  'https://get-my-agent.com/en/how-ai-helps-real-estate-agents-respond-leads-faster/',
  'https://get-my-agent.com/en/using-ai-write-better-property-listings-sell-faster/',
  'https://get-my-agent.com/en/real-estate-agents-whatsapp-ai-chatbots-grow-business/',
  'https://get-my-agent.com/en/ai-follow-up-strategies-cold-leads-hot-buyers/',
  'https://get-my-agent.com/en/build-24-7-real-estate-lead-machine-with-ai/',
];

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    host: 'get-my-agent.com',
    key: INDEXNOW_KEY,
    keyLocation: `https://get-my-agent.com/${INDEXNOW_KEY}.txt`,
    urlList: URLS,
  }),
});

console.log(`IndexNow: ${res.status} — ${URLS.length} URLs submitted`);
if (!res.ok && res.status !== 202) {
  console.error(await res.text());
}
console.log('URLs:');
URLS.forEach(u => console.log(' ', u));
