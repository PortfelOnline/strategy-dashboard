import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Trash2, Edit2, Archive, Send, Sparkles, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { PublishToMeta } from '@/components/PublishToMeta';
import { PublishToWordPress } from '@/components/PublishToWordPress';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';

type Status = 'draft' | 'scheduled' | 'published' | 'archived';

const statusColors: Record<Status, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
};

const platformEmojis: Record<string, string> = {
  facebook: '👍',
  instagram: '📸',
  whatsapp: '💬',
};

interface Post {
  id: number;
  title: string;
  content: string;
  platform: 'facebook' | 'instagram' | 'whatsapp';
  language: string;
  status: string;
  hashtags?: string | null;
  scheduledAt?: Date | string | null;
  mediaUrl?: string | null;
}

export default function ContentLibrary() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedStatus, setSelectedStatus] = useState<Status>('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [selectedPostForWp, setSelectedPostForWp] = useState<Post | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [variationDialogOpen, setVariationDialogOpen] = useState(false);
  const [variation, setVariation] = useState('');

  const { data: posts, isLoading } = trpc.content.listPosts.useQuery({ status: selectedStatus });

  const utils = trpc.useUtils();

  const updatePost = trpc.content.updatePost.useMutation({
    onSuccess: () => {
      utils.content.listPosts.invalidate();
      toast.success('Post updated');
      setEditDialogOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const deletePost = trpc.content.deletePost.useMutation({
    onSuccess: () => {
      utils.content.listPosts.invalidate();
      toast.success('Post deleted');
    },
    onError: (e) => toast.error(e.message),
  });

  const generateVariation = trpc.content.generateVariation.useMutation({
    onSuccess: (data) => {
      setVariation(data.variation);
      setVariationDialogOpen(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const suggestHashtags = trpc.content.suggestHashtags.useMutation({
    onSuccess: (data) => {
      setEditHashtags(data.hashtags);
      toast.success('Hashtags suggested!');
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredPosts = posts?.filter((post: Post) =>
    post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.content.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const openEditDialog = (post: Post) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditHashtags(post.hashtags || '');
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingPost) return;
    updatePost.mutate({
      id: editingPost.id,
      title: editTitle,
      content: editContent,
      hashtags: editHashtags,
    });
  };

  const handleDelete = (post: Post) => {
    if (!window.confirm(`Delete "${post.title}"?`)) return;
    deletePost.mutate({ id: post.id });
  };

  const handleArchive = (post: Post) => {
    updatePost.mutate({ id: post.id, status: 'archived' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Library</h1>
            <p className="text-lg text-slate-600">Manage and organize your generated content</p>
          </div>
          <Button variant="outline" onClick={() => navigate('/calendar')}>
            <Calendar className="w-4 h-4 mr-2" />
            Calendar
          </Button>
        </div>

        <div className="mb-6">
          <Input
            placeholder="Search posts by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        <Tabs value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as Status)} className="mb-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        ) : filteredPosts.length === 0 ? (
          <Card className="shadow-lg">
            <CardContent className="py-12 text-center">
              <div className="text-4xl mb-4">📭</div>
              <p className="text-slate-600 text-lg">No posts found in {selectedStatus} status</p>
              <p className="text-slate-500 text-sm mt-2">Start creating content to see it here</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPosts.map((post: Post) => (
              <Card key={post.id} className="shadow-lg hover:shadow-xl transition-shadow flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <CardTitle className="text-lg line-clamp-2">{post.title}</CardTitle>
                    <Badge className={statusColors[post.status as Status]}>
                      {post.status}
                    </Badge>
                  </div>
                  <CardDescription className="flex items-center gap-2">
                    <span>{platformEmojis[post.platform] || '📱'}</span>
                    <span className="capitalize">{post.platform}</span>
                    <span>•</span>
                    <span className="capitalize">{post.language}</span>
                  </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4 flex-1 flex flex-col">
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 line-clamp-3 bg-slate-50 p-3 rounded-lg">
                      {post.content}
                    </p>
                  </div>

                  {post.hashtags && (
                    <div className="flex flex-wrap gap-1">
                      {post.hashtags.split(' ').slice(0, 3).map((tag, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                      {post.hashtags.split(' ').length > 3 && (
                        <Badge variant="secondary" className="text-xs">
                          +{post.hashtags.split(' ').length - 3}
                        </Badge>
                      )}
                    </div>
                  )}

                  {post.scheduledAt && (
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Calendar className="w-4 h-4" />
                      <span>{new Date(post.scheduledAt).toLocaleDateString()}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => openEditDialog(post)}
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedPost(post);
                        generateVariation.mutate({ content: post.content, platform: post.platform, language: post.language as any });
                      }}
                      disabled={generateVariation.isPending}
                    >
                      {generateVariation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      Vary
                    </Button>
                    {post.status === 'draft' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-blue-600 hover:text-blue-700"
                          onClick={() => {
                            setSelectedPost(post);
                            setPublishDialogOpen(true);
                          }}
                        >
                          <Send className="w-4 h-4 mr-1" />
                          Publish
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-orange-600 hover:text-orange-700"
                          title="Publish to WordPress"
                          onClick={() => {
                            setSelectedPostForWp(post);
                            setWpDialogOpen(true);
                          }}
                        >
                          WP
                        </Button>
                      </>
                    )}
                    {post.status !== 'archived' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleArchive(post)}
                        disabled={updatePost.isPending}
                      >
                        <Archive className="w-4 h-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(post)}
                      disabled={deletePost.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                className="mt-1"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Content</label>
              <Textarea
                className="mt-1 min-h-32"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium">Hashtags</label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => editingPost && suggestHashtags.mutate({ content: editContent, platform: editingPost.platform })}
                  disabled={suggestHashtags.isPending}
                >
                  {suggestHashtags.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Sparkles className="w-4 h-4 mr-1" />}
                  AI Suggest
                </Button>
              </div>
              <Input
                value={editHashtags}
                onChange={(e) => setEditHashtags(e.target.value)}
                placeholder="#hashtag1 #hashtag2"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updatePost.isPending}>
              {updatePost.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Variation Dialog */}
      <Dialog open={variationDialogOpen} onOpenChange={setVariationDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Content Variation</DialogTitle>
          </DialogHeader>
          <div className="bg-slate-50 p-4 rounded-lg whitespace-pre-wrap text-sm">
            {variation}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVariationDialogOpen(false)}>Close</Button>
            <Button onClick={() => {
              if (selectedPost) {
                openEditDialog({ ...selectedPost, content: variation });
              }
              setVariationDialogOpen(false);
            }}>
              Use This Variation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedPost && (
        <PublishToMeta
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          postId={selectedPost.id}
          content={selectedPost.content}
          platform={selectedPost.platform}
          imageUrl={selectedPost.mediaUrl ?? undefined}
        />
      )}

      {selectedPostForWp && (
        <PublishToWordPress
          open={wpDialogOpen}
          onOpenChange={setWpDialogOpen}
          postId={selectedPostForWp.id}
          title={selectedPostForWp.title}
          content={selectedPostForWp.content}
        />
      )}
    </div>
  );
}
