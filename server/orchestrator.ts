import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBotDir, startBot, getRunningBots, getBotState } from './bots';

// RAM per bot: ~500MB Firefox + ~80MB Python
const RAM_PER_BOT_BYTES = 580 * 1024 * 1024;


// Dynamic limit: use `pct`% of currently free RAM + CPU cores
export function dynamicMaxConcurrent(pct = 50): number {
  const freeMem = os.freemem();
  const cpuCount = os.cpus().length;
  const ratio = pct / 100;
  const ramBased = Math.floor(freeMem * ratio / RAM_PER_BOT_BYTES);
  // Each bot uses ~2 threads; cap at `pct`% of CPU cores
  const cpuBased = Math.max(1, Math.floor(cpuCount * ratio * 4));
  return Math.max(1, Math.min(ramBased, cpuBased));
}

export function detectMaxConcurrent(): number {
  const totalRam = os.totalmem();
  const cpuCount = os.cpus().length;
  const isMac = os.platform() === 'darwin';

  // Leave headroom for the user/OS:
  //   macOS: reserve 4GB + 25% of remaining → bots get ~60% of RAM
  //   Linux: reserve 2GB + 10% of remaining → bots get ~85% of RAM
  const hardReserve = isMac ? 4 * 1024 ** 3 : 2 * 1024 ** 3;
  const softReserve = isMac ? 0.25 : 0.10;
  const available = (totalRam - hardReserve) * (1 - softReserve);
  const ramBased = Math.floor(available / RAM_PER_BOT_BYTES);

  // CPU: leave 25% of cores free on macOS, 10% on Linux
  const cpuForBots = isMac
    ? Math.max(1, Math.floor(cpuCount * 0.75 / 2))   // each bot ~2 threads
    : Math.max(1, Math.floor(cpuCount * 0.90 / 2));

  return Math.max(1, Math.min(ramBased, cpuForBots));
}

export interface BotEntry {
  botId: number;
  website: string;
  enabled: boolean;
}

export interface OrchestratorConfig {
  enabled: boolean;
  maxConcurrent: number;
  resourcePct: number;     // % of free RAM/CPU to use for dynamic limit (1–100)
  restartDelayMin: number; // minutes to wait before re-queuing a finished bot
  dailyStartHour: number;  // 0–23: start of allowed window
  dailyEndHour: number;    // 1–24: end of allowed window (exclusive)
  skipTimeCheck: boolean;  // pass --skip-time-check to bots (run 24/7 ignoring night hours)
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
  maxConcurrent: detectMaxConcurrent(),
  resourcePct: 50,
  restartDelayMin: 30,
  dailyStartHour: 0,
  dailyEndHour: 24,
  skipTimeCheck: false,
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

function makeDefaultConfig(): OrchestratorConfig {
  const n = detectMaxConcurrent();
  const bots: BotEntry[] = Array.from({ length: n }, (_, i) => ({
    botId: i + 1,
    website: 'https://kadastrmap.info',
    enabled: true,
  }));
  return { ...DEFAULT_CONFIG, maxConcurrent: n, bots };
}

export function getOrchestratorConfig(): OrchestratorConfig {
  try {
    const f = configFile();
    if (fs.existsSync(f)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    }
  } catch {}
  // First run: auto-initialize and save
  const cfg = makeDefaultConfig();
  saveOrchestratorConfig(cfg);
  return cfg;
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

  const now = new Date();
  const running = getRunningBots();
  const runningIds = new Set(running.map(b => b.botId));

  // 0. Always adopt externally-running bots (even outside time window)
  for (const b of config.bots) {
    if (b.enabled && runningIds.has(b.botId) && !managedBots.has(b.botId)) {
      managedBots.add(b.botId);
    }
  }

  if (!isWithinWindow(config)) return;

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

  // 3. Handle enabled bots
  for (const b of config.bots) {
    if (!b.enabled) continue;
    if (runningIds.has(b.botId)) {
      // Adopt externally-started bots so we track them for restart
      if (!managedBots.has(b.botId)) managedBots.add(b.botId);
      continue;
    }
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

  // 4b. Sort queue by warmup_days ascending — bots with less warmup get priority
  queue.sort((a, b) => {
    const dA = (getBotState(a.botId)?.warmup_days as number | undefined) ?? 0;
    const dB = (getBotState(b.botId)?.warmup_days as number | undefined) ?? 0;
    return dA - dB;
  });

  // 5. Start from queue up to min(config.maxConcurrent, dynamic free resources)
  const effectiveMax = Math.min(config.maxConcurrent, dynamicMaxConcurrent(config.resourcePct ?? 50));
  let runningCount = runningIds.size;
  while (runningCount < effectiveMax && queue.length > 0) {
    const next = queue.shift()!;
    if (runningIds.has(next.botId) || managedBots.has(next.botId)) continue;
    const mode = autoMode(next.botId);
    try {
      startBot(next.botId, mode, next.website, config.skipTimeCheck ?? false);
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

export function getDetectedResources() {
  const totalRam = os.totalmem();
  const freeMem = os.freemem();
  const cpuCount = os.cpus().length;
  const platform = os.platform();
  const recommended = detectMaxConcurrent();
  const dynamic = dynamicMaxConcurrent();
  return {
    cpuCount,
    totalRamGb: Math.round(totalRam / (1024 ** 3) * 10) / 10,
    freeRamGb: Math.round(freeMem / (1024 ** 3) * 10) / 10,
    freeRamPct: Math.round(freeMem / totalRam * 100),
    platform,
    recommended,
    dynamicMax: dynamic,
  };
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
