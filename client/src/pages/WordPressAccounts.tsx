import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';
import { Globe, Trash2, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function WordPressAccounts() {
  const [siteUrl, setSiteUrl] = useState('');
  const [siteName, setSiteName] = useState('');
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');

  const utils = trpc.useUtils();

  const { data: accounts, isLoading } = trpc.wordpress.getAccounts.useQuery();

  const { mutate: addAccount, isPending: isAdding } = trpc.wordpress.addAccount.useMutation({
    onSuccess: (data) => {
      toast.success(`Connected: ${data.siteName}`);
      setSiteUrl('');
      setSiteName('');
      setUsername('');
      setAppPassword('');
      utils.wordpress.getAccounts.invalidate();
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to connect site');
    },
  });

  const { mutate: disconnect } = trpc.wordpress.disconnectAccount.useMutation({
    onSuccess: () => {
      toast.success('Site disconnected');
      utils.wordpress.getAccounts.invalidate();
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to disconnect site');
    },
  });

  const handleConnect = () => {
    if (!siteUrl || !siteName || !username || !appPassword) {
      toast.error('Please fill in all fields');
      return;
    }
    addAccount({ siteUrl, siteName, username, appPassword });
  };

  const handleDisconnect = (accountId: number, name: string) => {
    if (!confirm(`Disconnect "${name}"?`)) return;
    disconnect({ accountId });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">WordPress Sites</h1>
          <p className="text-slate-600">Connect WordPress sites via Application Password to publish content directly</p>
        </div>

        {/* Connect form */}
        <Card className="mb-8 border-2 border-dashed">
          <CardHeader>
            <CardTitle>Connect a Site</CardTitle>
            <CardDescription>
              Use a WordPress Application Password (Settings → Users → Application Passwords in WP Admin)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Site URL</label>
                <Input
                  placeholder="https://example.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Site Name</label>
                <Input
                  placeholder="My Blog"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Username</label>
                <Input
                  placeholder="admin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Application Password</label>
                <Input
                  type="password"
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                  value={appPassword}
                  onChange={(e) => setAppPassword(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={handleConnect} disabled={isAdding} className="gap-2">
              {isAdding ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Connect Site
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Accounts list */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-slate-900">Connected Sites</h2>

          {isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </CardContent>
            </Card>
          ) : accounts && accounts.length > 0 ? (
            <div className="grid gap-4">
              {accounts.map((account) => (
                <Card key={account.id} className="hover:shadow-lg transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-slate-100 rounded-lg">
                          <Globe className="w-5 h-5 text-slate-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{account.siteName}</h3>
                          <p className="text-sm text-slate-500">{account.siteUrl}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline">{account.username}</Badge>
                            <Badge className="bg-green-100 text-green-800">Active</Badge>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(account.id, account.siteName)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <p className="text-slate-600 mb-2">No sites connected yet</p>
                <p className="text-sm text-slate-500">Add your first WordPress site above</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
