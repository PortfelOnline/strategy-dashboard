import { useState, useEffect } from 'react';
import { trpc } from '@/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Play, Square, Terminal, RefreshCw, Plus, Bot, Shield, Trash2, Upload, RotateCcw, ExternalLink, Save, FileText, Zap, Clock, CheckCircle, XCircle, AlertCircle, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const WEBSITES = [
  'https://shared-brains.ru',
  'https://brain-skill.ru',
  'https://edu.shared-brains.ru',
  'https://kadastrmap.info',
  'https://мцск.рф',
];

function AddSiteRow({ onAdd }: { onAdd: (site: string, url: string) => void }) {
  const [site, setSite] = useState('');
  const [url, setUrl] = useState('');
  return (
    <div className="pt-2 border-t border-slate-100">
      <p className="text-xs text-slate-500 mb-2">Добавить сайт</p>
      <div className="flex gap-2">
        <Input placeholder="https://example.ru" className="text-xs" value={site} onChange={e => setSite(e.target.value)} />
        <Input placeholder="https://docs.google.com/..." className="font-mono text-xs flex-[2]" value={url} onChange={e => setUrl(e.target.value)} />
        <Button size="sm" className="shrink-0" onClick={() => {
          if (!site.trim() || !url.trim()) return;
          onAdd(site.trim(), url.trim());
          setSite(''); setUrl('');
        }}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

interface BotEntry {
  botId: number;
  status: 'running' | 'stopped';
  mode?: string;
  website?: string;
  startedAt?: string;
  pid?: number;
  state: {
    warmup_days?: number;
    last_run?: string;
    used_queries?: string[];
  } | null;
}

interface ProxyEntry {
  proxy: string;
  banned: boolean;
  banUntil: string | null;
}

interface GoogleDocsConfig {
  global: { proxies: string; queries: string; warmup_queries: string };
  websites: Record<string, string>;
}

interface OrchestratorConfig {
  enabled: boolean;
  maxConcurrent: number;
  resourcePct: number;
  restartDelayMin: number;
  dailyStartHour: number;
  dailyEndHour: number;
  skipTimeCheck: boolean;
  bots: Array<{ botId: number; website: string; enabled: boolean }>;
}

export default function Bots() {
  const [tab, setTab] = useState<'bots' | 'proxies' | 'docs' | 'autopilot'>('bots');

  // Bots state
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsBot, setLogsBot] = useState<number | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [newBotId, setNewBotId] = useState('');
  const [newMode, setNewMode] = useState<'warmup' | 'target'>('warmup');
  const [newWebsite, setNewWebsite] = useState(WEBSITES[0]);

  // Proxies state
  const [proxyInput, setProxyInput] = useState('');
  const [proxySearch, setProxySearch] = useState('');
  const [replaceConfirm, setReplaceConfirm] = useState(false);

  // Google Docs state
  const [docsEdits, setDocsEdits] = useState<GoogleDocsConfig | null>(null);

  // Orchestrator state
  const [orchEdits, setOrchEdits] = useState<OrchestratorConfig | null>(null);
  const [newPilotBotId, setNewPilotBotId] = useState('');
  const [newPilotWebsite, setNewPilotWebsite] = useState(WEBSITES[0]);

  const utils = trpc.useUtils();

  // Bots queries
  const { data, isLoading, isFetching, refetch } = trpc.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: logsData, isLoading: logsLoading } = trpc.logs.useQuery(
    { botId: logsBot!, lines: 200 },
    { enabled: logsBot !== null && logsOpen, refetchInterval: logsOpen ? 3000 : false }
  );

  // Proxies query
  const { data: proxiesData, isLoading: proxiesLoading, refetch: refetchProxies } = trpc.proxyList.useQuery(undefined, {
    refetchInterval: tab === 'proxies' ? 10000 : false,
  });

  // Google Docs query
  const { data: googleDocsData } = trpc.googleDocs.useQuery(undefined, {
    staleTime: 60000,
  });
  useEffect(() => {
    if (googleDocsData && !docsEdits) setDocsEdits(googleDocsData);
  }, [googleDocsData]);

  // Orchestrator queries
  const { data: orchConfig } = trpc.orchestratorConfig.useQuery(undefined, {
    staleTime: 10000,
  });
  const { data: orchStatus, refetch: refetchOrchStatus } = trpc.orchestratorStatus.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const { data: captchaData } = trpc.captchaStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: detectedResources } = trpc.detectedResources.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (orchConfig && !orchEdits) setOrchEdits(orchConfig);
  }, [orchConfig]);

  // Bots mutations
  const start = trpc.start.useMutation({
    onSuccess: (d) => { toast.success(`Bot started (PID ${d.pid})`); utils.list.invalidate(); setStartOpen(false); setNewBotId(''); },
    onError: (e) => toast.error(e.message),
  });
  const stop = trpc.stop.useMutation({
    onSuccess: () => { toast.success('Bot stopped'); utils.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const clearCache = trpc.clearCache.useMutation({
    onSuccess: () => { toast.success('Proxy cache cleared'); utils.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const clearBlacklist = trpc.clearBlacklist.useMutation({
    onSuccess: () => { toast.success('Proxy blacklist cleared'); utils.list.invalidate(); utils.proxyList.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // Proxy mutations
  const proxyAdd = trpc.proxyAdd.useMutation({
    onSuccess: (r) => {
      toast.success(`Added ${r.added} proxies (skipped ${r.skipped} duplicates). Total: ${r.total}`);
      setProxyInput('');
      utils.proxyList.invalidate();
      utils.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const proxyReplace = trpc.proxyReplace.useMutation({
    onSuccess: (r) => {
      toast.success(`Replaced. Total: ${r.total} proxies`);
      setProxyInput('');
      setReplaceConfirm(false);
      utils.proxyList.invalidate();
      utils.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const proxyDelete = trpc.proxyDelete.useMutation({
    onSuccess: (r) => { toast.success(`Deleted. Total: ${r.total}`); utils.proxyList.invalidate(); utils.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // Google Docs mutation
  const saveDocs = trpc.setGoogleDocs.useMutation({
    onSuccess: () => { toast.success('Google Docs сохранены'); utils.googleDocs.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // Orchestrator mutation
  const saveOrch = trpc.setOrchestratorConfig.useMutation({
    onSuccess: () => {
      toast.success('Автопилот сохранён');
      utils.orchestratorConfig.invalidate();
      utils.orchestratorStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });


  const vncStart = trpc.vncStart.useMutation({
    onSuccess: (data, vars) => {
      if (data?.sleeping) {
        toast.info('Бот сейчас спит — ждёт следующего запроса. Попробуйте позже.');
        return;
      }
      window.open(`/novnc/viewer.html?bot=${vars.botId}`, `vnc-${vars.botId}`, 'width=1280,height=820');
    },
    onError: (e) => toast.error('VNC: ' + e.message),
  });

  const bots: BotEntry[] = data?.bots ?? [];
  const proxyStats = data?.proxyStats;
  const warmedCount = bots.filter(b => ((b.state as Record<string, unknown>)?.warmup_days as number ?? 0) >= 14).length;
  const proxies: ProxyEntry[] = proxiesData ?? [];
  const filteredProxies = proxies.filter(p =>
    !proxySearch || p.proxy.toLowerCase().includes(proxySearch.toLowerCase())
  );

  const handleStart = () => {
    const id = parseInt(newBotId);
    if (!id || id < 1) return toast.error('Enter valid bot ID (1+)');
    start.mutate({ botId: id, mode: newMode, website: newWebsite });
  };

  const handleAdd = () => {
    if (!proxyInput.trim()) return toast.error('Paste proxies first');
    proxyAdd.mutate({ text: proxyInput });
  };

  const handleReplace = () => {
    if (!proxyInput.trim()) return toast.error('Paste proxies first');
    if (!replaceConfirm) { setReplaceConfirm(true); return; }
    proxyReplace.mutate({ text: proxyInput });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <Bot className="w-9 h-9" /> Yandex Bots
            </h1>
            <p className="text-slate-600">Управление поисковыми ботами</p>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" disabled={isFetching} onClick={async () => {
              await Promise.all([refetch(), refetchProxies()]);
              toast.success('Обновлено');
            }}>
              <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button variant="outline" size="sm" className="text-slate-600 text-xs"
              onClick={async () => { await fetch('/api/auth/logout', {method:'POST'}); window.location.reload(); }}>
              Выйти
            </Button>
            {tab === 'bots' && (
              <Button onClick={() => setStartOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> New Bot
              </Button>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={v => setTab(v as 'bots' | 'proxies' | 'docs' | 'autopilot')}>
          <TabsList className="mb-6">
            <TabsTrigger value="bots">Боты</TabsTrigger>
            <TabsTrigger value="proxies">
              Прокси {proxies.length > 0 && <Badge className="ml-2 bg-slate-200 text-slate-700 text-xs">{proxies.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="docs">
              <FileText className="w-3.5 h-3.5 mr-1.5" />Google Docs
            </TabsTrigger>
            <TabsTrigger value="autopilot">
              <Zap className="w-3.5 h-3.5 mr-1.5" />Автопилот
              {orchStatus?.active && <span className="ml-1.5 w-2 h-2 rounded-full bg-green-500 inline-block" />}
            </TabsTrigger>
          </TabsList>

          {/* ===== BOTS TAB ===== */}
          <TabsContent value="bots">
            {/* Proxy Stats */}
            {proxyStats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                      <Shield className="w-4 h-4" /> Working Proxies
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">{proxyStats.workingCount}</div>
                    <p className="text-xs text-slate-500 mt-1">
                      {proxyStats.cacheAgeMin !== null ? `Cached ${proxyStats.cacheAgeMin} min ago` : 'No cache'}
                    </p>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs text-red-500 p-0 h-auto"
                      onClick={() => clearCache.mutate()} disabled={clearCache.isPending}>
                      Clear cache
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-600">Banned Proxies</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${proxyStats.bannedCount > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {proxyStats.bannedCount}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Banned after CAPTCHA</p>
                    <Button variant="ghost" size="sm" className="mt-2 text-xs text-red-500 p-0 h-auto"
                      onClick={() => clearBlacklist.mutate()}
                      disabled={clearBlacklist.isPending || proxyStats.bannedCount === 0}>
                      Clear blacklist
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-600">Running Bots</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-blue-600">
                      {bots.filter(b => b.status === 'running').length}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">of {bots.length} total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" /> Прогретые боты
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">{warmedCount}</div>
                    <p className="text-xs text-slate-500 mt-1">из {bots.length} (≥14 дней прогрева)</p>
                    <div className="mt-2 w-full bg-slate-200 rounded-full h-1.5">
                      <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: bots.length > 0 ? `${Math.min(100, (warmedCount / bots.length) * 100)}%` : '0%' }} />
                    </div>
                  </CardContent>
                </Card>
                {captchaData && (
                  <Card className="col-span-1 md:col-span-2">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                        <Shield className="w-4 h-4 text-orange-500" /> Капча — расход и баланс
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        {/* 2captcha */}
                        <div className="bg-orange-50 rounded-lg p-3">
                          <div className="text-xs font-semibold text-orange-700 mb-1">2captcha</div>
                          <div className={`text-2xl font-bold ${captchaData.twoCaptcha.dailyCount >= captchaData.twoCaptcha.maxDaily ? 'text-red-600' : 'text-orange-600'}`}>
                            {captchaData.twoCaptcha.dailyCount}
                            <span className="text-sm font-normal text-slate-400">/{captchaData.twoCaptcha.maxDaily} решено</span>
                          </div>
                          <div className="mt-1.5 w-full bg-orange-200 rounded-full h-1.5">
                            <div className={`h-1.5 rounded-full transition-all ${captchaData.twoCaptcha.dailyCount >= captchaData.twoCaptcha.maxDaily ? 'bg-red-500' : 'bg-orange-500'}`}
                              style={{ width: `${Math.min(100, (captchaData.twoCaptcha.dailyCount / captchaData.twoCaptcha.maxDaily) * 100)}%` }} />
                          </div>
                          <div className="mt-2 space-y-0.5 text-xs text-slate-500">
                            <div>Попыток: <span className="font-medium text-slate-700">{captchaData.twoCaptcha.attempts}</span></div>
                            <div>Баланс: <span className="font-medium text-green-700">{captchaData.twoCaptcha.balance !== null ? `$${captchaData.twoCaptcha.balance.toFixed(2)}` : '—'}</span></div>
                            <div>Расход сегодня: <span className="font-medium text-red-600">${captchaData.costToday.toFixed(4)}</span></div>
                          </div>
                        </div>
                      </div>
                      {/* History chart - last 7 days */}
                      {captchaData.history.length > 1 && (
                        <div>
                          <div className="text-xs text-slate-400 mb-1.5">История (последние {captchaData.history.length} дней)</div>
                          <div className="flex items-end gap-1 h-10">
                            {captchaData.history.map((d: { date: string; count2cap: number }) => {
                              const maxVal = Math.max(...captchaData.history.map((x: typeof d) => x.count2cap), 1);
                              const h = Math.max(4, Math.round((d.count2cap / maxVal) * 40));
                              return (
                                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.date}: ${d.count2cap} решено`}>
                                  <div className="w-full bg-orange-400 rounded-sm" style={{ height: `${h}px` }} />
                                  <div className="text-[9px] text-slate-400">{d.date.slice(5)}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : bots.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center">
                  <Bot className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500 text-lg">No bots yet</p>
                  <p className="text-slate-400 text-sm mt-1">Click "New Bot" to start one</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-slate-50 text-slate-500">
                          <th className="text-left px-3 py-2 font-medium w-14">#</th>
                          <th className="text-left px-3 py-2 font-medium w-24">Статус</th>
                          <th className="text-left px-3 py-2 font-medium w-20">Режим</th>
                          <th className="text-left px-3 py-2 font-medium">Сайт</th>
                          <th className="text-left px-3 py-2 font-medium w-20">Прогрев</th>
                          <th className="text-left px-3 py-2 font-medium w-24">Последний</th>
                          <th className="text-right px-3 py-2 font-medium w-20">Действия</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bots.map(bot => {
                          const isRunning = bot.status === 'running';
                          const isBrowsing = (bot as Record<string, unknown>).isBrowsing === true;
                          const isManaged = orchStatus?.managedBots.includes(bot.botId);
                          const warmupDays = (bot.state?.warmup_days as number | undefined) ?? 0;
                          const lastRun = bot.state?.last_run as string | undefined;
                          const modeLabel = (bot as Record<string, unknown>).mode as string | undefined;
                          const site = (bot as Record<string, unknown>).website as string | undefined;
                          return (
                            <tr key={bot.botId} className={`hover:bg-slate-50 ${isRunning ? 'bg-green-50/30' : ''}`}>
                              <td className="px-3 py-1.5 font-mono font-medium text-slate-700">
                                {String(bot.botId).padStart(3, '0')}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-green-500' : 'bg-slate-300'}`} />
                                  <span className={isRunning ? 'text-green-700' : 'text-slate-400'}>
                                    {isRunning ? 'Running' : 'Stopped'}
                                  </span>
                                  {isManaged && <Zap className="w-3 h-3 text-yellow-500" />}
                                </div>
                              </td>
                              <td className="px-3 py-1.5">
                                {modeLabel ? (
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    modeLabel === 'target' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                                  }`}>
                                    {modeLabel === 'target' ? 'Target' : 'Warmup'}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-1.5 text-slate-500 max-w-[180px]">
                                <span className="truncate block" title={site}>
                                  {site ? site.replace(/^https?:\/\//, '') : '—'}
                                </span>
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center gap-1">
                                  <div className="w-12 bg-slate-200 rounded-full h-1.5">
                                    <div
                                      className="bg-orange-400 h-1.5 rounded-full"
                                      style={{ width: `${Math.min(100, (warmupDays / 14) * 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-slate-500">{warmupDays}d</span>
                                </div>
                              </td>
                              <td className="px-3 py-1.5 text-slate-400">
                                {lastRun ? formatDistanceToNow(new Date(lastRun), { addSuffix: true }) : '—'}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex items-center justify-end gap-1">
                                  {isRunning ? (
                                    <button
                                      className="p-1 rounded hover:bg-red-100 text-red-500 disabled:opacity-40"
                                      onClick={() => stop.mutate({ botId: bot.botId })}
                                      disabled={stop.isPending}
                                      title="Stop"
                                    >
                                      <Square className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      className="p-1 rounded hover:bg-green-100 text-green-600"
                                      onClick={() => { setNewBotId(String(bot.botId)); setStartOpen(true); }}
                                      title="Start"
                                    >
                                      <Play className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    className="p-1 rounded hover:bg-slate-100 text-slate-500"
                                    onClick={() => { setLogsBot(bot.botId); setLogsOpen(true); }}
                                    title="Logs"
                                  >
                                    <Terminal className="w-3.5 h-3.5" />
                                  </button>
                                  {isBrowsing && (
                                    <button
                                      className="p-1 rounded hover:bg-blue-100 text-blue-500 animate-pulse"
                                      onClick={() => vncStart.mutate({ botId: bot.botId })}
                                      title="Смотреть — бот сейчас активен"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== PROXIES TAB ===== */}
          <TabsContent value="proxies">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Left: input panel */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Добавить / Заменить прокси</CardTitle>
                    <CardDescription>
                      Формат: <code className="bg-slate-100 px-1 rounded text-xs">user:pass@host:port</code> — по одному на строку
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      className="font-mono text-xs min-h-64 resize-y"
                      placeholder={'no2L5n:9ZOrkzA3QP@45.86.1.180:3000\nno2L5n:9ZOrkzA3QP@109.248.14.8:3000\n...'}
                      value={proxyInput}
                      onChange={e => { setProxyInput(e.target.value); setReplaceConfirm(false); }}
                    />
                    <div className="text-xs text-slate-500">
                      {proxyInput.split('\n').filter(l => l.trim()).length} строк вставлено
                    </div>
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={handleAdd} disabled={proxyAdd.isPending}>
                        {proxyAdd.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
                        Добавить
                      </Button>
                      <Button
                        variant={replaceConfirm ? 'destructive' : 'outline'}
                        className="flex-1"
                        onClick={handleReplace}
                        disabled={proxyReplace.isPending}
                      >
                        {proxyReplace.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
                        {replaceConfirm ? 'Подтвердить замену?' : 'Заменить всё'}
                      </Button>
                    </div>
                    {replaceConfirm && (
                      <p className="text-xs text-red-600">Нажми ещё раз — текущий список будет удалён!</p>
                    )}
                  </CardContent>
                </Card>

                {/* Stats mini card */}
                <Card>
                  <CardContent className="pt-4 grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-2xl font-bold text-slate-800">{proxies.length}</div>
                      <div className="text-xs text-slate-500">Всего</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-green-600">
                        {proxies.filter(p => !p.banned).length}
                      </div>
                      <div className="text-xs text-slate-500">Активных</div>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-500">
                        {proxies.filter(p => p.banned).length}
                      </div>
                      <div className="text-xs text-slate-500">Забанено</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right: proxy list */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Список прокси</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => refetchProxies()}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <Input
                    placeholder="Поиск по IP или логину..."
                    value={proxySearch}
                    onChange={e => setProxySearch(e.target.value)}
                    className="mt-2"
                  />
                </CardHeader>
                <CardContent className="p-0">
                  {proxiesLoading ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
                  ) : filteredProxies.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-sm">Нет прокси</div>
                  ) : (
                    <div className="max-h-[480px] overflow-y-auto divide-y">
                      {filteredProxies.map(p => (
                        <div key={p.proxy} className={`flex items-center justify-between px-4 py-2 text-xs hover:bg-slate-50 ${p.banned ? 'bg-red-50' : ''}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${p.banned ? 'bg-red-500' : 'bg-green-500'}`} />
                            <span className="font-mono truncate text-slate-700">{p.proxy}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {p.banned && (
                              <span className="text-red-500 text-[10px]">ban</span>
                            )}
                            <button
                              className="text-slate-400 hover:text-red-500 transition-colors"
                              onClick={() => proxyDelete.mutate({ proxy: p.proxy })}
                              disabled={proxyDelete.isPending}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ===== GOOGLE DOCS TAB ===== */}
          <TabsContent value="docs">
            {!docsEdits ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : (
              <div className="space-y-6 max-w-3xl">
                {/* Global docs */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Глобальные документы
                    </CardTitle>
                    <CardDescription>Общие для всех сайтов</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(['warmup_queries'] as const).map(key => (
                      <div key={key}>
                        <label className="text-sm font-medium text-slate-700 capitalize">
                          {'Warmup запросы'}
                        </label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            className="font-mono text-xs"
                            value={docsEdits.global[key]}
                            onChange={e => setDocsEdits(d => d ? {
                              ...d, global: { ...d.global, [key]: e.target.value }
                            } : d)}
                          />
                          <Button variant="ghost" size="sm" className="shrink-0" asChild>
                            <a href={docsEdits.global[key]} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Per-website docs */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Запросы по сайтам
                    </CardTitle>
                    <CardDescription>Документ с поисковыми запросами для каждого сайта</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {Object.entries(docsEdits.websites).map(([site, url]) => (
                      <div key={site}>
                        <label className="text-sm font-medium text-slate-700">{site}</label>
                        <div className="flex gap-2 mt-1">
                          <Input
                            className="font-mono text-xs"
                            value={url}
                            onChange={e => setDocsEdits(d => d ? {
                              ...d, websites: { ...d.websites, [site]: e.target.value }
                            } : d)}
                          />
                          <Button variant="ghost" size="sm" className="shrink-0" asChild>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost" size="sm" className="shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDocsEdits(d => {
                              if (!d) return d;
                              const w = { ...d.websites };
                              delete w[site];
                              return { ...d, websites: w };
                            })}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {/* Add new site */}
                    <AddSiteRow onAdd={(site, url) => setDocsEdits(d => d ? {
                      ...d, websites: { ...d.websites, [site]: url }
                    } : d)} />
                  </CardContent>
                </Card>

                <Button onClick={() => docsEdits && saveDocs.mutate(docsEdits)} disabled={saveDocs.isPending}>
                  {saveDocs.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                  Сохранить
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ===== AUTOPILOT TAB ===== */}
          <TabsContent value="autopilot">
            {!orchEdits ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-blue-600" /></div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left: settings + bot list */}
                <div className="lg:col-span-2 space-y-6">

                  {/* Settings */}
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Zap className="w-4 h-4" /> Настройки автопилота
                        </CardTitle>
                        {/* Enable toggle */}
                        <button
                          onClick={() => setOrchEdits(o => o ? { ...o, enabled: !o.enabled } : o)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${orchEdits.enabled ? 'bg-green-500' : 'bg-slate-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${orchEdits.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      <CardDescription>
                        {orchEdits.enabled ? 'Автопилот включён — боты запускаются автоматически' : 'Автопилот выключен'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Resource detection panel */}
                      {detectedResources && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium text-slate-700">Ресурсы машины</span>
                            <button
                              onClick={() => setOrchEdits(o => o ? { ...o, maxConcurrent: detectedResources.recommended } : o)}
                              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-md transition-colors"
                            >
                              Применить рекомендацию ({detectedResources.recommended} бота)
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-white rounded border border-slate-200 p-2 text-center">
                              <div className="text-lg font-bold text-slate-800">{detectedResources.cpuCount}</div>
                              <div className="text-xs text-slate-500">CPU ядер</div>
                            </div>
                            <div className="bg-white rounded border border-slate-200 p-2 text-center">
                              <div className="text-lg font-bold text-slate-800">{detectedResources.totalRamGb} GB</div>
                              <div className="text-xs text-slate-400">свободно: {detectedResources.freeRamGb} GB ({detectedResources.freeRamPct}%)</div>
                              <div className="text-xs text-slate-500">RAM всего</div>
                            </div>
                            <div className="bg-white rounded border border-slate-200 p-2 text-center">
                              <div className="text-lg font-bold text-blue-600">{detectedResources.recommended}</div>
                              <div className="text-xs text-slate-400">сейчас лимит: {detectedResources.dynamicMax}</div>
                              <div className="text-xs text-slate-500">Рекомендовано</div>
                            </div>
                          </div>
                          <p className="text-xs text-slate-400 mt-2">
                            {detectedResources.platform === 'darwin' ? 'macOS' : 'Linux'} · резерв: 25% CPU + {detectedResources.platform === 'darwin' ? '4' : '2'} GB RAM для системы
                          </p>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-slate-700">
                          Макс. одновременно
                          {detectedResources && orchEdits.maxConcurrent !== detectedResources.recommended && (
                            <span className={`ml-2 text-xs ${orchEdits.maxConcurrent < detectedResources.recommended ? 'text-amber-500' : 'text-blue-500'}`}>
                              {orchEdits.maxConcurrent < detectedResources.recommended
                                ? `на ${detectedResources.recommended - orchEdits.maxConcurrent} ниже рекомендации`
                                : `на ${orchEdits.maxConcurrent - detectedResources.recommended} выше рекомендации`}
                            </span>
                          )}
                        </label>
                        <div className="flex items-center gap-2 mt-1">
                          <button
                            onClick={() => setOrchEdits(o => o ? { ...o, maxConcurrent: Math.max(1, o.maxConcurrent - 1) } : o)}
                            className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-lg font-bold transition-colors"
                          >−</button>
                          <Input
                            type="number" min={1} max={20} className="text-center"
                            value={orchEdits.maxConcurrent}
                            onChange={e => setOrchEdits(o => o ? { ...o, maxConcurrent: Math.max(1, parseInt(e.target.value) || 1) } : o)}
                          />
                          <button
                            onClick={() => setOrchEdits(o => o ? { ...o, maxConcurrent: Math.min(20, o.maxConcurrent + 1) } : o)}
                            className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-lg font-bold transition-colors"
                          >+</button>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-sm font-medium text-slate-700">Лимит ресурсов (% свободных)</label>
                          <span className="text-sm font-bold text-blue-600">{orchEdits.resourcePct ?? 50}%</span>
                        </div>
                        <input
                          type="range" min={10} max={100} step={5}
                          className="w-full accent-blue-600"
                          value={orchEdits.resourcePct ?? 50}
                          onChange={e => setOrchEdits(o => o ? { ...o, resourcePct: parseInt(e.target.value) } : o)}
                        />
                        <div className="flex justify-between text-xs text-slate-400 mt-0.5">
                          <span>10%</span><span>50%</span><span>100%</span>
                        </div>
                        {detectedResources && (
                          <p className="text-xs text-slate-500 mt-1">
                            При {orchEdits.resourcePct ?? 50}% → макс. {Math.max(1, Math.min(
                              orchEdits.maxConcurrent,
                              Math.min(
                                Math.floor(detectedResources.freeRamGb * 1024 * 1024 * 1024 * ((orchEdits.resourcePct ?? 50) / 100) / (580 * 1024 * 1024)),
                                Math.max(1, Math.floor(detectedResources.cpuCount * ((orchEdits.resourcePct ?? 50) / 100) / 2))
                              )
                            ))} бот(ов) одновременно
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Задержка перезапуска (мин)</label>
                        <Input
                          type="number" min={1} max={1440} className="mt-1"
                          value={orchEdits.restartDelayMin}
                          onChange={e => setOrchEdits(o => o ? { ...o, restartDelayMin: parseInt(e.target.value) || 30 } : o)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Суточное окно — с (час)</label>
                        <Input
                          type="number" min={0} max={23} className="mt-1"
                          value={orchEdits.dailyStartHour}
                          onChange={e => setOrchEdits(o => o ? { ...o, dailyStartHour: parseInt(e.target.value) || 0 } : o)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-slate-700">Суточное окно — до (час)</label>
                        <Input
                          type="number" min={1} max={24} className="mt-1"
                          value={orchEdits.dailyEndHour}
                          onChange={e => setOrchEdits(o => o ? { ...o, dailyEndHour: parseInt(e.target.value) || 22 } : o)}
                        />
                      </div>
                      </div>{/* /grid-cols-2 */}
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="skipTimeCheck"
                          checked={orchEdits.skipTimeCheck ?? false}
                          onChange={e => setOrchEdits(o => o ? { ...o, skipTimeCheck: e.target.checked } : o)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <label htmlFor="skipTimeCheck" className="text-sm text-slate-700">
                          Круглосуточный режим — боты работают в любое время (игнорировать ночное окно)
                        </label>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Bot list */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Боты в ротации</CardTitle>
                      <CardDescription>warmup → target переключается автоматически по warmup_days ≥ 14</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {orchEdits.bots.length === 0 ? (
                        <p className="text-sm text-slate-400 text-center py-4">Нет ботов. Добавь ниже.</p>
                      ) : (
                        <div className="space-y-2">
                          {orchEdits.bots.map((b, i) => {
                            const state = data?.bots.find(rb => rb.botId === b.botId)?.state;
                            const warmupDays = state?.warmup_days ?? 0;
                            const autoMode = (warmupDays as number) >= 14 ? 'target' : 'warmup';
                            return (
                              <div key={b.botId} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${b.enabled ? 'bg-white' : 'bg-slate-50 opacity-60'}`}>
                                <span className="font-mono font-bold text-slate-700 w-12">#{b.botId}</span>
                                <span className="flex-1 truncate text-xs text-slate-600">{b.website}</span>
                                <Badge className={`text-xs shrink-0 ${autoMode === 'target' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {autoMode}
                                </Badge>
                                <span className="text-xs text-slate-400 shrink-0">w:{warmupDays as number}</span>
                                {/* toggle */}
                                <button
                                  onClick={() => setOrchEdits(o => {
                                    if (!o) return o;
                                    const bots = [...o.bots];
                                    bots[i] = { ...bots[i], enabled: !bots[i].enabled };
                                    return { ...o, bots };
                                  })}
                                  className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${b.enabled ? 'bg-green-500' : 'bg-slate-300'}`}
                                >
                                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${b.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                                </button>
                                <button
                                  onClick={() => setOrchEdits(o => o ? { ...o, bots: o.bots.filter((_, j) => j !== i) } : o)}
                                  className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Add bot */}
                      <div className="flex gap-2 mt-3 pt-3 border-t">
                        <Input
                          type="number" min={1} max={100} placeholder="Bot ID"
                          className="w-24 font-mono"
                          value={newPilotBotId}
                          onChange={e => setNewPilotBotId(e.target.value)}
                        />
                        <Select value={newPilotWebsite} onValueChange={setNewPilotWebsite}>
                          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {WEBSITES.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="sm" onClick={() => {
                          const id = parseInt(newPilotBotId);
                          if (!id || id < 1) return toast.error('Введи Bot ID');
                          if (orchEdits.bots.some(b => b.botId === id)) return toast.error('Бот уже в списке');
                          setOrchEdits(o => o ? { ...o, bots: [...o.bots, { botId: id, website: newPilotWebsite, enabled: true }] } : o);
                          setNewPilotBotId('');
                        }}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <Button onClick={() => orchEdits && saveOrch.mutate(orchEdits)} disabled={saveOrch.isPending}>
                    {saveOrch.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                    Сохранить конфиг
                  </Button>
                </div>

                {/* Right: live status */}
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">Статус оркестратора</CardTitle>
                        <Button variant="ghost" size="sm" onClick={() => refetchOrchStatus()}>
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-2">
                        {orchStatus?.active
                          ? <CheckCircle className="w-4 h-4 text-green-500" />
                          : <XCircle className="w-4 h-4 text-slate-400" />}
                        <span className="text-sm">{orchStatus?.active ? 'Активен' : 'Неактивен'}</span>
                      </div>

                      {/* Managed bots */}
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1.5">
                          Запущено автопилотом ({orchStatus?.managedBots.length ?? 0})
                        </p>
                        {orchStatus?.managedBots.length === 0 ? (
                          <p className="text-xs text-slate-400">—</p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {orchStatus?.managedBots.map(id => (
                              <Badge key={id} className="bg-green-100 text-green-700 text-xs">#{id}</Badge>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Queue */}
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1.5">
                          Очередь ({orchStatus?.queue.length ?? 0})
                        </p>
                        {orchStatus?.queue.length === 0 ? (
                          <p className="text-xs text-slate-400">Пусто</p>
                        ) : (
                          <div className="space-y-1">
                            {orchStatus?.queue.map(q => (
                              <div key={q.botId} className="text-xs text-slate-600 flex items-center gap-1">
                                <Bot className="w-3 h-3" /> #{q.botId} · {q.website.replace('https://', '')}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Pending restart */}
                      {(orchStatus?.pending.length ?? 0) > 0 && (
                        <div>
                          <p className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Ожидают перезапуска
                          </p>
                          <div className="space-y-1">
                            {orchStatus?.pending.map(p => (
                              <div key={p.botId} className="text-xs text-amber-600 flex items-center gap-1">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                #{p.botId} · {formatDistanceToNow(new Date(p.restartAt), { addSuffix: true })}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-50 border-slate-200">
                    <CardContent className="pt-4 text-xs text-slate-500 space-y-1.5">
                      <p><span className="font-medium">Тик:</span> каждые 30 сек</p>
                      <p><span className="font-medium">Режим:</span> warmup_days &lt; 14 → warmup, иначе target</p>
                      <p><span className="font-medium">Окно:</span> {orchEdits.dailyStartHour}:00 – {orchEdits.dailyEndHour}:00</p>
                      <p><span className="font-medium">Перезапуск:</span> через {orchEdits.restartDelayMin} мин после завершения</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Start Bot Dialog */}
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start Bot</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Bot ID</label>
              <Input className="mt-1" type="number" min={1} max={100} placeholder="e.g. 1"
                value={newBotId} onChange={e => setNewBotId(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Mode</label>
              <Select value={newMode} onValueChange={v => setNewMode(v as 'warmup' | 'target')}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="warmup">warmup — прогрев профиля</SelectItem>
                  <SelectItem value="target">target — целевые запросы</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Website</label>
              <Select value={newWebsite} onValueChange={setNewWebsite}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEBSITES.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStartOpen(false)}>Cancel</Button>
            <Button onClick={handleStart} disabled={start.isPending} className="bg-green-600 hover:bg-green-700">
              {start.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Play className="w-4 h-4 mr-1" />}
              Start Bot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" /> Bot #{logsBot} logs
              {logsLoading && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            </DialogTitle>
          </DialogHeader>
          <div className="bg-slate-950 rounded-lg p-4 overflow-auto max-h-[55vh] font-mono text-xs text-green-400 whitespace-pre-wrap">
            {logsData?.logs || 'No logs yet'}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLogsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
