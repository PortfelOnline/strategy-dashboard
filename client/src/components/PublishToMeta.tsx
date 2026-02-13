import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { Loader2, Facebook, Instagram } from 'lucide-react';

interface PublishToMetaProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  postId: number;
  content: string;
  platform: string;
  imageUrl?: string;
}

export function PublishToMeta({
  open,
  onOpenChange,
  postId,
  content,
  platform,
  imageUrl,
}: PublishToMetaProps) {
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  const { data: accounts = [] } = trpc.meta.getAccounts.useQuery();
  const { mutate: publishInstagram, isPending: isPublishingInstagram } =
    trpc.meta.publishToInstagram.useMutation({
      onSuccess: () => {
        toast.success('Posted to Instagram successfully!');
        onOpenChange(false);
        setSelectedAccount('');
      },
      onError: (error: any) => {
        toast.error(error?.message || 'Failed to post to Instagram');
      },
    });

  const { mutate: publishFacebook, isPending: isPublishingFacebook } =
    trpc.meta.publishToFacebook.useMutation({
      onSuccess: () => {
        toast.success('Posted to Facebook successfully!');
        onOpenChange(false);
        setSelectedAccount('');
      },
      onError: (error: any) => {
        toast.error(error?.message || 'Failed to post to Facebook');
      },
    });

  const handlePublish = () => {
    if (!selectedAccount) {
      toast.error('Please select an account');
      return;
    }

    const account = accounts.find((a) => a.accountId === selectedAccount);
    if (!account) return;

    if (account.accountType === 'instagram_business') {
      publishInstagram({
        accountId: selectedAccount,
        postId,
        caption: content,
        imageUrl,
      });
    } else {
      publishFacebook({
        pageId: selectedAccount,
        postId,
        message: content,
        imageUrl,
      });
    }
  };

  const filteredAccounts = accounts.filter((account) => {
    if (platform === 'instagram') {
      return account.accountType === 'instagram_business';
    } else if (platform === 'facebook') {
      return account.accountType === 'facebook_page';
    }
    return true;
  });

  const isPublishing = isPublishingInstagram || isPublishingFacebook;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to {platform === 'instagram' ? 'Instagram' : 'Facebook'}</DialogTitle>
          <DialogDescription>
            Select the account where you want to publish this content
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Content Preview */}
          <div className="bg-slate-50 p-4 rounded-lg">
            <p className="text-sm text-slate-600 line-clamp-3">{content}</p>
            {imageUrl && (
              <div className="mt-3">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-40 object-cover rounded"
                />
              </div>
            )}
          </div>

          {/* Account Selection */}
          {filteredAccounts.length > 0 ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Account</label>
              <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an account..." />
                </SelectTrigger>
                <SelectContent>
                  {filteredAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.accountId}>
                      <div className="flex items-center gap-2">
                        {account.accountType === 'instagram_business' ? (
                          <Instagram className="w-4 h-4 text-pink-500" />
                        ) : (
                          <Facebook className="w-4 h-4 text-blue-600" />
                        )}
                        {account.accountName}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                No connected accounts for {platform}. Please connect your account first.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handlePublish}
            disabled={isPublishing || !selectedAccount || filteredAccounts.length === 0}
          >
            {isPublishing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              'Publish Now'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
