import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { createContentPost, getUserContentPosts, getContentTemplates, createContentTemplate, updateContentPost, deleteContentPost } from "./db";
import { metaRouter } from "./routers/meta";
import { botsRouter } from "./routers/bots";
import { wordpressRouter } from "./routers/wordpress";
import { articlesRouter } from "./routers/articles";
import { generateGeminiImage, generateVeoVideo, buildVisualPrompt } from "./_core/gemini";
import { storagePut } from "./storage";

// ─── Trends cache & fallbacks ──────────────────────────────────────────────
const trendsCache = new Map<string, { trends: { query: string; traffic: string }[]; ts: number }>();

const FALLBACK_TRENDS_IN = [
  { query: "AI chatbot for business", traffic: "50K+" },
  { query: "WhatsApp automation", traffic: "100K+" },
  { query: "Instagram marketing India", traffic: "200K+" },
  { query: "small business online", traffic: "150K+" },
  { query: "digital marketing tips", traffic: "80K+" },
  { query: "customer support automation", traffic: "60K+" },
];

// ─── Content generation helpers ────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a high-converting social media copywriter for get-my-agent.com.
Product: AI chatbot for Indian small businesses on WhatsApp, Instagram, and websites.
Pricing: from ₹999/month. Features: 24/7 instant replies (<3 seconds), automatic lead capture to CRM, all platforms.
Rules:
- Write ONLY in English. No Hindi, Hinglish, or regional language words.
- Be specific: use the exact industry, scenario, and ₹ amounts provided — do NOT genericise.
- Make content feel real and relatable, not like a marketing brochure.
- CRITICAL: Respond with valid JSON only. No markdown code fences. No text outside the JSON.`;

// ── Industries ──────────────────────────────────────────────────────────────

const INDUSTRY_CONTEXT = {
  retail: {
    label: "Retail / Clothing",
    owner: "retail shop owner",
    scenario: "A customer DMs your Instagram at 10pm: 'Is this kurta available in size L? What's the price?' You're asleep. By morning, they've already ordered from a competitor.",
    painSpecific: "Retail shop owners get 60-70% of product enquiries outside business hours — evenings, Sundays, holidays",
    lossPerMiss: "₹500–5,000 per missed order",
    industryHashtags: ["RetailIndia", "FashionBusiness", "OnlineShopping"],
  },
  real_estate: {
    label: "Real Estate",
    owner: "real estate agent",
    scenario: "A buyer WhatsApps: 'Interested in the 2BHK you posted. Still available? What's the price?' You see it 4 hours later. Their agent already showed them 3 properties.",
    painSpecific: "Real estate agents miss 30-40% of property enquiries because leads come at all hours — buyers don't wait",
    lossPerMiss: "₹10,000–50,000 per missed lead (brokerage)",
    industryHashtags: ["RealEstateIndia", "PropertyIndia", "HomeBuying"],
  },
  restaurant: {
    label: "Restaurant / Cafe",
    owner: "restaurant owner",
    scenario: "Someone DMs at 7pm: 'Do you have a table for 4 tonight at 8?' You're in the kitchen managing orders. They book somewhere else.",
    painSpecific: "Restaurants lose 20-30% of potential bookings and delivery orders to slow response times during peak hours",
    lossPerMiss: "₹800–3,000 per missed table",
    industryHashtags: ["RestaurantIndia", "FoodBusiness", "CafeOwner"],
  },
  ecommerce: {
    label: "E-commerce",
    owner: "e-commerce seller",
    scenario: "A customer asks: 'Will this deliver before Diwali? What's the return policy?' at 2am. No reply. They buy from Amazon instead.",
    painSpecific: "E-commerce sellers on Instagram and WhatsApp lose significant sales when they're offline — buyers want instant answers",
    lossPerMiss: "₹300–2,000 per missed order",
    industryHashtags: ["EcommerceIndia", "OnlineBusiness", "InstagramShopping"],
  },
  coaching: {
    label: "Coaching / Tuition",
    owner: "coaching center owner",
    scenario: "A parent WhatsApps at 9pm: 'Do you have seats for Class 10 Maths? What are the fees and batch timings?' No reply that night. They enrol their child elsewhere by morning.",
    painSpecific: "Coaching centers lose 40% of admission enquiries to response delays during peak seasons (March, June, October)",
    lossPerMiss: "₹5,000–15,000 per missed admission",
    industryHashtags: ["CoachingIndia", "TuitionCenter", "EducationBusiness"],
  },
  services: {
    label: "Services",
    owner: "service business owner",
    scenario: "A customer WhatsApps: 'Can you come tomorrow for AC repair? Rough cost?' You're on a job. They call 3 more numbers. Someone else gets the booking.",
    painSpecific: "Service businesses lose jobs daily to whoever responds first — 67% of customers contact multiple providers simultaneously",
    lossPerMiss: "₹500–5,000 per missed booking",
    industryHashtags: ["ServiceBusiness", "HomeServices", "LocalBusiness"],
  },
} as const;

// ── Content angles ──────────────────────────────────────────────────────────

const ANGLE_CONTEXT = {
  standard: {
    label: "Standard",
    instruction: "Lead with the specific industry pain point, show the exact cost of inaction, introduce the solution with concrete ₹ numbers, end with CTA.",
  },
  pov: {
    label: "POV Story",
    instruction: "Write in POV format — first-person story from the perspective of the business owner discovering and using the AI agent. Use 'POV:' as the hook. Make it feel like a real person sharing their experience, not an ad.",
  },
  transformation: {
    label: "Before / After",
    instruction: "Write a dramatic Before vs After or 'Day 1 vs Day 30' transformation. Be hyper-specific about the change: exact numbers, exact scenarios. The contrast should be jarring and undeniable.",
  },
  comparison: {
    label: "₹ Comparison",
    instruction: "Write a direct side-by-side comparison post: 'Option A vs Option B'. Use a table or bullet format. Make the math brutally obvious. The reader should feel slightly foolish for not switching sooner.",
  },
  objection: {
    label: "Objection Busting",
    instruction: "Start with the most common fear or objection in this industry ('But AI can't understand my customers' / 'My clients prefer talking to a real person' / 'I'm not tech-savvy'). Then systematically dismantle it with specific facts. Flip the script completely.",
  },
  story: {
    label: "Mini Story",
    instruction: "Write a mini-story with a named Indian protagonist (Rahul, Priya, Amit, etc.) who runs the specified business. Beginning: the painful moment. Middle: they discover the solution. End: specific measurable result 30 days later. Make it feel like a real testimonial.",
  },
} as const;

// ── Season context ───────────────────────────────────────────────────────────

const SEASON_CONTEXT = {
  none: null,
  diwali: {
    label: "Diwali / Festive",
    months: "Oct–Nov",
    urgency: "It's Diwali season — India's biggest shopping window. Customers are buying RIGHT NOW. The business that replies first gets the order.",
    hook: "Diwali mein ek missed message = ek missed order",
    stat: "E-commerce and retail see 40–60% sales spike in Diwali week. Most of it goes to whoever responds first.",
  },
  ipl: {
    label: "IPL Season",
    months: "Mar–May",
    urgency: "IPL season: restaurants, food delivery, and sports bars see 3x more group booking requests on match evenings — mostly 6–10pm when owners are busiest.",
    hook: "Match night: 40 WhatsApp messages in 2 hours. Can you reply to all?",
    stat: "Restaurants report 60% more group bookings during IPL. Peak hour: 7–9pm — exactly when you can't answer.",
  },
  back_to_school: {
    label: "Back to School",
    months: "Jun–Jul",
    urgency: "June admission season: parents decide coaching centers in a 2-week window. A delayed reply loses you the entire academic year's fees.",
    hook: "June: every coaching centre gets 100+ enquiries in 2 weeks. Who replies first, wins.",
    stat: "70% of parents contact 3+ coaching centers simultaneously — and enroll with whoever responds first.",
  },
  gst_season: {
    label: "GST Season",
    months: "Jul, Sep, Dec",
    urgency: "GST filing deadline: CA firms and service businesses face a flood of last-minute requests in the final week before July 31 / September 30.",
    hook: "July 31: your phone is ringing, your WhatsApp is full, your email is overflowing",
    stat: "Service businesses lose 30% of GST-season clients to competitors who respond instantly during deadline week.",
  },
  wedding: {
    label: "Wedding Season",
    months: "Nov–Feb",
    urgency: "Wedding season: couples book caterers, decorators, photographers 2–3 months ahead. A 4-hour response delay means they've already signed with your competitor.",
    hook: "She contacted 8 wedding photographers. 3 replied same day. She booked one of those 3.",
    stat: "85% of wedding bookings go to the first vendor who gives a clear, fast quote.",
  },
  summer: {
    label: "Summer Vacations",
    months: "May–Jun",
    urgency: "Summer vacation: parents are actively searching for activities, coaching, tuition for kids during the 2-month break — the window is short and competitive.",
    hook: "Summer break starts May 1. Coaching centers that aren't ready lose 3 months of revenue.",
    stat: "Coaching enrollment drops 40% for centers that respond slowly in April–May admissions rush.",
  },
} as const;

// ── Social proof bank ─────────────────────────────────────────────────────────

const SOCIAL_PROOF = {
  instruction: `SOCIAL PROOF REQUIREMENT (mandatory — weave naturally into the post, do not bolt on):
