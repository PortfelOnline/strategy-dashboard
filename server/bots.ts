import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const BOT_DIR = process.env.BOT_DIR || path.join(process.cwd(), '..', 'yandex_bot');

export function getBotDir() { return BOT_DIR; }

interface BotProcess {
  pid: number;
  botId: number;
  mode: 'warmup' | 'target';
  website: string;
  startedAt: string;
  proc: ChildProcess;
}

const runningBots = new Map<number, BotProcess>();

export function startBot(botId: number, mode: 'warmup' | 'target', website: string) {
  if (runningBots.has(botId)) {
    throw new Error(`Bot ${botId} is already running`);
  }
  const proc = spawn('python3', [
    path.join(BOT_DIR, 'yandex_bot.py'),
    '--bot-id', String(botId),
    '--mode', mode,
    '--website', website,
  ], { cwd: BOT_DIR, detached: false });

  const entry: BotProcess = {
    pid: proc.pid!,
    botId, mode, website,
    startedAt: new Date().toISOString(),
    proc,
  };
  runningBots.set(botId, entry);
  proc.on('exit', () => runningBots.delete(botId));
  return { pid: proc.pid! };
}

export function stopBot(botId: number) {
  const bot = runningBots.get(botId);
  if (!bot) throw new Error(`Bot ${botId} is not running`);
  bot.proc.kill('SIGTERM');
  runningBots.delete(botId);
  return { success: true };
}

export function getRunningBots() {
  return Array.from(runningBots.values()).map(({ proc: _proc, ...b }) => b);
}

export function getBotState(botId: number): Record<string, unknown> | null {
  const stateFile = path.join(BOT_DIR, 'outputs', 'bot_states', `bot_${botId}_state.json`);
  try {
    if (fs.existsSync(stateFile)) return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {}
  return null;
}

export function getBotLogs(botId: number, lines = 150): string {
  const logFile = path.join(BOT_DIR, 'logs', `bot_${botId}.log`);
  try {
    if (fs.existsSync(logFile)) {
      return fs.readFileSync(logFile, 'utf8').split('\n').slice(-lines).join('\n');
    }
  } catch {}
  return 'No logs found';
}

export function listKnownBotIds(): number[] {
  const stateDir = path.join(BOT_DIR, 'outputs', 'bot_states');
  const ids: number[] = [];
  try {
    if (fs.existsSync(stateDir)) {
      for (const file of fs.readdirSync(stateDir)) {
        const m = file.match(/^bot_(\d+)_state\.json$/);
        if (m) ids.push(parseInt(m[1]));
      }
    }
  } catch {}
  return ids.sort((a, b) => a - b);
}

export function getProxyStats() {
  const cacheFile = path.join(BOT_DIR, 'outputs', 'proxy_cache.json');
  const blFile = path.join(BOT_DIR, 'outputs', 'proxy_blacklist.json');
  let workingCount = 0, cacheAgeMin: number | null = null, bannedCount = 0;
  try {
    if (fs.existsSync(cacheFile)) {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      workingCount = c.working?.length ?? 0;
      if (c.checked_at) cacheAgeMin = Math.round((Date.now() - new Date(c.checked_at).getTime()) / 60000);
    }
  } catch {}
  try {
    if (fs.existsSync(blFile)) {
      bannedCount = Object.keys(JSON.parse(fs.readFileSync(blFile, 'utf8'))).length;
    }
  } catch {}
  return { workingCount, cacheAgeMin, bannedCount };
}

export function clearProxyCache() {
  const f = path.join(BOT_DIR, 'outputs', 'proxy_cache.json');
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

export function clearProxyBlacklist() {
  const f = path.join(BOT_DIR, 'outputs', 'proxy_blacklist.json');
  if (fs.existsSync(f)) fs.writeFileSync(f, '{}');
}
