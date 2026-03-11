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

// ─── Content generation helpers ────────────────────────────────────────────

const CONTENT_SYSTEM_PROMPT = `You are a high-converting social media copywriter for get-my-agent.com.
Product: AI chatbot for Indian small businesses on WhatsApp, Instagram, and websites.
Pricing: from ₹999/month. Key features: 24/7 instant replies (<3 seconds), automatic lead capture to CRM.
Target audience: Indian small business owners — retail shops, e-commerce, real estate, restaurants, service businesses.

Rules:
- Write ONLY in English. No Hindi, Hinglish, or regional language words.
- Be direct and conversion-focused. Every word should move the reader toward action.
- Use specific ₹ amounts and numbers to make benefits tangible.
- CRITICAL: Respond with valid JSON only. No markdown code fences. No explanation text outside the JSON object.`;

const PILLAR_CONTEXT = {
  desi_business_owner: {
    hook: "Your competitor just replied to that customer enquiry. You didn't.",
    painPoint: "Indian SMBs miss 25-40% of customer messages outside business hours, losing sales to whoever responds first",
    proof: "78% of customers buy from the first business that responds to their inquiry",
    solution: "AI agent replies to every WhatsApp/Instagram message in under 3 seconds, 24/7 — even at 3am on Sundays",
  },
  five_minute_transformation: {
    hook: "Set up a 24/7 AI sales agent in less time than it takes to finish your chai",
    painPoint: "Most business owners think AI is complex, expensive, and requires a tech team — so they delay and keep losing leads",
    proof: "Average setup takes under 10 minutes. No coding. No IT team. First automated reply the same day.",
    solution: "Connect WhatsApp or Instagram, customise your responses, go live — one-time setup, runs itself forever",
  },
  roi_calculator: {
    hook: "₹999/month vs ₹15,000-30,000/month. Same job. Which would you choose?",
    painPoint: "Hiring customer service staff is expensive, unreliable, and still leaves gaps — nights, weekends, holidays",
    proof: "Customers save an average ₹14,000+/month while handling 3x more customer conversations",
    solution: "AI handles unlimited conversations for a flat monthly fee — no salary, no benefits, no sick days",
  },
} as const;

const FORMAT_SCHEMAS = {
  carousel: `Create a 6-slide Instagram Carousel. Return exactly this JSON (no other text):
{
  "slides": [
    {"num": 1, "label": "Cover", "headline": "scroll-stopping headline 6 words max", "sub": "compelling subtitle 10 words max"},
    {"num": 2, "label": "The Problem", "headline": "relatable problem statement", "points": ["specific pain point 1", "specific pain point 2", "specific pain point 3"]},
    {"num": 3, "label": "The Reality", "headline": "reality-check headline", "stat": "shocking specific statistic", "context": "one sentence of context"},
    {"num": 4, "label": "The Solution", "headline": "solution headline", "points": ["benefit 1 with ₹ or number", "benefit 2 with ₹ or number", "benefit 3 with ₹ or number"]},
    {"num": 5, "label": "Results", "headline": "results headline", "quote": "compelling proof point or customer result", "source": "type of business owner"},
    {"num": 6, "label": "Get Started", "headline": "action-oriented headline", "sub": "Try free → get-my-agent.com"}
  ],
  "caption": "Instagram caption — hook sentence, value prop, CTA — 150 chars max",
  "hashtags": ["IndiaSmallBusiness", "AIForBusiness", "WhatsAppBusiness", "BusinessTips", "IndianEntrepreneur", "DigitalIndia", "GetMyAgent", "AIAgent", "SmallBusiness", "CustomerService"]
}`,

  reel: `Create a 30-45 second Instagram Reel script. Return exactly this JSON (no other text):
{
  "sections": [
    {"time": "0:00-0:03", "label": "HOOK", "visual": "what is shown on screen", "audio": "exact shocking opening words or text"},
    {"time": "0:03-0:12", "label": "PROBLEM", "visual": "visual demonstration idea", "audio": "relatable pain point in 2 sentences"},
    {"time": "0:12-0:25", "label": "SOLUTION", "visual": "product demo description", "audio": "how AI agent solves it with specifics"},
    {"time": "0:25-0:35", "label": "PROOF", "visual": "numbers or results shown on screen", "audio": "specific result or stat"},
    {"time": "0:35-0:45", "label": "CTA", "visual": "website URL on screen", "audio": "single clear action"}
  ],
  "voiceover": "complete 45-second spoken script as one continuous paragraph",
  "text_overlays": ["overlay 1", "overlay 2", "overlay 3", "overlay 4", "overlay 5"],
  "caption": "reel caption — hook + CTA",
  "hashtags": ["Reels", "IndiaSmallBusiness", "AIForBusiness", "BusinessTips", "GetMyAgent", "AIAgent", "WhatsAppMarketing", "IndianEntrepreneur", "DigitalMarketing", "GrowthHack"]
}`,

  story: `Create a 3-frame Instagram Story sequence. Return exactly this JSON (no other text):
{
  "frames": [
    {"num": 1, "label": "Hook", "emoji": "relevant emoji", "main_text": "4-word max bold statement", "sub_text": "supporting detail one line"},
    {"num": 2, "label": "Content", "emoji": "relevant emoji", "main_text": "content headline", "sub_text": "brief context", "list": ["key point 1", "key point 2", "key point 3"]},
    {"num": 3, "label": "CTA", "emoji": "🚀", "main_text": "action headline", "sub_text": "get-my-agent.com", "button_text": "Try Free →"}
  ],
  "poll": {"question": "engaging poll question", "yes": "Yes option text", "no": "No option text"},
  "question_sticker": "open question to drive DMs"
}`,

  feed_post: `Create an Instagram Feed Post. Return exactly this JSON (no other text):
{
  "hook": "first line that stops the scroll — one punchy sentence max 10 words",
  "paragraphs": [
    "paragraph 1: establish the pain point — 2-3 sentences",
    "paragraph 2: introduce the solution with specifics — 2-3 sentences",
    "paragraph 3: add proof or overcome main objection — 2-3 sentences"
  ],
  "cta": "single clear action sentence",
  "caption": "full ready-to-post caption with hook + body + CTA, 300 words max, line breaks between paragraphs",
  "hashtags": ["IndiaSmallBusiness", "AIForBusiness", "WhatsAppBusiness", "BusinessTips", "IndianEntrepreneur", "DigitalIndia", "GetMyAgent", "AIAgent", "SmallBusiness", "CustomerService", "BusinessAutomation", "StartupIndia", "SalesAgent", "ChatbotIndia", "BusinessGrowth"]
}`,
} as const;

function buildGenerationPrompt(
  pillarType: keyof typeof PILLAR_CONTEXT,
  contentFormat: keyof typeof FORMAT_SCHEMAS,
  customPrompt?: string
): string {
  const pillar = PILLAR_CONTEXT[pillarType];
  const schema = FORMAT_SCHEMAS[contentFormat];
  return `${schema}

Content angle:
- Hook: ${pillar.hook}
- Pain point: ${pillar.painPoint}
- Proof/stat: ${pillar.proof}
- Solution: ${pillar.solution}${customPrompt ? `\n- Extra instructions: ${customPrompt}` : ""}`;
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
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("english"),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const userPrompt = buildGenerationPrompt(
          input.pillarType as keyof typeof PILLAR_CONTEXT,
          input.contentFormat as keyof typeof FORMAT_SCHEMAS,
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
        return result;
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
  }),
});

export type AppRouter = typeof appRouter;
