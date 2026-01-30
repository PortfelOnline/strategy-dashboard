import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import { createContentPost, getUserContentPosts, getContentTemplates, createContentTemplate } from "./db";

export const appRouter = router({
  system: systemRouter,
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
        platform: z.enum(["facebook", "instagram", "whatsapp"]),
        language: z.enum(["hinglish", "hindi", "english", "tamil", "telugu", "bengali"]).default("hinglish"),
        customPrompt: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const prompts: Record<string, string> = {
          desi_business_owner: "Create a viral Instagram Reel script for Indian business owners. Use Hinglish and humor to show the struggle of manual customer service vs AI. Include a hook like 'When a customer pings at 2:00 AM'. Make it relatable and funny. Keep it under 150 words.",
          five_minute_transformation: `Create a fast-paced 5-minute transformation script for setting up an AI consultant. Show the entire onboarding process in real-time. Use language: ${input.language}. Include a visible timer concept. Keep it engaging and under 150 words.`,
          roi_calculator: "Create a carousel post or video script about ROI and cost savings. Compare hiring a full-time employee (₹15,000-30,000/month) vs AI agent (₹2,000/month). Use 'Paisa Vasool' concept. Keep it under 150 words.",
        };

        const systemPrompt = "You are a social media content expert for the Indian market. Create engaging, viral-worthy content that resonates with Indian business owners. Use cultural references, humor, and local language preferences. Always include relevant hashtags and emojis.";
        
        const userPrompt = input.customPrompt || prompts[input.pillarType];

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        });

        const contentText = typeof response.choices[0]?.message.content === 'string' 
          ? response.choices[0].message.content 
          : "";
        
        const hashtagMatch = contentText.match(/#\w+/g);
        const hashtags = hashtagMatch ? hashtagMatch.join(" ") : "#GetMyAgent #AI #IndianBusiness";

        return {
          content: contentText,
          hashtags,
          platform: input.platform,
          language: input.language,
          pillarType: input.pillarType,
        };
      }),

    savePost: protectedProcedure
      .input(z.object({
        title: z.string(),
        content: z.string(),
        platform: z.enum(["facebook", "instagram", "whatsapp"]),
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
        platform: z.enum(["facebook", "instagram", "whatsapp", "all"]),
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
  }),
});

export type AppRouter = typeof appRouter;
