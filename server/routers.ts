import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { createContentPost, getUserContentPosts, getContentTemplates, createContentTemplate, updateContentPost, deleteContentPost, getSavedTopics, saveTopic, deleteTopic } from "./db";
import { metaRouter } from "./routers/meta";
import { botsRouter } from "./routers/bots";
import { wordpressRouter } from "./routers/wordpress";
import { articlesRouter } from "./routers/articles";
import { generateDalleImage, generateGeminiImage, generateVeoVideo, buildVisualPrompt, buildVisualDalleSize, generateVisualPromptWithLLM } from "./_core/gemini";
import { storagePut } from "./storage";
import fs from "fs";
import path from "path";

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
  insurance_agent: {
    label: "Insurance Agent",
    owner: "insurance agent",
    scenario: "A prospect WhatsApps at 9pm: 'I want to compare term plans for ₹1 crore cover. Which is best for me?' You're off for the evening. By morning, they've already bought from PolicyBazaar.",
    painSpecific: "Insurance agents lose 50%+ of warm leads to delayed responses — prospects compare and buy online within hours of asking",
    lossPerMiss: "₹3,000–20,000 per missed policy sale (first-year commission)",
    industryHashtags: ["InsuranceAgent", "TermInsurance", "LICAgent"],
  },
  loan_agent: {
    label: "Loan / Mortgage Agent",
    owner: "loan agent",
    scenario: "A salaried professional WhatsApps: 'I need a home loan of ₹50L. What's your best rate? How fast can you process?' You're in a meeting. Three hours later, their bank's DSA has already filed the application.",
    painSpecific: "Loan agents lose 40-60% of leads to banks and aggregators simply because they respond slower — borrowers decide within the same day",
    lossPerMiss: "₹5,000–25,000 per missed loan disbursement (processing fee/commission)",
    industryHashtags: ["HomeLoan", "LoanAgent", "MortgageBrokerIndia"],
  },
  ca_tax: {
    label: "CA / Tax Consultant",
    owner: "CA or tax consultant",
    scenario: "A business owner WhatsApps during filing season: 'We need GST filing done urgently and ITR for 3 directors. What are your charges and how soon?' You're buried in client work. They hire another CA by evening.",
    painSpecific: "CAs and tax consultants lose 30-50% of new client enquiries during peak seasons (March, July, October) because they're too busy to respond",
    lossPerMiss: "₹5,000–50,000 per missed annual retainer client",
    industryHashtags: ["CAIndia", "TaxConsultant", "GSTFiling"],
  },
  travel_agent: {
    label: "Travel Agent",
    owner: "travel agent",
    scenario: "A family WhatsApps: 'Planning a Maldives trip for 4 pax in December. 5 nights. What's your best package with flights?' You're handling another booking. They book directly on MakeMyTrip ₹80,000 cheaper because no one answered.",
    painSpecific: "Travel agents lose 60%+ of package enquiries to OTAs — customers want instant quotes and book elsewhere within hours",
    lossPerMiss: "₹3,000–15,000 per missed holiday package (commission)",
    industryHashtags: ["TravelAgent", "HolidayPackages", "TravelIndia"],
  },
  wedding_planner: {
    label: "Wedding Planner",
    owner: "wedding planner",
    scenario: "A couple WhatsApps: 'Our wedding is in February. 300 guests. Budget ₹15L. Can you share a portfolio and rough quote?' You're at a venue recce. By next morning, they've shortlisted two other planners who replied instantly.",
    painSpecific: "Wedding planners lose bookings to faster-responding competitors — couples contact 5-6 planners simultaneously and commit to the first credible reply",
    lossPerMiss: "₹50,000–2,00,000 per missed wedding contract",
    industryHashtags: ["WeddingPlanner", "WeddingIndia", "DreamWedding"],
  },
  interior_designer: {
    label: "Interior Designer",
    owner: "interior designer",
    scenario: "A homeowner WhatsApps: 'Just got possession of a 2BHK. Want full interior done. Budget ₹8-10L. Can you visit this week?' You're on-site. They book a designer who replied within 30 minutes.",
    painSpecific: "Interior designers lose 40% of project leads to firms that respond faster — renovation decisions happen fast and clients want immediate engagement",
    lossPerMiss: "₹20,000–1,00,000 per missed interior project",
    industryHashtags: ["InteriorDesigner", "HomeInterior", "InteriorDesignIndia"],
  },
  clinic_doctor: {
    label: "Doctor / Clinic",
    owner: "clinic owner or doctor",
    scenario: "A patient WhatsApps at 8am: 'My child has fever since 2 days. Can I get an appointment today? What's your slot availability?' No reply by 9am. They book at the nearest Practo-listed clinic.",
    painSpecific: "Clinics and doctors lose 30-40% of new patient appointments to Practo and faster-responding competitors — patients book the first available slot",
    lossPerMiss: "₹300–2,000 per missed consultation (plus lifetime patient value)",
    industryHashtags: ["ClinicIndia", "DoctorIndia", "HealthcareIndia"],
  },
  car_dealer: {
    label: "Car Dealer",
    owner: "car dealer",
    scenario: "A buyer WhatsApps: 'Interested in Swift Dzire VXI. What's the on-road price and waiting period? Any exchange offer?' You're on the showroom floor. They visit a competitor showroom that replied with full details in 10 minutes.",
    painSpecific: "Car dealers lose 25-35% of enquiries to competitors who respond faster with price and availability — buyers visit whichever showroom replies first",
    lossPerMiss: "₹10,000–50,000 per missed car sale (dealer margin)",
    industryHashtags: ["CarDealer", "CarSalesIndia", "AutoIndia"],
  },
  salon_beauty: {
    label: "Salon / Beauty",
    owner: "salon owner",
    scenario: "A bride-to-be WhatsApps: 'Need bridal makeup and hair for my wedding on 15th March. What's the package cost? Are you available?' You're mid-session. She books another salon that replied within the hour.",
    painSpecific: "Salons lose 35-50% of premium bookings (bridal, events) to competitors who respond faster on Instagram and WhatsApp",
    lossPerMiss: "₹2,000–20,000 per missed bridal or event booking",
    industryHashtags: ["SalonIndia", "BeautyBusiness", "BridalMakeup"],
  },
  gym_fitness: {
    label: "Gym / Fitness",
    owner: "gym owner",
    scenario: "Someone WhatsApps: 'Want to join your gym. What are the monthly and annual fees? Do you have personal trainers?' You're training a client. They join the gym down the street that sent a full brochure and discount offer instantly.",
    painSpecific: "Gyms lose 40-60% of new membership enquiries to competitors — January, April, and October are peak seasons where every delayed reply costs a full-year membership",
    lossPerMiss: "₹3,000–15,000 per missed annual membership",
    industryHashtags: ["GymIndia", "FitnessIndia", "PersonalTrainer"],
  },
  lawyer: {
    label: "Lawyer / Legal",
    owner: "lawyer or legal consultant",
    scenario: "A client WhatsApps at 11pm: 'My employer terminated me unfairly today. I need legal advice urgently. Are you available tomorrow?' No reply overnight. By morning, stress took over and they found another lawyer through a friend.",
    painSpecific: "Lawyers lose high-value clients to faster-responding peers — urgent legal matters mean clients commit to the first lawyer who responds with empathy and clarity",
    lossPerMiss: "₹10,000–1,00,000 per missed case retainer",
    industryHashtags: ["LawyerIndia", "LegalAdvice", "Advocate"],
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

const PLATFORM_HASHTAG_RULES: Record<string, string> = {
  facebook: `HASHTAG RULES FOR FACEBOOK: Use 3-5 hashtags max. Avoid Instagram-specific tags (#InstaSeller, #InstaShop, #Reels, #IGPost, #InstaBusiness). Use broad community tags like #SmallBusiness #IndianEntrepreneur #BusinessTips.`,
  instagram: `HASHTAG RULES FOR INSTAGRAM: Use 8-12 hashtags. Mix broad (#SmallBusiness) + niche (#MeeshoSeller) + platform-specific (#InstaSeller #IGPost). Include at least 2 hashtags specific to Instagram culture.`,
  whatsapp: `HASHTAG RULES: Use 3-5 hashtags max. Keep them simple and broad.`,
  youtube: `HASHTAG RULES: Use 3-5 hashtags. Focus on search-optimized tags.`,
};

function buildGenerationPrompt(
  pillarType: keyof typeof PILLAR_CONTEXT,
  contentFormat: keyof typeof FORMAT_SCHEMAS,
  industry: keyof typeof INDUSTRY_CONTEXT,
  contentAngle: keyof typeof ANGLE_CONTEXT,
  season: keyof typeof SEASON_CONTEXT = "none",
  customPrompt?: string,
  platform?: string
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

  const hashtagRule = platform ? `\n\n${PLATFORM_HASHTAG_RULES[platform] ?? ""}` : "";

  return `${schema}

INDUSTRY: ${ind.label} (${ind.owner})
SPECIFIC SCENARIO TO USE: ${ind.scenario}
INDUSTRY PAIN STAT: ${ind.painSpecific}
COST PER MISSED LEAD: ${ind.lossPerMiss}

CONTENT ANGLE — ${angle.label.toUpperCase()}: ${angle.instruction}

PILLAR FOCUS — ${pillar.focus}
HOOK CONCEPT: ${pillar.hook}
KEY PROOF: ${pillar.proof}${seasonBlock}${hashtagRule}

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
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]).default("retail"),
        contentAngle: z.enum(["standard", "pov", "transformation", "comparison", "objection", "story"]).default("standard"),
        season: z.enum(["none", "diwali", "ipl", "back_to_school", "gst_season", "wedding", "summer"]).default("none"),
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("english"),
        customPrompt: z.string().optional(),
        existingTitles: z.array(z.string()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userPrompt = buildGenerationPrompt(
          input.pillarType as keyof typeof PILLAR_CONTEXT,
          input.contentFormat as keyof typeof FORMAT_SCHEMAS,
          input.industry as keyof typeof INDUSTRY_CONTEXT,
          input.contentAngle as keyof typeof ANGLE_CONTEXT,
          input.season as keyof typeof SEASON_CONTEXT,
          input.customPrompt,
          input.platform
        );

        const avoidNote = input.existingTitles && input.existingTitles.length > 0
          ? `\n\nIMPORTANT — these post concepts already exist in the library. Do NOT repeat them. Use a fresh angle, different hook, and different scenario:\n${input.existingTitles.map(t => `- ${t}`).join("\n")}`
          : "";

        const response = await invokeLLM({
          messages: [
            { role: "system", content: CONTENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt + avoidNote },
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

    generateABVariants: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("carousel"),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]).default("retail"),
        season: z.enum(["none", "diwali", "ipl", "back_to_school", "gst_season", "wedding", "summer"]).default("none"),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const VARIANT_ANGLES = ["standard", "transformation", "objection"] as const;
        const variants = await Promise.all(
          VARIANT_ANGLES.map(async (angle) => {
            const userPrompt = buildGenerationPrompt(
              input.pillarType as keyof typeof PILLAR_CONTEXT,
              input.contentFormat as keyof typeof FORMAT_SCHEMAS,
              input.industry as keyof typeof INDUSTRY_CONTEXT,
              angle,
              input.season as keyof typeof SEASON_CONTEXT,
              input.customPrompt,
              input.platform
            );
            const response = await invokeLLM({
              messages: [
                { role: "system", content: CONTENT_SYSTEM_PROMPT },
                { role: "user", content: userPrompt },
              ],
            });
            const contentText = typeof response.choices[0]?.message.content === "string"
              ? response.choices[0].message.content : "";
            let parsed: any = null;
            try {
              parsed = JSON.parse(contentText.replace(/^```json\s*|\s*```$/g, "").trim());
            } catch {}
            const hashtags = (Array.isArray(parsed?.hashtags)
              ? parsed.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ")
              : null) ?? "#GetMyAgent #AI #IndianBusiness";
            return { angle, label: { standard: "Variant A — Direct", transformation: "Variant B — Before/After", objection: "Variant C — Objection Busting" }[angle], content: contentText, parsed, hashtags };
          })
        );
        return { variants, format: input.contentFormat };
      }),

    translatePost: protectedProcedure
      .input(z.object({
        content: z.string(),
        targetLanguage: z.enum(["hinglish", "hindi", "tamil", "telugu", "bengali"]),
      }))
      .mutation(async ({ input }) => {
        const LANG_INSTRUCTIONS: Record<string, string> = {
          hinglish: "Translate to Hinglish — a natural mix of Hindi and English as spoken by urban Indians. Keep brand names, numbers, and ₹ amounts in English. Use Devanagari script ONLY for pure Hindi words, otherwise Roman script.",
          hindi: "Translate to pure Hindi in Devanagari script. Keep brand names (get-my-agent.com) and ₹ amounts in English.",
          tamil: "Translate to Tamil in Tamil script. Keep brand names and ₹ amounts in English.",
          telugu: "Translate to Telugu in Telugu script. Keep brand names and ₹ amounts in English.",
          bengali: "Translate to Bengali in Bengali script. Keep brand names and ₹ amounts in English.",
        };
        const response = await invokeLLM({
          messages: [
            { role: "system", content: `You are a social media translator. ${LANG_INSTRUCTIONS[input.targetLanguage]} Preserve all JSON structure and field names — only translate the VALUES. Return valid JSON only.` },
            { role: "user", content: input.content },
          ],
        });
        const translated = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content.trim() : input.content;
        let parsedTranslated: any = null;
        try {
          parsedTranslated = JSON.parse(translated.replace(/^```json\s*|\s*```$/g, "").trim());
        } catch {}
        return { content: translated, parsed: parsedTranslated };
      }),

    generateHooks: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]).default("retail"),
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
        mediaUrl: z.string().optional(),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).optional(),
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
          mediaUrl: input.mediaUrl,
          contentFormat: input.contentFormat,
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
        mediaUrl: z.string().optional().nullable(),
        postUrl: z.string().optional().nullable(),
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

    generateReelScript: protectedProcedure
      .input(z.object({
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
      }))
      .mutation(async ({ input }) => {
        const prompt = `You are a top-tier Instagram Reels strategist who has studied every viral business Reel from India in 2024-2025. Your scripts consistently get 500K+ views.

Create a 15-20 second Reel script from this post content. Optimize every second for the Instagram algorithm.

ALGORITHM FACTS (non-negotiable):
- Completion rate is #1 signal — 15-20 sec MAX, no padding
- Saves outweigh likes 5x — the save trigger must be genuinely useful, NOT just "save this post"
- Comments beat likes 3x — comment bait must be a binary YES/NO or fill-in-the-blank, never open-ended "what do you think?"
- Hook must create a PATTERN INTERRUPT in the first frame — unexpected visual or text that breaks the scroll

HOOK RULES (critical):
- Must create a curiosity gap OR make a bold/controversial claim
- Zero brand names in the hook — brand kills curiosity
- Options: "POV: you just lost a ₹50,000 order because..." / "Nobody tells Indian business owners this..." / "I tested 47 chatbots so you don't have to"
- Must feel like it was NOT made by a company

SAVE TRIGGER RULES (critical):
- Must be a CHECKLIST, numbered list, or specific fact people screenshot
- Bad: "Save this tip: use AI chatbot!" — this is just a CTA disguised as value
- Good: "Save this: 3 signs you need an AI chatbot — 1) you miss messages at night 2) response time >1 hr 3) losing repeat customers"
- The viewer should think "I'll screenshot this" before you tell them to save

COMMENT BAIT RULES (critical):
- Must be binary or one-word answer — high comment volume = more reach
- Bad: "What do you think?" — too vague, people scroll past
- Good: "Have you ever lost a customer because you replied too late? YES or NO 👇"
- Good: "How fast do you reply to leads? Comment your answer time ⬇️"
- Good: "Tag a business owner who still replies manually 👇"

Original post content:
${input.content}

Return ONLY valid JSON (no markdown fences):
{
  "hook": "ONE sentence, 8 words max — curiosity gap or bold claim, no brand name",
  "pattern_interrupt": "Specific unusual visual for frame 0: something jarring, unexpected, or counter-intuitive that stops scrolling — be specific about what's on screen",
  "sections": [
    {"time": "0:00-0:02", "label": "HOOK", "visual": "exact description of the jarring first frame", "script": "exact 8-word-max hook spoken out loud"},
    {"time": "0:02-0:08", "label": "PROBLEM", "visual": "specific visual showing the pain — person, scenario, numbers on screen", "script": "2 sentences max — name the exact painful moment with a ₹ or time number"},
    {"time": "0:08-0:14", "label": "SOLUTION", "visual": "phone screen showing AI replying instantly OR before/after split", "script": "1-2 sentences — the result in specific numbers, not vague benefits"},
    {"time": "0:14-0:18", "label": "SAVE TRIGGER", "visual": "numbered checklist on screen — 3 items — big readable text", "script": "read the checklist fast, say 'screenshot this' not 'save this post'"},
    {"time": "0:18-0:20", "label": "CTA", "visual": "close-up of commenter or comment section graphic", "script": "exact binary question — YES or NO format, or tag someone format"}
  ],
  "voiceover": "Full 20-second script as one paragraph — conversational Hinglish or English, fast-paced, sounds like a real person not an ad",
  "text_overlays": ["hook text verbatim", "key ₹ stat", "checklist line 1", "checklist line 2", "checklist line 3", "comment CTA"],
  "music_vibe": "Specific vibe: e.g. 'trending Bollywood item song, 128 BPM' or 'motivational background beat, no lyrics, 110 BPM'",
  "save_trigger": "The exact 3-item checklist or numbered fact that makes someone screenshot — write it out completely",
  "comment_question": "The exact binary or tag-someone question — copy-paste ready, includes emoji and YES/NO prompt or tag instruction",
  "caption": "First line = hook (same as reel hook). Line 2: expand the problem in 1 sentence. Line 3: the solution + result. Line 4: CTA (link in bio). Empty line. Hashtags on separate line.",
  "hashtags": ["Reels", "ReelsIndia", "BusinessTips", "SmallBusinessIndia", "AIForBusiness", "GetMyAgent", "ViralReels", "IndianEntrepreneur", "DigitalMarketing", "BusinessGrowth"]
}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a viral content strategist specializing in Instagram Reels for the Indian market. Return ONLY valid JSON." },
            { role: "user", content: prompt },
          ],
        });

        const contentText = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content : "";

        let parsed: any = null;
        try {
          const jsonStr = contentText.replace(/^```json\s*|\s*```$/g, "").trim();
          parsed = JSON.parse(jsonStr);
        } catch {
          // Return raw text if JSON fails
        }

        return { script: contentText, parsed };
      }),

    generateReelVideo: protectedProcedure
      .input(z.object({
        mode: z.enum(['slideshow', 'stock']),
        voiceover: z.string(),
        textOverlays: z.array(z.string()),
        sections: z.array(z.object({
          label: z.string(),
          visual: z.string(),
          script: z.string(),
        })),
        imageUrls: z.array(z.string()).optional(), // for slideshow mode
      }))
      .mutation(async ({ input }) => {
        const { generateSlideshowVideo, generateStockVideo } = await import('./_core/videoGen');
        const { ENV } = await import('./_core/env');

        const filename = `reel_${Date.now()}.mp4`;

        if (input.mode === 'slideshow') {
          const urls = input.imageUrls?.length
            ? input.imageUrls
            : [];
          if (!urls.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No images provided for slideshow' });

          const videoUrl = await generateSlideshowVideo({
            imageUrls: urls,
            textOverlays: input.textOverlays,
            voiceover: input.voiceover,
            outputFilename: filename,
          });
          return { videoUrl };
        }

        // stock mode — uses DALL-E per section, no Pexels needed
        const videoUrl = await generateStockVideo({
          sections: input.sections,
          textOverlays: input.textOverlays,
          voiceover: input.voiceover,
          outputFilename: filename,
        });
        return { videoUrl };
      }),

    bulkGenerate: protectedProcedure
      .input(z.object({
        pillarType: z.enum(["desi_business_owner", "five_minute_transformation", "roi_calculator"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("carousel"),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]).default("retail"),
        contentAngle: z.enum(["standard", "pov", "transformation", "comparison", "objection", "story"]).default("standard"),
        season: z.enum(["none", "diwali", "ipl", "back_to_school", "gst_season", "wedding", "summer"]).default("none"),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]).default("instagram"),
        count: z.number().min(1).max(14).default(7),
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
              undefined,
              input.platform
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
              // Optimal posting hours per platform (local time)
              const optimalHour: Record<string, number> = {
                facebook: 13,   // 1pm — peak engagement Wed/Thu
                instagram: 18,  // 6pm — peak Mon–Fri evening
                whatsapp: 9,    // 9am — professional hours
                youtube: 15,    // 3pm — weekend afternoon
              };
              scheduledAt.setHours(optimalHour[input.platform] ?? 9, 0, 0, 0);
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
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("feed_post"),
        hook: z.string(),
        postContent: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { prompt } = await generateVisualPromptWithLLM(input.industry, input.contentFormat, input.hook, input.postContent);
        const dalleSize = buildVisualDalleSize(input.contentFormat);
        const { b64, mimeType } = await generateDalleImage(prompt, dalleSize);
        const buffer = Buffer.from(b64, "base64");

        // Save locally, fall back to cloud storage if configured
        const filename = `visual_${Date.now()}.jpg`;
        const localDir = path.join(process.cwd(), "public", "uploads");
        fs.mkdirSync(localDir, { recursive: true });
        fs.writeFileSync(path.join(localDir, filename), buffer);
        const url = `/uploads/${filename}`;

        return { url, prompt };
      }),

    listGeneratedImages: protectedProcedure
      .query(() => {
        const localDir = path.join(process.cwd(), "public", "uploads");
        try {
          const files = fs.readdirSync(localDir)
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .map(f => ({
              url: `/uploads/${f}`,
              filename: f,
              createdAt: fs.statSync(path.join(localDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.createdAt - a.createdAt);
          return { images: files };
        } catch {
          return { images: [] };
        }
      }),

    generateVideo: protectedProcedure
      .input(z.object({
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]),
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
            { role: "system", content: `You are a social media hashtag expert for the Indian market. Suggest relevant, trending hashtags.\n${PLATFORM_HASHTAG_RULES[input.platform] ?? ""}` },
            { role: "user", content: `Suggest hashtags for this ${input.platform} post. ${input.platform === 'facebook' ? 'Use 3-5 hashtags only. NO Instagram-specific tags.' : 'Use 8-12 hashtags.'} Return ONLY the hashtags separated by spaces, no explanations:\n\n${input.content}` },
          ],
        });
        const hashtags = typeof response.choices[0]?.message.content === 'string'
          ? response.choices[0].message.content.trim() : "";
        return { hashtags };
      }),

    optimizeEmojis: protectedProcedure
      .input(z.object({
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]),
      }))
      .mutation(async ({ input }) => {
        const platformGuide: Record<string, string> = {
          instagram: "Instagram: use 3–6 emojis per post. Place at start of lines and before CTA. Use energy emojis: 🔥💰📈✅🎯💬🚀",
          facebook: "Facebook: use 1–3 emojis. Subtle placement. Prefer professional tone: ✅📊💡👉🤝",
          whatsapp: "WhatsApp: use 2–4 emojis. Conversational tone: 👋😊✅💬📞",
          youtube: "YouTube: use 1–2 emojis in hook only. Keep clean: 🎯💡",
        };
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a social media emoji optimization expert. Return ONLY the rewritten text with no explanation." },
            { role: "user", content: `Optimize emoji usage in this post for ${input.platform}.\n${platformGuide[input.platform]}\nRules: don't change any words, only add/remove/reposition emojis. Keep all ₹ amounts and brand names intact.\n\nOriginal:\n${input.content}` },
          ],
        });
        const optimized = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content.trim() : input.content;
        return { optimized };
      }),

    repurposeContent: protectedProcedure
      .input(z.object({
        content: z.string(),
        sourceFormat: z.enum(["carousel", "reel", "story", "feed_post"]),
        targetFormat: z.enum(["carousel", "reel", "story", "feed_post"]),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]),
      }))
      .mutation(async ({ input }) => {
        const schema = FORMAT_SCHEMAS[input.targetFormat];
        const ind = INDUSTRY_CONTEXT[input.industry as keyof typeof INDUSTRY_CONTEXT];
        const prompt = `Here is existing ${input.sourceFormat} content:\n\n${input.content}\n\nRepurpose this into a ${input.targetFormat} for a ${ind.owner}. Keep the same core message, industry scenario, and ₹ numbers. Apply this format:\n${schema}\n\nReturn ONLY valid JSON. No markdown fences.`;
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
        } catch {}
        const hashtags = Array.isArray(parsed?.hashtags)
          ? parsed.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ") : "";
        return { content: contentText, parsed, format: input.targetFormat, hashtags };
      }),

    rssToPost: protectedProcedure
      .input(z.object({
        rssUrl: z.string().url(),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]),
        contentFormat: z.enum(["carousel", "reel", "story", "feed_post"]).default("feed_post"),
        platform: z.enum(["facebook", "instagram", "whatsapp", "youtube"]).default("instagram"),
      }))
      .mutation(async ({ input }) => {
        let xml = "";
        try {
          const res = await fetch(input.rssUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ContentBot/1.0)" },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          xml = await res.text();
        } catch (e: any) {
          throw new Error(`RSS fetch failed: ${e.message}`);
        }

        const items: { title: string; desc: string }[] = [];
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        for (const m of itemMatches) {
          const block = m[1];
          const title = (block.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ?? block.match(/<title>([^<]+)<\/title>/))?.[1]?.trim() ?? "";
          const desc = (block.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/) ?? block.match(/<description>([^<]+)<\/description>/))?.[1]?.trim() ?? "";
          if (title) items.push({ title, desc: desc.replace(/<[^>]+>/g, "").slice(0, 300) });
          if (items.length >= 1) break;
        }
        if (items.length === 0) throw new Error("No items found in RSS feed");

        const article = items[0];
        const ind = INDUSTRY_CONTEXT[input.industry as keyof typeof INDUSTRY_CONTEXT];
        const schema = FORMAT_SCHEMAS[input.contentFormat as keyof typeof FORMAT_SCHEMAS];
        const prompt = `News headline: "${article.title}"${article.desc ? `\nSummary: ${article.desc}` : ""}\n\nCreate a ${input.contentFormat} social media post for a ${ind.owner} using this news as a hook to show why they need an AI chatbot. Connect it to: ${ind.painSpecific}.\n\nApply this format:\n${schema}\n\nReturn ONLY valid JSON. No markdown fences.`;

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
        } catch {}
        const hashtags = Array.isArray(parsed?.hashtags)
          ? parsed.hashtags.map((h: string) => h.startsWith("#") ? h : `#${h}`).join(" ") : "#GetMyAgent #AI";
        return { content: contentText, parsed, format: input.contentFormat, hashtags, sourceTitle: article.title };
      }),

    analyzeCompetitors: protectedProcedure
      .input(z.object({
        keyword: z.string().min(2),
        industry: z.enum(["retail", "real_estate", "restaurant", "ecommerce", "coaching", "services", "insurance_agent", "loan_agent", "ca_tax", "travel_agent", "wedding_planner", "interior_designer", "clinic_doctor", "car_dealer", "salon_beauty", "gym_fitness", "lawyer"]),
        geo: z.enum(["IN", "US", "GB", "AU", "SG"]).default("IN"),
      }))
      .mutation(async ({ input }) => {
        // Fetch Google News RSS for the keyword + industry
        const q = encodeURIComponent(`${input.keyword} ${INDUSTRY_CONTEXT[input.industry as keyof typeof INDUSTRY_CONTEXT].label} India`);
        const newsUrl = `https://news.google.com/rss/search?q=${q}&hl=en-${input.geo}&gl=${input.geo}&ceid=${input.geo}:en`;

        const headlines: { title: string; desc: string; source: string }[] = [];
        try {
          const res = await fetch(newsUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)" },
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            const xml = await res.text();
            const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
            for (const m of itemMatches) {
              const block = m[1];
              const title = (block.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) ?? block.match(/<title>([^<]+)<\/title>/))?.[1]?.trim() ?? "";
              const desc = (block.match(/<description><!\[CDATA\[([^\]]+)\]\]><\/description>/) ?? block.match(/<description>([^<]+)<\/description>/))?.[1]?.trim() ?? "";
              const src = block.match(/<source[^>]*>([^<]+)<\/source>/)?.[1]?.trim() ?? "";
              if (title) headlines.push({ title, desc: desc.replace(/<[^>]+>/g, "").slice(0, 200), source: src });
              if (headlines.length >= 15) break;
            }
          }
        } catch {}

        const ind = INDUSTRY_CONTEXT[input.industry as keyof typeof INDUSTRY_CONTEXT];
        const headlinesText = headlines.length > 0
          ? headlines.map((h, i) => `${i + 1}. "${h.title}"${h.source ? ` (${h.source})` : ""}${h.desc ? `\n   Summary: ${h.desc}` : ""}`).join("\n\n")
          : `No live news found — analyze general content patterns for "${input.keyword}" in ${ind.label} industry`;

        const analysisPrompt = `You are a social media competitive intelligence analyst for get-my-agent.com (AI chatbot for Indian small businesses).

Industry: ${ind.label}
Keyword/Niche: "${input.keyword}"

Recent content from competitors and media in this space:
${headlinesText}

Analyze this content landscape and return a JSON object:
{
  "dominantAngles": ["top 3-4 content angles competitors are using (e.g. 'cost savings', 'speed', 'success stories')"],
  "commonHooks": ["3-4 hook styles appearing most often"],
  "contentGaps": ["3-4 topics/angles NOT being covered that represent an opportunity"],
  "competitorWeaknesses": ["2-3 weaknesses in current competitor content (e.g. 'too generic', 'no India-specific numbers', 'no urgency')"],
  "differentiationAngles": ["4-5 specific angles get-my-agent.com should use to stand out — be very specific with ₹ numbers and Indian scenarios"],
  "recommendedHooks": [
    {"hook": "specific hook text", "why": "why this will outperform competitors"},
    {"hook": "specific hook text", "why": "why this will outperform competitors"},
    {"hook": "specific hook text", "why": "why this will outperform competitors"}
  ],
  "summary": "2-sentence executive summary of the competitive landscape"
}

Return ONLY valid JSON. No markdown fences.`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are a competitive intelligence expert for Indian social media marketing. Return ONLY valid JSON." },
            { role: "user", content: analysisPrompt },
          ],
        });

        const responseText = typeof response.choices[0]?.message.content === "string"
          ? response.choices[0].message.content : "{}";
        let analysis: any = {};
        try {
          const jsonStr = responseText.replace(/^```json\s*|\s*```$/g, "").trim();
          analysis = JSON.parse(jsonStr);
        } catch {}

        return {
          analysis,
          headlinesAnalyzed: headlines.length,
          keyword: input.keyword,
          industry: ind.label,
        };
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

    // ── Saved Topics ───────────────────────────────────────────────────────────
    listSavedTopics: protectedProcedure
      .query(async ({ ctx }) => {
        return getSavedTopics(ctx.user.id);
      }),

    saveTopic: protectedProcedure
      .input(z.object({ keyword: z.string().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        await saveTopic(ctx.user.id, input.keyword.trim());
        return { ok: true };
      }),

    deleteTopic: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteTopic(ctx.user.id, input.id);
        return { ok: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
