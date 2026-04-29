import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Server, Activity, RefreshCw, CheckCircle, XCircle, AlertCircle, Terminal, Shield, Layers, Play } from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/DashboardLayout';
import { useState } from 'react';

export default function DeepSeekAgent() {
  const health = trpc.deepseek.health.useQuery(undefined, { refetchInterval: 30_000 });
  const tasks = trpc.deepseek.tasks.useQuery(undefined, { refetchInterval: 30_000 });
  const services = trpc.deepseek.services.useQuery(undefined, { refetchInterval: 60_000 });
  const sessions = trpc.deepseek.sessions.useQuery(undefined, { refetchInterval: 60_000 });
  const permissions = trpc.deepseek.permissions.useQuery(undefined);
  const bgTasks = trpc.deepseek.bgTasks.useQuery(undefined, { refetchInterval: 30_000 });

  const [activeOverview, setActiveOverview] = useState<string | null>('tasks');

  const healthStatus = health.data?.status as string | undefined;
  const healthOk = healthStatus === 'ok' || healthStatus === 'healthy';
  const uptime = health.data && (health.data as any).uptime;

  const refreshAll = () => {
    health.refetch();
    tasks.refetch();
    services.refetch();
    sessions.refetch();
    permissions.refetch();
    bgTasks.refetch();
    toast.success('Refreshed all data');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">DeepSeek Agent</h1>
              <p className="text-sm text-muted-foreground">
                167.86.116.15:8766 · Contabo
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>

        {/* Health card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Agent Status</CardTitle>
              </div>
              <Badge variant={healthOk ? 'default' : 'destructive'} className="text-xs">
                {health.data ? (
                  <span className="flex items-center gap-1">
                    {healthOk ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {healthStatus ?? 'ok'}
                  </span>
                ) : health.isError ? (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    unreachable
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    loading
                  </span>
                )}
              </Badge>
            </div>
            <CardDescription>
              {uptime ? `Uptime: ${uptime}` : health.isError ? 'Cannot reach the agent server' : 'Checking...'}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Quick stats row */}
        {health.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Play className="h-3 w-3" /> Scheduled Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {Array.isArray(health.data?.tasks) ? (health.data.tasks as any[]).length : '-'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3" /> Sessions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {sessions.data ? (Array.isArray(sessions.data) ? (sessions.data as any[]).length : '-') : '-'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" /> Services
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {services.data ? (typeof services.data === 'object' && !Array.isArray(services.data) ? Object.keys(services.data as object).length : '-') : '-'}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <Terminal className="h-3 w-3" /> BG Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {bgTasks.data ? (Array.isArray(bgTasks.data) ? (bgTasks.data as any[]).length : '-') : '-'}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Overview sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Scheduled Tasks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Scheduled Tasks (Cron)</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {Array.isArray(tasks.data) ? (tasks.data as any[]).length : '?'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {tasks.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : Array.isArray(tasks.data) ? (
                <div className="space-y-2">
                  {(tasks.data as any[]).map((t: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-2 bg-muted rounded-md text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.next_run ? new Date(t.next_run).toLocaleString('ru-RU') : 'no schedule'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64">
                  {JSON.stringify(tasks.data, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>

          {/* Background Tasks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Background Tasks</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {Array.isArray(bgTasks.data) ? (bgTasks.data as any[]).length : '?'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {bgTasks.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : Array.isArray(bgTasks.data) && bgTasks.data.length > 0 ? (
                <div className="space-y-2">
                  {(bgTasks.data as any[]).slice(0, 10).map((t: any, i: number) => (
                    <div key={i} className="p-2 bg-muted rounded-md text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{t.id || t.name || `#${i + 1}`}</span>
                        <Badge variant="secondary" className="text-xs">{t.status || 'unknown'}</Badge>
                      </div>
                      {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No background tasks</p>
              )}
            </CardContent>
          </Card>

          {/* Sessions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Chat Sessions</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {sessions.data ? (Array.isArray(sessions.data) ? (sessions.data as any[]).length : '?') : '?'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {sessions.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : Array.isArray(sessions.data) && sessions.data.length > 0 ? (
                <div className="space-y-2">
                  {(sessions.data as any[]).slice(0, 8).map((s: any, i: number) => (
                    <div key={i} className="p-2 bg-muted rounded-md text-sm">
                      <div className="font-medium truncate">{s.id || `Session ${i + 1}`}</div>
                      {s.message_count != null && (
                        <p className="text-xs text-muted-foreground">{s.message_count} messages</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {sessions.data === null ? 'Loading...' : 'No active sessions'}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Services */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Services</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {services.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : services.data ? (
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
                  {JSON.stringify(services.data, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No services data</p>
              )}
            </CardContent>
          </Card>

          {/* Permissions */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Permission Policies</CardTitle>
            </CardHeader>
            <CardContent>
              {permissions.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : permissions.data ? (
                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
                  {JSON.stringify(permissions.data, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">No permissions data</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
