import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Play, Square, Terminal, RefreshCw, Plus, Bot, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const WEBSITES = [
  'https://shared-brains.ru',
  'https://brain-skill.ru',
  'https://edu.shared-brains.ru',
  'https://kadastrmap.info',
  'https://мцск.рф',
];

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

export default function Bots() {
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsBot, setLogsBot] = useState<number | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [newBotId, setNewBotId] = useState('');
  const [newMode, setNewMode] = useState<'warmup' | 'target'>('warmup');
  const [newWebsite, setNewWebsite] = useState(WEBSITES[0]);

  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.bots.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const { data: logsData, isLoading: logsLoading } = trpc.bots.logs.useQuery(
    { botId: logsBot!, lines: 200 },
    { enabled: logsBot !== null && logsOpen, refetchInterval: logsOpen ? 3000 : false }
  );

  const start = trpc.bots.start.useMutation({
    onSuccess: (d) => { toast.success(`Bot started (PID ${d.pid})`); utils.bots.list.invalidate(); setStartOpen(false); setNewBotId(''); },
    onError: (e) => toast.error(e.message),
  });

  const stop = trpc.bots.stop.useMutation({
    onSuccess: () => { toast.success('Bot stopped'); utils.bots.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const clearCache = trpc.bots.clearCache.useMutation({
    onSuccess: () => { toast.success('Proxy cache cleared'); utils.bots.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const clearBlacklist = trpc.bots.clearBlacklist.useMutation({
    onSuccess: () => { toast.success('Proxy blacklist cleared'); utils.bots.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const bots: BotEntry[] = data?.bots ?? [];
  const proxyStats = data?.proxyStats;

  const handleStart = () => {
    const id = parseInt(newBotId);
    if (!id || id < 1) return toast.error('Enter valid bot ID (1+)');
    start.mutate({ botId: id, mode: newMode, website: newWebsite });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2 flex items-center gap-3">
              <Bot className="w-9 h-9" /> Yandex Bots
            </h1>
            <p className="text-slate-600">Управление поисковыми ботами</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" /> Refresh
            </Button>
            <Button onClick={() => setStartOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> New Bot
            </Button>
          </div>
        </div>

        {/* Proxy Stats */}
        {proxyStats && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Working Proxies
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{proxyStats.workingCount}</div>
                {proxyStats.cacheAgeMin !== null && (
                  <p className="text-xs text-slate-500 mt-1">Cached {proxyStats.cacheAgeMin} min ago</p>
                )}
                {proxyStats.cacheAgeMin === null && (
                  <p className="text-xs text-slate-500 mt-1">No cache</p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs text-red-500 hover:text-red-600 p-0 h-auto"
                  onClick={() => clearCache.mutate()}
                  disabled={clearCache.isPending}
                >
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs text-red-500 hover:text-red-600 p-0 h-auto"
                  onClick={() => clearBlacklist.mutate()}
                  disabled={clearBlacklist.isPending || proxyStats.bannedCount === 0}
                >
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
          </div>
        )}

        {/* Bots list */}
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : bots.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Bot className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500 text-lg">No bots yet</p>
              <p className="text-slate-400 text-sm mt-1">Click "New Bot" to start one</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {bots.map(bot => (
              <Card key={bot.botId} className={`border-l-4 ${bot.status === 'running' ? 'border-l-green-500' : 'border-l-slate-300'}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Bot className="w-5 h-5" />
                      Bot #{bot.botId}
                    </CardTitle>
                    <Badge className={bot.status === 'running'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-slate-100 text-slate-600'
                    }>
                      {bot.status === 'running' ? '● Running' : '○ Stopped'}
                    </Badge>
                  </div>
                  {bot.status === 'running' && (
                    <CardDescription className="text-xs space-y-0.5">
                      <div><span className="font-medium">Mode:</span> {bot.mode}</div>
                      <div className="truncate"><span className="font-medium">Site:</span> {bot.website}</div>
                      <div><span className="font-medium">PID:</span> {bot.pid} · Started {bot.startedAt ? formatDistanceToNow(new Date(bot.startedAt), { addSuffix: true }) : '—'}</div>
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* State info */}
                  {bot.state && (
                    <div className="text-xs text-slate-500 bg-slate-50 rounded p-2 space-y-1">
                      <div>Warmup days: <span className="font-medium text-slate-700">{bot.state.warmup_days ?? 0}</span></div>
                      {bot.state.last_run && (
                        <div>Last run: <span className="font-medium text-slate-700">{formatDistanceToNow(new Date(bot.state.last_run), { addSuffix: true })}</span></div>
                      )}
                      {bot.state.used_queries && (
                        <div>Queries used: <span className="font-medium text-slate-700">{bot.state.used_queries.length}</span></div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {bot.status === 'stopped' ? (
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() => {
                          setNewBotId(String(bot.botId));
                          setStartOpen(true);
                        }}
                      >
                        <Play className="w-4 h-4 mr-1" /> Start
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        onClick={() => stop.mutate({ botId: bot.botId })}
                        disabled={stop.isPending}
                      >
                        {stop.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Square className="w-4 h-4 mr-1" />}
                        Stop
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setLogsBot(bot.botId); setLogsOpen(true); }}
                    >
                      <Terminal className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Start Bot Dialog */}
      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start Bot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Bot ID</label>
              <Input
                className="mt-1"
                type="number"
                min={1}
                max={100}
                placeholder="e.g. 1"
                value={newBotId}
                onChange={e => setNewBotId(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Mode</label>
              <Select value={newMode} onValueChange={v => setNewMode(v as 'warmup' | 'target')}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warmup">warmup — прогрев профиля</SelectItem>
                  <SelectItem value="target">target — целевые запросы</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Website</label>
              <Select value={newWebsite} onValueChange={setNewWebsite}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEBSITES.map(w => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
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
              <Terminal className="w-5 h-5" />
              Bot #{logsBot} logs
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