Include exactly one social proof element chosen from:
- "1,200+ Indian business owners already use get-my-agent.com"
- A specific mini-result relevant to the industry (e.g. "A saree shop in Jaipur recovered ₹38,000 in missed orders in 30 days")
- A credibility stat: "Response in under 3 seconds. Humans average 4 hours."
Place it where it strengthens the narrative — not just at the end.`,
};

// ── Pillar context ───────────────────────────────────────────────────────────

const PILLAR_CONTEXT = {
  desi_business_owner: {
    hook: "Your competitor just replied to that customer. You didn't.",
    focus: "emotional relatability — the daily struggle of missing messages, losing to faster competitors",
    proof: "78% of customers buy from the first business that responds",
  },
  five_minute_transformation: {
    hook: "Set up a 24/7 AI sales agent in less time than it takes to finish your chai.",
    focus: "speed and simplicity — show how fast and easy the setup is, destroy the 'too complicated' objection",
    proof: "10 minutes from signup to first automated reply. No coding. No IT team.",
  },
  roi_calculator: {
    hook: "₹999/month vs ₹15,000-30,000/month. Same job. Which would you choose?",
    focus: "hard numbers — calculate the exact cost of the current approach vs AI, make the ROI undeniable",
    proof: "Average customer saves ₹14,000+/month and handles 3x more conversations",
  },
} as const;

// ── Format schemas ───────────────────────────────────────────────────────────

const FORMAT_SCHEMAS = {
  carousel: `Create a 6-slide Instagram Carousel. Return exactly this JSON (no other text):
{
  "slides": [
    {"num": 1, "label": "Cover", "headline": "scroll-stopping headline 6 words max — use the specific industry scenario", "sub": "compelling subtitle 10 words max"},
    {"num": 2, "label": "The Problem", "headline": "specific problem headline for this industry", "points": ["industry-specific pain 1 with ₹ or time cost", "industry-specific pain 2", "industry-specific pain 3"]},
    {"num": 3, "label": "The Reality", "headline": "reality-check headline", "stat": "shocking specific statistic relevant to this industry", "context": "one sentence of context"},
    {"num": 4, "label": "The Solution", "headline": "solution headline", "points": ["benefit 1 with ₹ or number", "benefit 2 with ₹ or number", "benefit 3 with ₹ or number"]},
    {"num": 5, "label": "Results", "headline": "results headline", "quote": "specific customer result for this industry type", "source": "specific type of business owner (e.g. 'saree shop owner, Jaipur')"},
    {"num": 6, "label": "Get Started", "headline": "action-oriented headline", "sub": "Try free → get-my-agent.com"}
  ],
  "caption": "Instagram caption — hook sentence using the industry scenario, value prop, CTA — 150 chars max",
  "hashtags": ["IndiaSmallBusiness", "AIForBusiness", "GetMyAgent", "AIAgent", "IndianEntrepreneur", "SmallBusiness", "CustomerService", "BusinessGrowth", "WhatsAppBusiness", "DigitalIndia"]
}`,

  reel: `Create a 30-45 second Instagram Reel script. Return exactly this JSON (no other text):
{
  "sections": [
    {"time": "0:00-0:03", "label": "HOOK", "visual": "what is shown — use specific industry setting", "audio": "exact shocking opening words using the industry scenario"},
    {"time": "0:03-0:12", "label": "PROBLEM", "visual": "visual showing the specific missed message / lost sale", "audio": "specific relatable moment for this industry in 2 sentences"},
    {"time": "0:12-0:25", "label": "SOLUTION", "visual": "show AI agent responding instantly on phone screen", "audio": "how AI agent solves it with specific ₹ or time numbers"},
    {"time": "0:25-0:35", "label": "PROOF", "visual": "specific numbers or result for this industry on screen", "audio": "specific measurable result relevant to this industry"},
    {"time": "0:35-0:45", "label": "CTA", "visual": "get-my-agent.com on screen", "audio": "single clear action with urgency"}
  ],
  "voiceover": "complete 45-second spoken script as one paragraph — use the specific industry scenario throughout",
  "text_overlays": ["overlay 1 — industry-specific hook text", "overlay 2", "overlay 3", "overlay 4", "overlay 5"],
  "caption": "reel caption — industry-specific hook + CTA",
  "hashtags": ["Reels", "IndiaSmallBusiness", "AIForBusiness", "GetMyAgent", "BusinessTips", "IndianEntrepreneur", "WhatsAppMarketing", "DigitalMarketing", "GrowthHack", "AIAgent"]
}`,

  story: `Create a 3-frame Instagram Story sequence. Return exactly this JSON (no other text):
{
  "frames": [
    {"num": 1, "label": "Hook", "emoji": "industry-relevant emoji", "main_text": "4-word max statement using industry scenario", "sub_text": "one specific detail (₹ amount or time)"},
    {"num": 2, "label": "Content", "emoji": "relevant emoji", "main_text": "content headline", "sub_text": "brief context", "list": ["industry-specific point 1 with number", "industry-specific point 2", "industry-specific point 3"]},
    {"num": 3, "label": "CTA", "emoji": "🚀", "main_text": "action headline", "sub_text": "get-my-agent.com", "button_text": "Try Free →"}
  ],
  "poll": {"question": "industry-specific poll question", "yes": "relatable yes option", "no": "honest no option"},
  "question_sticker": "open question to drive DMs from this type of business owner"
}`,

  feed_post: `Create an Instagram Feed Post. Return exactly this JSON (no other text):
{
  "hook": "first line using the EXACT industry scenario — stops the scroll in under 10 words",
  "paragraphs": [
    "paragraph 1: describe the specific industry pain in vivid detail — 2-3 sentences with ₹ loss",
    "paragraph 2: introduce the solution with specifics for this industry — 2-3 sentences",
    "paragraph 3: paint the after picture — specific measurable result for this industry type — 2-3 sentences"
  ],
  "cta": "single clear action sentence with urgency",
  "caption": "full ready-to-post caption — hook + all paragraphs + CTA — 300 words max, line breaks",
  "hashtags": ["IndiaSmallBusiness", "AIForBusiness", "GetMyAgent", "AIAgent", "IndianEntrepreneur", "SmallBusiness", "CustomerService", "BusinessAutomation", "StartupIndia", "WhatsAppBusiness", "DigitalIndia", "BusinessGrowth", "SalesAgent", "ChatbotIndia", "BusinessTips"]
}`,
} as const;

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildGenerationPrompt(
  pillarType: keyof typeof PILLAR_CONTEXT,
  contentFormat: keyof typeof FORMAT_SCHEMAS,
  industry: keyof typeof INDUSTRY_CONTEXT,
  contentAngle: keyof typeof ANGLE_CONTEXT,
  season: keyof typeof SEASON_CONTEXT = "none",
  customPrompt?: string
): string {
  const pillar = PILLAR_CONTEXT[pillarType];
  const schema = FORMAT_SCHEMAS[contentFormat];
  const ind = INDUSTRY_CONTEXT[industry];
  const angle = ANGLE_CONTEXT[contentAngle];
  const seasonData = SEASON_CONTEXT[season];

  const seasonBlock = seasonData
    ? `\nSEASONAL CONTEXT — ${seasonData.label} (${seasonData.months}):
