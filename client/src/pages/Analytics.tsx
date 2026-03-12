import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2, TrendingUp, CheckCircle, Clock, FileText, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import DashboardLayout from '@/components/DashboardLayout';

const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#E1306C',
  whatsapp: '#25D366',
  youtube: '#FF0000',
};

const STATUS_COLORS = ['#FBBF24', '#3B82F6', '#10B981', '#9CA3AF'];

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: '👍',
  instagram: '📸',
  whatsapp: '💬',
  youtube: '▶️',
};

export default function Analytics() {
  const { data: stats, isLoading } = trpc.content.getStats.useQuery();

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </DashboardLayout>
    );
  }

  if (!stats) return null;

  const statusData = [
    { name: 'Draft', value: stats.byStatus.draft },
    { name: 'Scheduled', value: stats.byStatus.scheduled },
    { name: 'Published', value: stats.byStatus.published },
    { name: 'Archived', value: stats.byStatus.archived },
  ];

  const platformData = stats.byPlatform.map(p => ({
    ...p,
    fill: PLATFORM_COLORS[p.name] || '#6B7280',
  }));

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Analytics</h1>
          <p className="text-slate-600">Overview of your content performance</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-l-4 border-l-slate-400">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <FileText className="w-4 h-4 text-slate-500" />
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Total Posts</span>
              </div>
              <div className="text-3xl font-bold text-slate-900">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-green-500">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Published (month)</span>
              </div>
              <div className="text-3xl font-bold text-green-700">{stats.publishedThisMonth}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Scheduled (week)</span>
              </div>
              <div className="text-3xl font-bold text-blue-700">{stats.scheduledThisWeek}</div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-400">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-yellow-500" />
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Drafts</span>
              </div>
              <div className="text-3xl font-bold text-yellow-700">{stats.byStatus.draft}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Posts by Platform</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={platformData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} tickFormatter={n => n.charAt(0).toUpperCase() + n.slice(1)} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip formatter={(val) => [val, 'Posts']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {platformData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Posts by Status</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    paddingAngle={3}
                  >
                    {statusData.map((_, i) => (
                      <Cell key={i} fill={STATUS_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val, name) => [val, name]} />
                  <Legend iconType="circle" iconSize={10} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Upcoming posts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-500" />
              Upcoming Scheduled Posts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.upcoming.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <Calendar className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                <p>No upcoming posts scheduled</p>
                <p className="text-sm mt-1">Go to the Calendar to schedule posts</p>
              </div>
            ) : (
              <div className="divide-y">
                {stats.upcoming.map((post: any) => (
                  <div key={post.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{PLATFORM_EMOJI[post.platform] || '📱'}</span>
                      <div>
                        <p className="font-medium text-sm text-slate-800">{post.title}</p>
                        <p className="text-xs text-slate-500 capitalize">{post.platform}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 text-xs">
                        {post.scheduledAt ? format(new Date(post.scheduledAt), 'MMM d, HH:mm') : '—'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
