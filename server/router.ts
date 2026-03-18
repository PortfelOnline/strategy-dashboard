import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import * as botManager from "./bots.js";
import * as orch from "./orchestrator.js";

const t = initTRPC.context<Record<string, never>>().create();
const procedure = t.procedure;

const googleDocsSchema = z.object({
  global: z.object({
    proxies: z.string().url(),
    queries: z.string().url(),
    warmup_queries: z.string().url(),
  }),
  websites: z.record(z.string(), z.string().url()),
});

const botEntrySchema = z.object({
  botId: z.number().int().min(1).max(1000),
  website: z.string().url(),
  enabled: z.boolean(),
});

const orchestratorConfigSchema = z.object({
  enabled: z.boolean(),
  maxConcurrent: z.number().int().min(1).max(20),
  resourcePct: z.number().int().min(10).max(100).default(50),
  restartDelayMin: z.number().int().min(1).max(1440),
  dailyStartHour: z.number().int().min(0).max(23),
  dailyEndHour: z.number().int().min(1).max(24),
  skipTimeCheck: z.boolean().default(false),
  bots: z.array(botEntrySchema),
});

export const botsRouter = t.router({
  list: procedure.query(() => {
    const running = botManager.getRunningBots();
    const runningIds = new Set(running.map((b) => b.botId));

    // Collect all known bot IDs: state files + orchestrator config
    const knownIds = new Set(botManager.listKnownBotIds());
    const orchBots = orch.getOrchestratorConfig().bots;
    for (const b of orchBots) knownIds.add(b.botId);

    const stopped = [...knownIds]
      .filter((id) => !runningIds.has(id))
      .map((id) => ({ botId: id, status: "stopped" as const, state: botManager.getBotState(id) }));

    const runningWithState = running.map((b) => ({
      ...b,
      status: "running" as const,
      state: botManager.getBotState(b.botId),
    }));

    return {
      bots: [...runningWithState, ...stopped].sort((a, b) => a.botId - b.botId),
      proxyStats: botManager.getProxyStats(),
    };
  }),

  start: procedure
    .input(z.object({ botId: z.number().int().min(1).max(1000), mode: z.enum(["warmup", "target"]), website: z.string().url() }))
    .mutation(({ input }) => botManager.startBot(input.botId, input.mode, input.website)),

  stop: procedure
    .input(z.object({ botId: z.number().int() }))
    .mutation(({ input }) => botManager.stopBot(input.botId)),

  logs: procedure
    .input(z.object({ botId: z.number().int(), lines: z.number().int().default(150) }))
    .query(({ input }) => ({ logs: botManager.getBotLogs(input.botId, input.lines) })),

  clearCache: procedure.mutation(() => { botManager.clearProxyCache(); return { success: true }; }),
  clearBlacklist: procedure.mutation(() => { botManager.clearProxyBlacklist(); return { success: true }; }),

  // --- Proxies ---
  proxyList: procedure.query(() => {
    const { proxies } = botManager.getProxies();
    const blacklist = botManager.getProxyBlacklist();
    const now = new Date();
    return proxies.map((p) => ({
      proxy: p,
      banned: p in blacklist && new Date(blacklist[p]) > now,
      banUntil: blacklist[p] ?? null,
    }));
  }),

  proxyAdd: procedure
    .input(z.object({ text: z.string() }))
    .mutation(({ input }) => botManager.addProxies(input.text.split("\n").map((l) => l.trim()).filter(Boolean))),

  proxyReplace: procedure
    .input(z.object({ text: z.string() }))
    .mutation(({ input }) => botManager.replaceProxies(input.text.split("\n").map((l) => l.trim()).filter(Boolean))),

  proxyDelete: procedure
    .input(z.object({ proxy: z.string() }))
    .mutation(({ input }) => botManager.deleteProxy(input.proxy)),

  // --- Google Docs ---
  googleDocs: procedure.query(() => botManager.getGoogleDocs()),

  setGoogleDocs: procedure
    .input(googleDocsSchema)
    .mutation(({ input }) => { botManager.setGoogleDocs(input); return { success: true }; }),

  // --- Orchestrator ---
  orchestratorConfig: procedure.query(() => orch.getOrchestratorConfig()),
  orchestratorStatus: procedure.query(() => orch.getOrchestratorStatus()),
  detectedResources: procedure.query(() => orch.getDetectedResources()),

  setOrchestratorConfig: procedure
    .input(orchestratorConfigSchema)
    .mutation(({ input }) => { orch.saveOrchestratorConfig(input); return { success: true }; }),

  // --- VNC ---
  vncStart: procedure
    .input(z.object({ botId: z.number().int().min(1).max(1000) }))
    .mutation(({ input }) => {
      const result = botManager.startVnc(input.botId);
      // null = display not alive (bot never started); sleeping = browser not open yet
      if (!result) return { sleeping: true, display: 0, containerIp: '' };
      return result;
    }),

  vncStop: procedure
    .mutation(() => { botManager.stopVnc(); return { success: true }; }),
});

export type BotsRouter = typeof botsRouter;
