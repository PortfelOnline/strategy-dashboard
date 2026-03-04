import * as fs from 'fs';
import * as path from 'path';
import { getBotDir, startBot, getRunningBots, getBotState } from './bots';

export interface BotEntry {
  botId: number;
  website: string;
  enabled: boolean;
}

export interface OrchestratorConfig {
  enabled: boolean;
  maxConcurrent: number;
  restartDelayMin: number; // minutes to wait before re-queuing a finished bot
  dailyStartHour: number;  // 0–23: start of allowed window
  dailyEndHour: number;    // 1–24: end of allowed window (exclusive)
  bots: BotEntry[];
}

export interface PendingEntry {
  botId: number;
  website: string;
  restartAt: string; // ISO
}

export interface OrchestratorStatus {
  active: boolean;
  managedBots: number[];
  queue: Array<{ botId: number; website: string }>;
  pending: PendingEntry[];
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  enabled: false,
  maxConcurrent: 3,
  restartDelayMin: 30,
  dailyStartHour: 8,
  dailyEndHour: 22,
  bots: [],
};

const WARMUP_DAYS_THRESHOLD = 14;
const TICK_INTERVAL_MS = 30_000;

// Runtime state (in-memory, reset on server restart)
const managedBots = new Set<number>();
const pendingRestart = new Map<number, { website: string; restartAt: Date }>();
const queue: Array<{ botId: number; website: string }> = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;

function configFile(): string {
  return path.join(getBotDir(), 'outputs', 'orchestrator.json');
}

export function getOrchestratorConfig(): OrchestratorConfig {
  try {
    const f = configFile();
    if (fs.existsSync(f)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function saveOrchestratorConfig(config: OrchestratorConfig): void {
  const dir = path.join(getBotDir(), 'outputs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

function isWithinWindow(config: OrchestratorConfig): boolean {
  const hour = new Date().getHours();
  return hour >= config.dailyStartHour && hour < config.dailyEndHour;
}

function autoMode(botId: number): 'warmup' | 'target' {
  const state = getBotState(botId);
  const days = (state?.warmup_days as number | undefined) ?? 0;
  return days >= WARMUP_DAYS_THRESHOLD ? 'target' : 'warmup';
}

function tick(): void {
  const config = getOrchestratorConfig();
  if (!config.enabled) return;
  if (!isWithinWindow(config)) return;

  const now = new Date();
  const running = getRunningBots();
  const runningIds = new Set(running.map(b => b.botId));

  // 1. Detect managed bots that have finished → schedule restart
  for (const botId of Array.from(managedBots)) {
    if (!runningIds.has(botId)) {
      managedBots.delete(botId);
      const entry = config.bots.find(b => b.botId === botId && b.enabled);
      if (entry && !pendingRestart.has(botId)) {
        const restartAt = new Date(now.getTime() + config.restartDelayMin * 60_000);
        pendingRestart.set(botId, { website: entry.website, restartAt });
      }
    }
  }

  // 2. Move ready pending-restarts to queue
  for (const [botId, entry] of Array.from(pendingRestart.entries())) {
    if (entry.restartAt <= now) {
      pendingRestart.delete(botId);
      if (!runningIds.has(botId) && !queue.some(q => q.botId === botId)) {
        queue.push({ botId, website: entry.website });
      }
    }
  }

  // 3. Add enabled bots not yet anywhere → initial population
  for (const b of config.bots) {
    if (!b.enabled) continue;
    if (runningIds.has(b.botId)) continue;
    if (managedBots.has(b.botId)) continue;
    if (pendingRestart.has(b.botId)) continue;
    if (queue.some(q => q.botId === b.botId)) continue;
    queue.push({ botId: b.botId, website: b.website });
  }

  // 4. Remove disabled bots from queue
  const enabledIds = new Set(config.bots.filter(b => b.enabled).map(b => b.botId));
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!enabledIds.has(queue[i].botId)) queue.splice(i, 1);
  }

  // 5. Start from queue up to maxConcurrent
  let runningCount = runningIds.size;
  while (runningCount < config.maxConcurrent && queue.length > 0) {
    const next = queue.shift()!;
    if (runningIds.has(next.botId) || managedBots.has(next.botId)) continue;
    const mode = autoMode(next.botId);
    try {
      startBot(next.botId, mode, next.website);
      managedBots.add(next.botId);
      runningIds.add(next.botId);
      runningCount++;
    } catch {
      // already running or error — skip silently
    }
  }
}

export function initOrchestrator(): void {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  tick();
}

export function getOrchestratorStatus(): OrchestratorStatus {
  return {
    active: tickTimer !== null && getOrchestratorConfig().enabled,
    managedBots: Array.from(managedBots),
    queue: [...queue],
    pending: Array.from(pendingRestart.entries()).map(([botId, v]) => ({
      botId,
      website: v.website,
      restartAt: v.restartAt.toISOString(),
    })),
  };
}
