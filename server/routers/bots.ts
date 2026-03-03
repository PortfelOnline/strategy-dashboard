import { router, protectedProcedure } from '../_core/trpc';
import { z } from 'zod';
import * as botManager from '../bots';

export const botsRouter = router({
  list: protectedProcedure.query(() => {
    const running = botManager.getRunningBots();
    const runningIds = new Set(running.map(b => b.botId));
    const knownIds = botManager.listKnownBotIds();

    const stopped = knownIds
      .filter(id => !runningIds.has(id))
      .map(id => ({ botId: id, status: 'stopped' as const, state: botManager.getBotState(id) }));

    const runningWithState = running.map(b => ({
      ...b,
      status: 'running' as const,
      state: botManager.getBotState(b.botId),
    }));

    return {
      bots: [...runningWithState, ...stopped].sort((a, b) => a.botId - b.botId),
      proxyStats: botManager.getProxyStats(),
    };
  }),

  start: protectedProcedure
    .input(z.object({
      botId: z.number().int().min(1).max(100),
      mode: z.enum(['warmup', 'target']),
      website: z.string().url(),
    }))
    .mutation(({ input }) => botManager.startBot(input.botId, input.mode, input.website)),

  stop: protectedProcedure
    .input(z.object({ botId: z.number().int() }))
    .mutation(({ input }) => botManager.stopBot(input.botId)),

  logs: protectedProcedure
    .input(z.object({ botId: z.number().int(), lines: z.number().int().default(150) }))
    .query(({ input }) => ({ logs: botManager.getBotLogs(input.botId, input.lines) })),

  clearCache: protectedProcedure.mutation(() => { botManager.clearProxyCache(); return { success: true }; }),
  clearBlacklist: protectedProcedure.mutation(() => { botManager.clearProxyBlacklist(); return { success: true }; }),
});