URGENCY: ${seasonData.urgency}
SEASONAL HOOK: "${seasonData.hook}"
SEASONAL STAT: ${seasonData.stat}
→ Weave this seasonal timing and urgency throughout the post. The season makes the pain MORE URGENT right now.`
    : "";

  return `${schema}

INDUSTRY: ${ind.label} (${ind.owner})
SPECIFIC SCENARIO TO USE: ${ind.scenario}
INDUSTRY PAIN STAT: ${ind.painSpecific}
COST PER MISSED LEAD: ${ind.lossPerMiss}

CONTENT ANGLE — ${angle.label.toUpperCase()}: ${angle.instruction}

PILLAR FOCUS — ${pillar.focus}
HOOK CONCEPT: ${pillar.hook}
KEY PROOF: ${pillar.proof}${seasonBlock}

${SOCIAL_PROOF.instruction}${customPrompt ? `\n\nEXTRA INSTRUCTIONS: ${customPrompt}` : ""}

Use the industry-specific scenario and ₹ amounts throughout. Make it feel written FOR this exact type of business owner, not generic.`;
}

// ── Hook variants generator ──────────────────────────────────────────────────

function buildHookVariantsPrompt(
  industry: keyof typeof INDUSTRY_CONTEXT,
  pillarType: keyof typeof PILLAR_CONTEXT
): string {
  const ind = INDUSTRY_CONTEXT[industry];
  const pillar = PILLAR_CONTEXT[pillarType];
  return `Generate 5 different scroll-stopping Instagram hooks for a ${ind.owner}.
