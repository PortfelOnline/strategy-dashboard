import { spawn, execSync, execFileSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

function findBotDir(): string {
  if (process.env.BOT_DIR) return process.env.BOT_DIR;
  const candidates = [
    path.join(os.homedir(), 'yandex_bot'),
    path.join(process.cwd(), '..', '..', 'yandex_bot'),
    path.join(process.cwd(), '..', 'yandex_bot'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]; // ~/yandex_bot fallback
}

const BOT_DIR = findBotDir();

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
  const container = process.env.BOT_CONTAINER;
  const [spawnCmd, spawnPrefix] = container
    ? ['docker', ['exec', container, 'python3', '/app/yandex_bot.py']]
    : ['python3', [path.join(BOT_DIR, 'yandex_bot.py')]];
  const proc = spawn(spawnCmd, [
    ...spawnPrefix,
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
  // Start with processes spawned by this dashboard instance
  const result = new Map<number, Record<string, unknown>>();
  for (const [botId, { proc: _proc, ...b }] of runningBots) {
    result.set(botId, b);
  }

  // Also detect bots running inside the yandex_bot container (or locally)
  try {
    const container = process.env.BOT_CONTAINER;
    const psArgs = container
      ? ['exec', container, 'ps', '-ax', '-o', 'pid=', '-o', 'args=']
      : ['-ax', '-o', 'pid=', '-o', 'args='];
    const psCmd = container ? 'docker' : 'ps';
    const output = execFileSync(psCmd, psArgs, { encoding: 'utf8' });
    for (const line of output.split('\n')) {
      if (!line.includes('yandex_bot.py') || !line.includes('--bot-id')) continue;
      const pidMatch = line.match(/^\s*(\d+)/);
      const botIdMatch = line.match(/--bot-id\s+(\d+)/);
      if (!pidMatch || !botIdMatch) continue;
      const botId = parseInt(botIdMatch[1]);
      if (result.has(botId)) continue; // already tracked
      const websiteMatch = line.match(/--website\s+(\S+)/);
      const modeMatch = line.match(/--mode\s+(warmup|target)/);
      result.set(botId, {
        pid: parseInt(pidMatch[1]),
        botId,
        mode: (modeMatch?.[1] as 'warmup' | 'target') ?? 'warmup',
        website: websiteMatch?.[1] ?? 'unknown',
        startedAt: new Date().toISOString(),
        external: true,
      });
    }
  } catch {
    // Ignore — docker exec failed or no external bots
  }

  return Array.from(result.values());
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

// --- proxies.txt management ---
const PROXIES_FILE = () => path.join(BOT_DIR, 'proxies.txt');

function parseProxyLine(line: string): { raw: string; user: string; host: string } | null {
  const m = line.match(/^(?:https?:\/\/)?([^:]+:[^@]+)@([^:]+:\d+)$/);
  if (!m) return null;
  return { raw: line, user: m[1].split(':')[0], host: m[2] };
}

export function getProxies(): { proxies: string[]; total: number } {
  const file = PROXIES_FILE();
  try {
    if (fs.existsSync(file)) {
      const proxies = fs.readFileSync(file, 'utf8')
        .split('\n').map(l => l.trim()).filter(Boolean);
      return { proxies, total: proxies.length };
    }
  } catch {}
  return { proxies: [], total: 0 };
}

export function addProxies(lines: string[]): { added: number; skipped: number; total: number } {
  const existing = new Set(getProxies().proxies);
  const toAdd = lines.map(l => l.trim()).filter(l => l && !existing.has(l));
  if (toAdd.length > 0) {
    fs.appendFileSync(PROXIES_FILE(), '\n' + toAdd.join('\n'));
  }
  const total = existing.size + toAdd.length;
  return { added: toAdd.length, skipped: lines.length - toAdd.length, total };
}

export function replaceProxies(lines: string[]): { total: number } {
  const clean = lines.map(l => l.trim()).filter(Boolean);
  fs.writeFileSync(PROXIES_FILE(), clean.join('\n') + (clean.length ? '\n' : ''));
  return { total: clean.length };
}

export function deleteProxy(proxy: string): { total: number } {
  const { proxies } = getProxies();
  const filtered = proxies.filter(p => p !== proxy);
  fs.writeFileSync(PROXIES_FILE(), filtered.join('\n') + (filtered.length ? '\n' : ''));
  return { total: filtered.length };
}

export function getProxyBlacklist(): Record<string, string> {
  const blFile = path.join(BOT_DIR, 'outputs', 'proxy_blacklist.json');
  try {
    if (fs.existsSync(blFile)) return JSON.parse(fs.readFileSync(blFile, 'utf8'));
  } catch {}
  return {};
}

// --- Google Docs config ---
export interface GoogleDocsConfig {
  global: { proxies: string; queries: string; warmup_queries: string };
  websites: Record<string, string>; // website URL -> queries_doc URL
}

const GOOGLE_DOCS_FILE = () => path.join(BOT_DIR, 'outputs', 'google_docs.json');

const DEFAULT_GOOGLE_DOCS: GoogleDocsConfig = {
  global: {
    proxies: 'https://docs.google.com/document/d/1yOxZzMJg2cbYCa3t1OPJ5qfnRv2oD09kyyhUJRFxYoo',
    queries: 'https://docs.google.com/document/d/1pcMQljv073k1va7Op8tcZp66MwAVo4gNbnyzL_i-yTA',
    warmup_queries: 'https://docs.google.com/document/d/11KvPjdtznTnAbWGczJfXuURp6IBfT4fz5cgdNk7Esp0',
  },
  websites: {
    'https://shared-brains.ru': 'https://docs.google.com/document/d/1pcMQljv073k1va7Op8tcZp66MwAVo4gNbnyzL_i-yTA',
    'https://brain-skill.ru': 'https://docs.google.com/document/d/1pcMQljv073k1va7Op8tcZp66MwAVo4gNbnyzL_i-yTA',
    'https://edu.shared-brains.ru': 'https://docs.google.com/document/d/1pcMQljv073k1va7Op8tcZp66MwAVo4gNbnyzL_i-yTA',
    'https://kadastrmap.info': 'https://docs.google.com/document/d/14IKdB6QhaLmwRi62XjgVDoEGCx-pNmuMhK4dNzrLA2w',
    'https://мцск.рф': 'https://docs.google.com/document/d/1vKkmHdT6i42siz3joUtKhpMTbphgLtq84nthOl5FkQs',
  },
};

export function getGoogleDocs(): GoogleDocsConfig {
  try {
    const f = GOOGLE_DOCS_FILE();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return DEFAULT_GOOGLE_DOCS;
}

export function setGoogleDocs(config: GoogleDocsConfig): void {
  const dir = path.join(BOT_DIR, 'outputs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GOOGLE_DOCS_FILE(), JSON.stringify(config, null, 2));
}

// --- VNC ---
let activeVncContainerIp: string | null = null;

let activeVncBotId: number | null = null;
let vncWatcherTimer: ReturnType<typeof setTimeout> | null = null;
let lastVncDisplay: number = 99;

function readBotDisplay(container: string, botId: number): number {
  const displayFile = `/bot_work/outputs/bot_states/bot_${botId}_display.txt`;
  try {
    if (fs.existsSync(displayFile)) {
      return parseInt(fs.readFileSync(displayFile, 'utf8').trim()) || 99;
    }
  } catch {}
  return 99;
}

function xSocketExists(container: string, displayNum: number): boolean {
  try {
    execFileSync('docker', ['exec', container, 'test', '-S', `/tmp/.X11-unix/X${displayNum}`]);
    return true;
  } catch { return false; }
}

function restartX11vnc(container: string, displayNum: number): void {
  try { execFileSync('docker', ['exec', container, 'pkill', '-f', 'x11vnc']); } catch {}
  if (!xSocketExists(container, displayNum)) return;
  spawn('docker', [
    'exec', container,
    'x11vnc', '-display', `:${displayNum}`,
    '-nopw', '-rfbport', '5900', '-forever', '-shared', '-noxdamage', '-quiet',
  ], { detached: true, stdio: 'ignore' });
  // Start websockify to bridge WebSocket → raw VNC TCP
  spawn('docker', [
    'exec', container,
    'websockify', '5901', 'localhost:5900',
  ], { detached: true, stdio: 'ignore' });
}

function startVncWatcher(container: string): void {
  if (vncWatcherTimer) clearInterval(vncWatcherTimer as unknown as number);
  vncWatcherTimer = setInterval(() => {
    if (!activeVncBotId) return;
    const newDisplay = readBotDisplay(container, activeVncBotId);
    const vncRunning = (() => {
      try { execFileSync('docker', ['exec', container, 'pgrep', '-f', 'x11vnc']); return true; } catch { return false; }
    })();
    if (newDisplay !== lastVncDisplay || !vncRunning) {
      if (xSocketExists(container, newDisplay)) {
        lastVncDisplay = newDisplay;
        restartX11vnc(container, newDisplay);
      }
    }
  }, 3000) as unknown as ReturnType<typeof setTimeout>;
}

export function startVnc(botId: number): { display: number; containerIp: string } {
  const container = process.env.BOT_CONTAINER || 'yandex_bot';
  activeVncBotId = botId;

  const displayNum = readBotDisplay(container, botId);
  lastVncDisplay = displayNum;

  restartX11vnc(container, displayNum);

  try {
    activeVncContainerIp = execFileSync(
      'docker', ['inspect', container, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'],
      { encoding: 'utf8' }
    ).trim();
  } catch {
    activeVncContainerIp = '127.0.0.1';
  }

  startVncWatcher(container);
  return { display: displayNum, containerIp: activeVncContainerIp };
}

export function stopVnc(): void {
  const container = process.env.BOT_CONTAINER || 'yandex_bot';
  try { execFileSync('docker', ['exec', container, 'pkill', '-f', 'x11vnc']); } catch {}
  try { execFileSync('docker', ['exec', container, 'pkill', '-f', 'websockify']); } catch {}
  activeVncContainerIp = null;
}

export function getVncContainerIp(): string | null {
  return activeVncContainerIp;
}
