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
      .map((id) => ({ botId: id, status: "stopped" as const, state: botManager.getBotState(id), lastActivity: botManager.getBotLastActivity(id), isBrowsing: false }));

    const runningWithState = running.map((b) => ({
      ...b,
      status: "running" as const,
      state: botManager.getBotState(b.botId),
      lastActivity: botManager.getBotLastActivity(b.botId),
      isBrowsing: botManager.isBotBrowsing(b.botId),
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

  // --- Captcha Stats ---
  captchaStats: procedure.query(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { execFileSync } = await import('child_process');
    const today = new Date().toISOString().split('T')[0];
    const botDir = process.env.BOT_DIR || '/bot_work';

    // 2captcha daily solves (from atomic counter file)
    let dailyCount2cap = 0;
    const max2cap = parseInt(process.env.CAPTCHA_2CAPTCHA_MAX_DAILY || '15');
    try {
      const dailyFile = path.join(botDir, 'work', '2captcha_daily.json');
      const parsed = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
      if (parsed.date === today) dailyCount2cap = parseInt(parsed.count) || 0;
    } catch {}

    // Count attempts and capsolver calls from today's logs via grep
    let attempts2cap = 0, attemptsCapsolver = 0, capsolverErrors = 0;
    try {
      const container = process.env.BOT_CONTAINER;
      const logsDir = container ? '/app/logs' : path.join(botDir, 'logs');
      const grepCmd = container ? 'docker' : 'grep';
      const baseArgs = container ? ['exec', container, 'grep', '-rh', '--include=*.log'] : ['-rh', '--include=*.log'];
      const getCount = (pattern: string) => {
        try {
          const args = [...baseArgs, pattern, logsDir];
          const out = execFileSync(grepCmd === 'docker' ? 'docker' : 'grep', args, { encoding: 'utf8' });
          return out.split('\n').filter(l => l.includes(today)).length;
        } catch { return 0; }
      };
      attempts2cap = getCount('Calling 2captcha.com');
      attemptsCapsolver = getCount('Calling capsolver fallback');
      capsolverErrors = getCount('capsolver rejected task');
    } catch {}

    // History file: {date: {count2cap, attemptsCapsolver}}
    const histFile = path.join(botDir, 'outputs', 'captcha_history.json');
    let history: Record<string, { count2cap: number; attemptsCapsolver: number }> = {};
    try { history = JSON.parse(fs.readFileSync(histFile, 'utf-8')); } catch {}
    // Update today's entry
    history[today] = { count2cap: dailyCount2cap, attemptsCapsolver };
    // Keep last 14 days
    const allDates = Object.keys(history).sort();
    if (allDates.length > 14) {
      for (const d of allDates.slice(0, allDates.length - 14)) delete history[d];
    }
    try { fs.writeFileSync(histFile, JSON.stringify(history, null, 2)); } catch {}
    // Last 7 days for display
    const last7 = Object.keys(history).sort().slice(-7).map(d => ({ date: d, ...history[d] }));

    // 2captcha balance
    let balance2cap: number | null = null;
    const key2cap = process.env.CAPTCHA_2CAPTCHA_KEY || '';
    if (key2cap) {
      try {
        const res = await fetch(`https://2captcha.com/res.php?key=${key2cap}&action=getbalance&json=1`);
        const parsed = await res.json() as { status: number; request: string };
        if (parsed.status === 1) balance2cap = parseFloat(parsed.request);
      } catch {}
    }

    // Capsolver balance
    let balanceCapsolver: number | null = null;
    const keyCap = process.env.CAPTCHA_CAPSOLVER_KEY || '';
    if (keyCap) {
      try {
        const res = await fetch('https://api.capsolver.com/getBalance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientKey: keyCap }),
        });
        const parsed = await res.json() as { errorId: number; balance: number };
        if (parsed.errorId === 0) balanceCapsolver = parsed.balance;
      } catch {}
    }

    // Cost estimate: 2captcha ~$0.003/solve, capsolver ~$0.002/solve
    const costToday = dailyCount2cap * 0.003;

    return {
      twoCaptcha: { dailyCount: dailyCount2cap, maxDaily: max2cap, attempts: attempts2cap, balance: balance2cap, configured: !!key2cap },
      capsolver: { attempts: attemptsCapsolver, errors: capsolverErrors, balance: balanceCapsolver, configured: !!keyCap },
      costToday,
      history: last7,
    };
  }),
});

export type BotsRouter = typeof botsRouter;
