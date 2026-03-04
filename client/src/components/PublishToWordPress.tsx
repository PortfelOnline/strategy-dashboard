import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Loader2, Globe } from 'lucide-react';

interface PublishToWordPressProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: number;
  title: string;
  content: string;
}

export function PublishToWordPress({
  open,
  onOpenChange,
  postId,
  title,
  content,
}: PublishToWordPressProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [publishStatus, setPublishStatus] = useState<'publish' | 'draft'>('publish');

  const { data: accounts = [] } = trpc.wordpress.getAccounts.useQuery();

  const { mutate: publish, isPending } = trpc.wordpress.publishPost.useMutation({
    onSuccess: (data) => {
      toast.success(
        publishStatus === 'publish'
          ? `Published to WordPress! ${data.link}`
          : 'Saved as draft in WordPress'
      );
      onOpenChange(false);
      setSelectedAccountId('');
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to publish to WordPress');
    },
  });

  const handlePublish = () => {
    if (!selectedAccountId) {
      toast.error('Please select a WordPress site');
      return;
    }
    publish({
      accountId: Number(selectedAccountId),
      postId,
      title,
      content,
      status: publishStatus,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to WordPress</DialogTitle>
          <DialogDescription>
            Select the site and publishing mode
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Content Preview */}
          <div className="bg-slate-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-slate-800 mb-1">{title}</p>
            <p className="text-sm text-slate-600 line-clamp-3">{content}</p>
          </div>

          {/* Site Selection */}
          {accounts.length > 0 ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Site</label>
              <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a site..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={String(account.id)}>
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-slate-500" />
                        {account.siteName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                No WordPress sites connected. Add one on the WordPress page.
              </p>
            </div>
          )}

          {/* Publish mode */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Mode</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="wpStatus"
                  value="publish"
                  checked={publishStatus === 'publish'}
                  onChange={() => setPublishStatus('publish')}
                />
                <span className="text-sm">Publish now</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="wpStatus"
                  value="draft"
                  checked={publishStatus === 'draft'}
                  onChange={() => setPublishStatus('draft')}
                />
                <span className="text-sm">Save as draft</span>
              </label>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handlePublish}
            disabled={isPending || !selectedAccountId || accounts.length === 0}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              publishStatus === 'publish' ? 'Publish' : 'Save Draft'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
