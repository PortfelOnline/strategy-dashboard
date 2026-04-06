/**
 * batch-gma-blog.ts
 * Generate 13 English blog articles for get-my-agent.com, publish with Flux cover images,
 * and ping IndexNow so Google/Bing index them immediately.
 *
 * Run: npx tsx scripts/batch-gma-blog.ts
 */
import 'dotenv/config';
import { invokeLLM } from '../server/_core/llm';
import { generateDallEImage } from '../server/_core/imageGen';
import { publishPost, updatePost, uploadMediaFromUrl } from '../server/_core/wordpress';

const WP_SITE = 'https://get-my-agent.com';
const WP_USER = 'wproot';
const WP_PASS = 'Ear3N5QL9hKTfll4FmG9kW5h';
const CATEGORY_EN = 44; // "38-en" — English blog category (Polylang)
// NOTE: After publishing, run fix_polylang.php via SSH to set Polylang language=en
// so posts appear at /en/{slug}/ instead of /{slug}/

const INDEXNOW_KEY = process.env.INDEXNOW_API_KEY ?? 'adf660ce05b748bf9cd55bd3fd3eb304';

// ─── Article topics ───────────────────────────────────────────────────────────
const ARTICLES = [
  {
    title: 'How AI is Transforming Real Estate Agent Workflows in 2025',
    slug: 'ai-transforming-real-estate-agent-workflows-2025',
    focus: 'AI automation tools saving time for real estate agents: lead capture, follow-ups, content creation',
  },
  {
    title: 'Top 5 Ways Real Estate Agents Can Use AI to Close More Deals',
    slug: 'top-5-ways-real-estate-agents-use-ai-close-more-deals',
    focus: 'Practical AI tactics: AI chatbots, automated outreach, smart CRM, social media scheduling, personalized listings',
  },
  {
    title: 'The Complete Guide to AI Chatbots for Real Estate Agents',
    slug: 'complete-guide-ai-chatbots-real-estate-agents',
    focus: 'How AI chatbots qualify leads 24/7, answer common buyer questions, and hand off to agents',
  },
  {
    title: 'Why Every Real Estate Agent Needs an AI Assistant in 2025',
    slug: 'why-every-real-estate-agent-needs-ai-assistant-2025',
    focus: 'Benefits of AI assistants: 24/7 availability, instant responses, lead qualification, time savings',
  },
  {
    title: 'How to Generate Real Estate Leads with AI: A Step-by-Step Guide',
    slug: 'how-to-generate-real-estate-leads-with-ai-guide',
    focus: 'Lead generation funnel using AI: social media ads, landing pages, chatbot qualification, CRM integration',
  },
  {
    title: 'AI vs Traditional Real Estate Marketing: What Really Works',
    slug: 'ai-vs-traditional-real-estate-marketing-what-works',
    focus: 'Comparing ROI of AI-powered marketing vs traditional methods for real estate agents',
  },
  {
    title: 'How to Automate Your Real Estate Social Media with AI',
    slug: 'automate-real-estate-social-media-with-ai',
    focus: 'AI content generation for Instagram, Facebook, LinkedIn for real estate: posts, captions, scheduling',
  },
  {
    title: 'The Best AI Tools for Real Estate Agents in 2025',
    slug: 'best-ai-tools-real-estate-agents-2025',
    focus: 'Roundup of top AI tools: CRM AI, chatbots, image generation, virtual tours, automated follow-ups',
  },
  {
    title: 'How AI Helps Real Estate Agents Respond to Leads Faster',
    slug: 'how-ai-helps-real-estate-agents-respond-leads-faster',
    focus: 'Speed to lead statistics, AI instant response systems, conversion impact, implementation guide',
  },
  {
    title: 'Using AI to Write Better Property Listings That Sell Faster',
    slug: 'using-ai-write-better-property-listings-sell-faster',
    focus: 'AI copywriting for property descriptions: emotional triggers, SEO optimization, A/B testing',
  },
  {
    title: 'How Real Estate Agents Can Use WhatsApp AI Chatbots to Grow Their Business',
    slug: 'real-estate-agents-whatsapp-ai-chatbots-grow-business',
    focus: 'WhatsApp Business API + AI for real estate: automated responses, appointment booking, lead nurturing',
  },
  {
    title: 'AI Follow-Up Strategies That Turn Cold Leads into Hot Buyers',
    slug: 'ai-follow-up-strategies-cold-leads-hot-buyers',
    focus: 'Automated nurture sequences, personalized AI messages, timing optimization, re-engagement campaigns',
  },
  {
    title: 'How to Build a 24/7 Real Estate Lead Machine with AI',
    slug: 'build-24-7-real-estate-lead-machine-with-ai',
    focus: 'Full system: AI chatbot + automated email/WhatsApp + CRM integration + human handoff workflow',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFluxPrompt(title: string): string {
  return `Professional blog cover photo for an article titled "${title}". Modern real estate office, diverse agents working with AI technology on laptops and tablets, warm natural light, clean contemporary design, photorealistic, editorial photography style. No text overlay.`;
}

async function generateArticleHtml(title: string, focus: string): Promise<{ html: string; excerpt: string }> {
  const result = await invokeLLM({
    model: 'llama-3.3-70b-versatile',
    maxTokens: 3000,
    messages: [
      {
        role: 'system',
        content: `You are an expert content writer for get-my-agent.com — an AI assistant platform for real estate agents.
Write in friendly, professional English. Target audience: real estate agents who want to grow their business with AI.
Always promote get-my-agent.com as the solution. Never mention competitor products.

Output format:
EXCERPT: [1-2 sentence meta description, 150 chars max]
---HTML---
[full article as HTML, no <html>/<body> tags, just article content]`,
      },
      {
        role: 'user',
        content: `Write a comprehensive blog article for real estate agents.

Title: ${title}
Focus: ${focus}

Requirements:
- 800-1200 words
- Use <h2> and <h3> subheadings
- Include practical tips in <ul> lists
- Mention get-my-agent.com as the solution 2-3 times with a call to action
- End with a strong CTA paragraph linking to https://get-my-agent.com
- Include realistic statistics and concrete examples
- SEO-optimized for real estate agent keywords`,
      },
    ],
  });

  const raw = result.choices[0]?.message?.content;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

  const excerptMatch = text.match(/EXCERPT:\s*(.+)/);
  const excerpt = excerptMatch ? excerptMatch[1].trim() : title;

  const htmlMatch = text.match(/---HTML---\s*([\s\S]+)/);
  const html = htmlMatch ? htmlMatch[1].trim() : text;

  return { html, excerpt };
}

async function pingIndexNow(urls: string[]): Promise<void> {
  const payload = {
    host: 'get-my-agent.com',
    key: INDEXNOW_KEY,
    keyLocation: `https://get-my-agent.com/${INDEXNOW_KEY}.txt`,
    urlList: urls,
  };

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.ok || res.status === 202) {
    console.log(`[IndexNow] Submitted ${urls.length} URLs → status ${res.status}`);
  } else {
    console.warn(`[IndexNow] Warning: status ${res.status} – ${await res.text()}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const publishedUrls: string[] = [];

console.log(`[batch-gma-blog] Starting: ${ARTICLES.length} articles\n`);
const batchStart = Date.now();

for (let i = 0; i < ARTICLES.length; i++) {
  const { title, slug, focus } = ARTICLES[i];
  console.log(`\n[${i + 1}/${ARTICLES.length}] ${title}`);

  try {
    // 1. Generate article content
    console.log('  → Generating article content...');
    const { html, excerpt } = await generateArticleHtml(title, focus);

    // 2. Publish draft first (get post ID for media attachment)
    console.log('  → Publishing draft to WordPress...');
    const post = await publishPost(WP_SITE, WP_USER, WP_PASS, {
      title,
      content: html,
      status: 'draft',
    });
    console.log(`  → Draft created: ID=${post.id}`);

    // 3. Generate Flux cover image
    console.log('  → Generating Flux cover image...');
    const imageUrl = await generateDallEImage(buildFluxPrompt(title), 120_000);
    console.log(`  → Image: ${imageUrl.slice(0, 60)}...`);

    // 4. Upload image to WordPress
    console.log('  → Uploading image to WordPress...');
    const media = await uploadMediaFromUrl(
      WP_SITE,
      WP_USER,
      WP_PASS,
      imageUrl,
      `${slug}.jpg`
    );
    console.log(`  → Media uploaded: ID=${media.id}`);

    // 5. Update post: set slug, excerpt, category, featured image, publish
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updatePost(WP_SITE, WP_USER, WP_PASS, post.id, {
      slug,
      excerpt,
      featured_media: media.id,
      categories: [CATEGORY_EN],
      status: 'publish',
    } as any);

    const articleUrl = `${WP_SITE}/en/blog/${slug}/`;
    publishedUrls.push(articleUrl);
    console.log(`  ✓ Published: ${articleUrl}`);

  } catch (err) {
    console.error(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 6. Ping IndexNow for all published URLs at once
if (publishedUrls.length > 0) {
  console.log(`\n[IndexNow] Pinging ${publishedUrls.length} URLs...`);
  await pingIndexNow(publishedUrls);
}

const mins = ((Date.now() - batchStart) / 60000).toFixed(1);
console.log(`\n[batch-gma-blog] DONE: ${publishedUrls.length}/${ARTICLES.length} articles published in ${mins} min`);
console.log('\nPublished URLs:');
publishedUrls.forEach(u => console.log(`  ${u}`));