Context: ${ind.scenario}
Cost of inaction: ${ind.lossPerMiss}
Pillar focus: ${pillar.focus}

Return exactly this JSON:
{
  "hooks": [
    {"style": "Direct pain", "text": "hook text"},
    {"style": "POV", "text": "POV: hook text"},
    {"style": "Question", "text": "hook text?"},
    {"style": "Shocking stat", "text": "hook with number"},
    {"style": "Story opener", "text": "It was [time]. hook..."}
  ]
}`;
}

// ───────────────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,
  meta: metaRouter,
  bots: botsRouter,
  wordpress: wordpressRouter,
  articles: articlesRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  content: router({
    generatePost: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("carousel"),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services"]).default("retail"),
        contentAngle: z.enum(["standard", "pov", "transformation", "comparison", "objection", "story"]).default("standard"),
        season: z.enum(["none", "diwali", "ipl", "back_to_school", "gst_season", "wedding", "summer"]).default("none"),
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("english"),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userPrompt = buildGenerationPrompt(
          input.pillarType as keyof typeof PILLAR_CONTEXT,
          input.contentFormat as keyof typeof FORMAT_SCHEMAS,
          input.industry as keyof typeof INDUSTRY_CONTEXT,
          input.contentAngle as keyof typeof ANGLE_CONTEXT,
          input.season as keyof typeof SEASON_CONTEXT,
          input.customPrompt
        );

        const response = await invokeLLM({
          messages: [
            { role: "system", content: CONTENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        });

        const contentText = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content
          : "";

        let parsed: any = null;
        try {
          const jsonStr = contentText.replace(/^```json\s*|\s*```$/g, "").trim();
          parsed = JSON.parse(jsonStr);
        } catch {
          // LLM didn't return valid JSON — caller falls back to raw text
        }

        const hashtags =
          (Array.isArray(parsed?.hashtags) ? parsed.hashtags.map((h: string) => (h.startsWith("#") ? h : `#${h}`)).join(" ") : null)
          ?? contentText.match(/#\w+/g)?.join(" ")
          ?? "#GetMyAgent #AI #IndianBusiness";

        return {
          content: contentText,
          parsed,
          hashtags,
          format: input.contentFormat,
          platform: input.platform,
          language: input.language,
          pillarType: input.pillarType,
        };
      }),

    generateHooks: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services"]).default("retail"),
      }))
      .mutation(async ({ ctx, input }) => {
        const userPrompt = buildHookVariantsPrompt(
          input.industry as keyof typeof INDUSTRY_CONTEXT,
          input.pillarType as keyof typeof PILLAR_CONTEXT
        );
        const response = await invokeLLM({
          messages: [
            { role: "system", content: CONTENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
        });
        const contentText = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content : "";
        let hooks: any[] = [];
        try {
          const jsonStr = contentText.replace(/^```json\s*|\s*```$/g, "").trim();
          hooks = JSON.parse(jsonStr).hooks ?? [];
        } catch { /* fallback empty */ }
        return { hooks };
      }),

    savePost: protectedProcedure
      .input(z.object({
        title: z.string(),
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
        language: z.string(),
        hashtags: z.string().optional(),
        status: z.enum(["draft", "scheduled", "published"]).default("draft"),
        scheduledAt: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createContentPost(ctx.user.id, {
          title: input.title,
          content: input.content,
          platform: input.platform,
          language: input.language,
          hashtags: input.hashtags,
          status: input.status,
          scheduledAt: input.scheduledAt,
        });
        const insertId = (result as any)[0]?.insertId ?? (result as any)?.insertId ?? null;
        return { id: insertId as number | null };
      }),

    listPosts: protectedProcedure
      .input(z.object({
        status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const posts = await getUserContentPosts(ctx.user.id, input.status);
        return posts;
      }),

    listTemplates: protectedProcedure
      .query(async ({ ctx }) => {
        const templates = await getContentTemplates(ctx.user.id);
        return templates;
      }),

    saveTemplate: protectedProcedure
      .input(z.object({
        title: z.string(),
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube", "all"]),
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]),
        prompt: z.string(),
        description: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await createContentTemplate(ctx.user.id, {
          title: input.title,
          pillarType: input.pillarType,
          platform: input.platform,
          language: input.language,
          prompt: input.prompt,
          description: input.description,
        });
        return result;
      }),

    updatePost: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        content: z.string().optional(),
        hashtags: z.string().optional(),
        status: z.enum(["draft", "scheduled", "published", "archived"]).optional(),
        scheduledAt: z.date().optional().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...updates } = input;
        await updateContentPost(ctx.user.id, id, updates);
        return { success: true };
      }),

    deletePost: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteContentPost(ctx.user.id, input.id);
        return { success: true };
      }),

    schedulePost: protectedProcedure
      .input(z.object({
        id: z.number(),
        scheduledAt: z.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        await updateContentPost(ctx.user.id, input.id, {
          scheduledAt: input.scheduledAt,
          status: 'scheduled',
        });
        return { success: true };
      }),

    generateVariation: protectedProcedure
      .input(z.object({
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("hinglish"),
      }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a social media content expert for the Indian market. Create a variation of the given post that feels fresh but conveys the same message. Keep it engaging with emojis and hashtags." },
            { role: "user", content: `Create a variation of this ${input.platform} post in ${input.language}:\n\n${input.content}` },
          ],
        });
        const variation = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content : "";
        return { variation };
      }),

    bulkGenerate: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("carousel"),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services"]).default("retail"),
        contentAngle: z.enum(["standard", "pov", "transformation", "comparison", "objection", "story"]).default("standard"),
        season: z.enum(["none", "diwali", "ipl", "back_to_school", "gst_season", "wedding", "summer"]).default("none"),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]).default("instagram"),
        count: z.number().min(1).max(7).default(7),
        language: z.string().default("english"),
        startDate: z.date().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const ALL_ANGLES = ["standard", "pov", "transformation", "comparison", "objection", "story"] as const;
        const baseIdx = ALL_ANGLES.indexOf(input.contentAngle as any);

        const results = await Promise.all(
          Array.from({ length: input.count }, async (_, i) => {
            const angle = ALL_ANGLES[(baseIdx + i) % ALL_ANGLES.length] as keyof typeof ANGLE_CONTEXT;
            const prompt = buildGenerationPrompt(
              input.pillarType as keyof typeof PILLAR_CONTEXT,
              input.contentFormat as keyof typeof FORMAT_SCHEMAS,
              input.industry as keyof typeof INDUSTRY_CONTEXT,
              angle,
              input.season as keyof typeof SEASON_CONTEXT,
            );
            const response = await invokeLLM({
              messages: [
                { role: "system", content: CONTENT_SYSTEM_PROMPT },
                { role: "user", content: prompt },
              ],
            });
            const contentText = typeof response.choices[0]?.message.content === "string"
              ? response.choices[0].message.content : "";
            let parsed: any = null;
            try {
              const jsonStr = contentText.replace(/^```json\s*|\s*```$/g, "").trim();
              parsed = JSON.parse(jsonStr);
            } catch { /* empty */ }

            const ind = INDUSTRY_CONTEXT[input.industry as keyof typeof INDUSTRY_CONTEXT];
            const title = parsed?.title ?? parsed?.hook ?? `${ind.label} · Post ${i + 1}`;
            const hashtags = Array.isArray(parsed?.hashtags)
              ? parsed.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ")
              : `#GetMyAgent #AI #${ind.label.replace(/\s+/g, '')}`;

            let scheduledAt: Date | undefined;
            if (input.startDate) {
              scheduledAt = new Date(input.startDate);
              scheduledAt.setDate(scheduledAt.getDate() + i);
              scheduledAt.setHours(9, 0, 0, 0);
            }

            await createContentPost(ctx.user.id, {
              title,
              content: contentText,
              platform: input.platform,
              language: input.language,
              hashtags,
              status: scheduledAt ? 'scheduled' : 'draft',
              scheduledAt,
            });

            return { title, angle };
          })
        );

        return { posts: results, count: results.length };
      }),

    getStats: protectedProcedure
      .query(async ({ ctx }) => {
        const allPosts = await getUserContentPosts(ctx.user.id);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const byStatus = {
          draft: allPosts.filter(p => p.status === 'draft').length,
          scheduled: allPosts.filter(p => p.status === 'scheduled').length,
          published: allPosts.filter(p => p.status === 'published').length,
          archived: allPosts.filter(p => p.status === 'archived').length,
        };

        const byPlatform = ['facebook', 'instagram', 'whatsapp', 'youtube'].map(pl => ({
          name: pl,
          count: allPosts.filter(p => p.platform === pl).length,
        }));

        const publishedThisMonth = allPosts.filter(p =>
          p.status === 'published' && p.publishedAt && new Date(p.publishedAt) >= monthStart
        ).length;

        const scheduledThisWeek = allPosts.filter(p =>
          p.status === 'scheduled' && p.scheduledAt &&
          new Date(p.scheduledAt) >= now && new Date(p.scheduledAt) <= weekEnd
        ).length;

        const upcoming = allPosts
          .filter(p => p.status === 'scheduled' && p.scheduledAt && new Date(p.scheduledAt) >= now)
          .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
          .slice(0, 5);

        return { byStatus, byPlatform, publishedThisMonth, scheduledThisWeek, upcoming, total: allPosts.length };
      }),

    generateVisual: protectedProcedure
      .input(z.object({
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("feed_post"),
        hook: z.string(),
      }))
      .mutation(async ({ input }) => {
        const { prompt, aspectRatio } = buildVisualPrompt(input.industry, input.contentFormat, input.hook);
        const { b64, mimeType } = await generateGeminiImage(prompt, aspectRatio);
        const buffer = Buffer.from(b64, "base64");
        const { url } = await storagePut(`visuals/${Date.now()}.jpg`, buffer, mimeType);
        return { url, prompt };
      }),

    generateVideo: protectedProcedure
      .input(z.object({
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services"]),
        hook: z.string(),
        durationSeconds: z.number().min(4).max(8).default(8),
      }))
      .mutation(async ({ input }) => {
        const { prompt } = buildVisualPrompt(input.industry, "reel", input.hook);
        const videoPrompt = `${prompt} Dynamic motion, cinematic quality, vertical 9:16 video for Instagram Reels. 8 seconds.`;
        const { b64, mimeType } = await generateVeoVideo(videoPrompt, "9:16", input.durationSeconds);
        const buffer = Buffer.from(b64, "base64");
        const { url } = await storagePut(`videos/${Date.now()}.mp4`, buffer, mimeType);
        return { url };
      }),

    suggestHashtags: protectedProcedure
      .input(z.object({
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
      }))
      .mutation(async ({ input }) => {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a social media hashtag expert for the Indian market. Suggest relevant, trending hashtags." },
            { role: "user", content: `Suggest 10 relevant hashtags for this ${input.platform} post. Return ONLY the hashtags separated by spaces, no explanations:\n\n${input.content}` },
          ],
        });
        const hashtags = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content.trim() : "";
        return { hashtags };
      }),

    getTrends: publicProcedure
      .input(z.object({
        geo: z.enum(["IN", "US", "GB", "AU", "SG"]).default("IN"),
      }))
      .query(async ({ input }) => {
        const cacheKey = `trends_${input.geo}`;
        const cached = trendsCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 60 * 60 * 1000) {
          return { trends: cached.trends, source: "cache" as const };
        }

        try {
          const rssUrl = `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${input.geo}`;
          const res = await fetch(rssUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; TrendBot/1.0)" },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);
          const xml = await res.text();

          // Extract titles from RSS items
          const titleMatches = xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g);
          const titles = [...titleMatches].map(m => m[1]).filter(Boolean);

          // Extract traffic numbers (approximate search volume)
          const trafficMatches = xml.matchAll(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/g);
          const traffic = [...trafficMatches].map(m => m[1]);

          const trends = titles.slice(0, 12).map((title, i) => ({
            query: title,
            traffic: traffic[i] ?? "",
          }));

          trendsCache.set(cacheKey, { trends, ts: Date.now() });
          return { trends, source: "live" as const };
        } catch (err) {
          // Return cached stale data if available, else fallback
          if (cached) return { trends: cached.trends, source: "stale" as const };
          return { trends: FALLBACK_TRENDS_IN, source: "fallback" as const };
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
