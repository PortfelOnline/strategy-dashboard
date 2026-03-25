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
import { Loader2, Trash2, Edit2, Archive, Send, Sparkles, Calendar, BarChart2, Eye, Heart, RefreshCw, Image, ArrowUpDown, SlidersHorizontal, Clock, Pencil, Video, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { PublishToMeta } from '@/components/PublishToMeta';
import { PublishToWordPress } from '@/components/PublishToWordPress';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import DashboardLayout from '@/components/DashboardLayout';

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
  youtube: '▶️',
};

interface Post {
  id: number;
  title: string;
  content: string;
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'youtube';
  language: string;
  status: string;
  hashtags?: string | null;
  scheduledAt?: Date | string | null;
  mediaUrl?: string | null;
  metaPostId?: string | null;
  postUrl?: string | null;
  metaReach?: number | null;
  metaImpressions?: number | null;
  metaLikes?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function extractContentPreview(content: string): string {
  try {
    const parsed = JSON.parse(content);
    const parts: string[] = [];
    if (parsed.hook) parts.push(parsed.hook);
    if (parsed.paragraphs?.length) parts.push(parsed.paragraphs[0]);
    else if (parsed.voiceover) parts.push(parsed.voiceover);
    else if (parsed.slides?.[0]?.headline) parts.push(parsed.slides[0].headline);
    else if (parsed.frames?.[0]?.text) parts.push(parsed.frames[0].text);
    return parts.join(' — ') || content;
  } catch {
    // Fallback: extract "hook" value via regex when JSON is malformed
    const hookMatch = content.match(/"hook"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (hookMatch) return hookMatch[1];
    // Strip JSON-like punctuation for a plain text preview
    return content.replace(/^\s*\{.*?"hook"\s*:\s*"?/s, '').replace(/".*$/s, '').trim() || content;
  }
}

function extractFullContent(content: string): { hook?: string; paragraphs?: string[]; cta?: string; hashtags?: string; voiceover?: string; sections?: any[]; caption?: string; raw: string } {
  try {
    const parsed = JSON.parse(content);
    return {
      hook: parsed.hook,
      paragraphs: parsed.paragraphs,
      cta: parsed.cta,
      hashtags: parsed.hashtags,
      voiceover: parsed.voiceover,
      sections: parsed.sections,
      caption: parsed.caption,
      raw: content,
    };
  } catch {
    return { raw: content };
  }
}

function formatDateTime(val: Date | string | null | undefined): string {
  if (!val) return '—';
  const d = new Date(val);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ContentLibrary() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [selectedStatus, setSelectedStatus] = useState<Status>('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [selectedPostForWp, setSelectedPostForWp] = useState<Post | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editMediaUrl, setEditMediaUrl] = useState<string>('');
  const [editGalleryOpen, setEditGalleryOpen] = useState(false);
  const { data: galleryData, refetch: refetchGallery } = trpc.content.listGeneratedImages.useQuery(undefined, { enabled: editGalleryOpen });
  const [variationDialogOpen, setVariationDialogOpen] = useState(false);
  const [variation, setVariation] = useState('');
  const [reelDialogOpen, setReelDialogOpen] = useState(false);
  const [reelScript, setReelScript] = useState<any>(null);
  const [reelVideoUrl, setReelVideoUrl] = useState<string | null>(null);
  const [addLinkPostId, setAddLinkPostId] = useState<number | null>(null);
  const [addLinkValue, setAddLinkValue] = useState('');
  const [expandedPostIds, setExpandedPostIds] = useState<Set<number>>(new Set());
  const [generatingImagePostId, setGeneratingImagePostId] = useState<number | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const { data: posts, isLoading } = trpc.content.listPosts.useQuery({ status: selectedStatus });

  const utils = trpc.useUtils();

  const syncPosts = trpc.meta.syncPosts.useMutation({
    onSuccess: (data) => {
      utils.content.listPosts.invalidate();
      toast.success(`Sync done — ${data.updated} post${data.updated === 1 ? '' : 's'} updated`);
    },
    onError: (e) => toast.error('Sync failed: ' + e.message),
  });

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

  const generateReel = trpc.content.generateReelScript.useMutation({
    onSuccess: (data) => {
      setReelScript(data.parsed);
      setReelVideoUrl(null);
      setReelDialogOpen(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const generateReelVideo = trpc.content.generateReelVideo.useMutation({
    onSuccess: (data) => {
      setReelVideoUrl(data.videoUrl);
      toast.success('Video ready!');
    },
    onError: (e) => toast.error(e.message),
  });

  const generateVisual = trpc.content.generateVisual.useMutation({
    onSuccess: async (data, variables) => {
      // Save the generated image URL back to the post
      const postId = generatingImagePostId;
      if (postId) {
        await updatePost.mutateAsync({ id: postId, mediaUrl: data.url });
      }
      setGeneratingImagePostId(null);
      toast.success('Image generated!');
    },
    onError: (e) => {
      setGeneratingImagePostId(null);
      toast.error('Image failed: ' + e.message);
    },
  });

  // Derive industry enum from post title
  function inferIndustry(title: string): string {
    const t = title.toLowerCase();
    if (t.includes('real estate')) return 'real_estate';
    if (t.includes('insurance')) return 'insurance_agent';
    if (t.includes('restaurant') || t.includes('food')) return 'restaurant';
    if (t.includes('e-commerce') || t.includes('ecommerce') || t.includes('meesho') || t.includes('online sell')) return 'ecommerce';
    if (t.includes('coaching') || t.includes('education') || t.includes('tutor')) return 'coaching';
    if (t.includes('travel')) return 'travel_agent';
    if (t.includes('salon') || t.includes('beauty')) return 'salon_beauty';
    if (t.includes('gym') || t.includes('fitness')) return 'gym_fitness';
    if (t.includes('clinic') || t.includes('doctor')) return 'clinic_doctor';
    if (t.includes('loan')) return 'loan_agent';
    if (t.includes('wedding')) return 'wedding_planner';
    return 'retail';
  }

  function handleGenerateImage(post: Post) {
    setGeneratingImagePostId(post.id);
    const hook = extractContentPreview(post.content).slice(0, 200);
    generateVisual.mutate({
      industry: inferIndustry(post.title) as any,
      contentFormat: post.platform === 'instagram' ? 'feed_post' : 'feed_post',
      hook,
      postContent: post.content,
    });
  }

  const suggestHashtags = trpc.content.suggestHashtags.useMutation({
    onSuccess: (data) => {
      setEditHashtags(data.hashtags);
      toast.success('Hashtags suggested!');
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredPosts = (posts || [])
    .filter((post: Post) => {
      const matchesSearch = post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        post.content.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform = platformFilter === 'all' || post.platform === platformFilter;
      return matchesSearch && matchesPlatform;
    })
    .sort((a: Post, b: Post) => {
      // Server returns newest first; 'oldest' reverses that
      return sortOrder === 'oldest' ? a.id - b.id : b.id - a.id;
    });

  const openEditDialog = (post: Post) => {
    setEditingPost(post);
    setEditTitle(post.title);
    setEditContent(post.content);
    setEditHashtags(post.hashtags || '');
    setEditMediaUrl(post.mediaUrl || '');
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingPost) return;
    updatePost.mutate({
      id: editingPost.id,
      title: editTitle,
      content: editContent,
      hashtags: editHashtags,
      mediaUrl: editMediaUrl || null,
    });
  };

  const handleDelete = (post: Post) => {
    if (!window.confirm(`Delete "${post.title}"?`)) return;
    deletePost.mutate({ id: post.id });
  };

  const handleMarkPublished = (post: Post) => {
    updatePost.mutate({ id: post.id, status: 'published' });
    toast.success('Marked as published');
  };

  const handleArchive = (post: Post) => {
    updatePost.mutate({ id: post.id, status: 'archived' });
  };

  return (
    <DashboardLayout>
    <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Library</h1>
            <p className="text-lg text-slate-600">Manage and organize your generated content</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => syncPosts.mutate()}
              disabled={syncPosts.isPending}
              title="Fetch real published posts from Facebook & Instagram and update statuses"
            >
              {syncPosts.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync Meta
            </Button>
            <Button variant="outline" onClick={() => navigate('/calendar')}>
              <Calendar className="w-4 h-4 mr-2" />
              Calendar
            </Button>
          </div>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search posts by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1"
          />
          <div className="flex gap-2">
            {(['all', 'instagram', 'facebook', 'whatsapp', 'youtube'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlatformFilter(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${platformFilter === p ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}
              >
                {p === 'all' ? 'All' : p === 'instagram' ? '📸 IG' : p === 'facebook' ? '👍 FB' : p === 'whatsapp' ? '💬' : '▶️'}
              </button>
            ))}
          </div>
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as 'newest' | 'oldest')}>
            <SelectTrigger className="w-full sm:w-44">
              <ArrowUpDown className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
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
                  {post.mediaUrl && (
                    <img
                      src={post.mediaUrl}
                      alt="Post visual"
                      className="w-full h-36 object-cover rounded-lg border border-slate-200"
                    />
                  )}
                  <div className="flex-1">
                    <div className="bg-slate-50 rounded-lg overflow-hidden">
                      <p className={`text-sm text-slate-700 p-3 whitespace-pre-wrap ${expandedPostIds.has(post.id) ? '' : 'line-clamp-3'}`}>
                        {extractContentPreview(post.content)}
                      </p>
                      <button
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-slate-400 hover:text-slate-600 border-t border-slate-100 transition-colors"
                        onClick={() => setExpandedPostIds(prev => {
                          const next = new Set(prev);
                          next.has(post.id) ? next.delete(post.id) : next.add(post.id);
                          return next;
                        })}
                      >
                        {expandedPostIds.has(post.id)
                          ? <><ChevronUp className="w-3 h-3" />Collapse</>
                          : <><ChevronDown className="w-3 h-3" />Show full post</>}
                      </button>
                    </div>
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

                  {/* Performance metrics for published posts */}
                  {post.status === 'published' && (post.metaReach || post.metaLikes || post.metaImpressions) && (
                    <div className="flex items-center gap-3 px-3 py-2 bg-green-50 rounded-lg border border-green-100">
                      <BarChart2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                      {post.metaReach != null && (
                        <span className="flex items-center gap-1 text-xs text-slate-700">
                          <Eye className="w-3 h-3 text-slate-400" />{post.metaReach.toLocaleString()}
                        </span>
                      )}
                      {post.metaLikes != null && (
                        <span className="flex items-center gap-1 text-xs text-slate-700">
                          <Heart className="w-3 h-3 text-rose-400" />{post.metaLikes.toLocaleString()}
                        </span>
                      )}
                      {post.metaImpressions != null && (
                        <span className="text-xs text-slate-500">{post.metaImpressions.toLocaleString()} impr.</span>
                      )}
                    </div>
                  )}
                  {post.status === 'published' && post.postUrl && (
                    <a
                      href={post.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 hover:underline truncate"
                      title={post.postUrl}
                    >
                      <Send className="w-3 h-3 flex-shrink-0" />
                      View on {post.platform === 'instagram' ? 'Instagram' : 'Facebook'}
                    </a>
                  )}
                  {post.status === 'published' && !post.postUrl && (
                    addLinkPostId === post.id ? (
                      <div className="flex gap-1.5">
                        <Input
                          className="h-7 text-xs flex-1"
                          placeholder="Paste post URL..."
                          value={addLinkValue}
                          onChange={(e) => setAddLinkValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && addLinkValue.trim()) {
                              updatePost.mutate({ id: post.id, postUrl: addLinkValue.trim() });
                              setAddLinkPostId(null);
                              setAddLinkValue('');
                            }
                            if (e.key === 'Escape') { setAddLinkPostId(null); setAddLinkValue(''); }
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            if (addLinkValue.trim()) {
                              updatePost.mutate({ id: post.id, postUrl: addLinkValue.trim() });
                            }
                            setAddLinkPostId(null);
                            setAddLinkValue('');
                          }}
                        >✓</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => { setAddLinkPostId(null); setAddLinkValue(''); }}
                        >✕</Button>
                      </div>
                    ) : (
                      <button
                        className="text-xs text-slate-400 hover:text-blue-600 flex items-center gap-1 transition-colors"
                        onClick={() => { setAddLinkPostId(post.id); setAddLinkValue(''); }}
                      >
                        <Send className="w-3 h-3" />Add post link
                      </button>
                    )
                  )}
                  {post.status === 'published' && post.metaPostId && !post.metaReach && !post.metaLikes && (
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />Stats available — fetch via Meta API
                    </p>
                  )}

                  {(post.createdAt || post.updatedAt) && (
                    <div className="flex flex-col gap-1 text-xs text-slate-400 border-t pt-3">
                      {post.createdAt && (
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          Created: {formatDateTime(post.createdAt)}
                        </span>
                      )}
                      {post.updatedAt && post.updatedAt !== post.createdAt && (
                        <span className="flex items-center gap-1.5">
                          <Pencil className="w-3 h-3 flex-shrink-0" />
                          Updated: {formatDateTime(post.updatedAt)}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setPreviewPost(post)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      Preview
                    </Button>
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
                      {generateVariation.isPending && selectedPost?.id === post.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      Vary
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-purple-600 hover:text-purple-700"
                      title="Generate Reel Script"
                      onClick={() => {
                        setSelectedPost(post);
                        generateReel.mutate({ content: post.content, platform: post.platform });
                      }}
                      disabled={generateReel.isPending && selectedPost?.id === post.id}
                    >
                      {generateReel.isPending && selectedPost?.id === post.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4 mr-1" />}
                      Reel
                    </Button>
                    {/* Generate Image button — always visible */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-orange-600 hover:text-orange-700 border-orange-200"
                      title="Generate image for this post"
                      onClick={() => handleGenerateImage(post)}
                      disabled={generatingImagePostId === post.id}
                    >
                      {generatingImagePostId === post.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Image className="w-4 h-4 mr-1" />}
                      {post.mediaUrl ? 'Regen' : 'Image'}
                    </Button>

                    {post.status === 'draft' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-slate-500 hover:text-green-700 hover:border-green-300"
                          title="Already posted manually? Mark as Published"
                          onClick={() => handleMarkPublished(post)}
                          disabled={updatePost.isPending}
                        >
                          ✓ Mark done
                        </Button>
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
                <label className="text-sm font-medium">Image</label>
                <Button variant="ghost" size="sm" onClick={() => { setEditGalleryOpen(true); refetchGallery(); }}>
                  <Image className="w-4 h-4 mr-1" />Change Image
                </Button>
              </div>
              {editMediaUrl ? (
                <div className="relative">
                  <img src={editMediaUrl} alt="Post visual" className="w-full h-32 object-cover rounded-lg border" />
                  <button onClick={() => setEditMediaUrl('')} className="absolute top-1 right-1 bg-black/50 text-white text-xs rounded px-1.5 py-0.5 hover:bg-black/70">✕ Remove</button>
                </div>
              ) : (
                <button onClick={() => { setEditGalleryOpen(true); refetchGallery(); }} className="w-full h-20 border-2 border-dashed border-slate-200 rounded-lg flex items-center justify-center text-sm text-slate-400 hover:border-violet-400 hover:text-violet-500 transition-colors">
                  + Pick from gallery
                </button>
              )}
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

      {/* Image Gallery picker for edit dialog */}
      <Dialog open={editGalleryOpen} onOpenChange={setEditGalleryOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-5 h-5 text-violet-600" />
              Pick Image
            </DialogTitle>
          </DialogHeader>
          {!galleryData || galleryData.images.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">No images yet — generate one in the Generator.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 pt-2">
              {galleryData.images.map((img) => (
                <button
                  key={img.url}
                  onClick={() => { setEditMediaUrl(img.url); setEditGalleryOpen(false); }}
                  className={`relative group rounded-xl overflow-hidden border-2 transition-all ${editMediaUrl === img.url ? 'border-violet-500 ring-2 ring-violet-300' : 'border-slate-200 hover:border-violet-400'}`}
                >
                  <img src={img.url} alt={img.filename} className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-end">
                    <span className="w-full text-center text-white text-xs py-1 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">Use this</span>
                  </div>
                  {editMediaUrl === img.url && (
                    <div className="absolute top-1 right-1 bg-violet-500 text-white text-xs rounded-full px-1.5 py-0.5">✓</div>
                  )}
                </button>
              ))}
            </div>
          )}
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

      {/* Full Post Preview Dialog */}
      <Dialog open={!!previewPost} onOpenChange={(open) => { if (!open) setPreviewPost(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
          {previewPost && (() => {
            const fc = extractFullContent(previewPost.content);
            const isFB = previewPost.platform === 'facebook';
            const copyText = [
              fc.hook,
              ...(fc.paragraphs ?? []),
              fc.cta,
              fc.hashtags ?? previewPost.hashtags,
            ].filter(Boolean).join('\n\n');

            const handleCopy = (text: string, field: string) => {
              navigator.clipboard.writeText(text);
              setCopiedField(field);
              setTimeout(() => setCopiedField(null), 2000);
            };

            return (
              <div>
                {/* Platform header */}
                <div className={`flex items-center gap-3 px-4 py-3 border-b ${isFB ? 'bg-blue-600' : 'bg-gradient-to-r from-purple-600 to-pink-500'}`}>
                  <span className="text-white text-lg font-bold">{isFB ? '👍 Facebook' : '📸 Instagram'}</span>
                  <Badge className="ml-auto bg-white/20 text-white border-0 text-xs">{previewPost.status}</Badge>
                </div>

                {/* Post content */}
                <div className="p-4 space-y-3">
                  {/* Image */}
                  {previewPost.mediaUrl && (
                    <img src={previewPost.mediaUrl} alt="Post visual" className="w-full rounded-xl object-cover max-h-72" />
                  )}

                  {/* Text body */}
                  <div className="space-y-2 text-sm text-slate-800 leading-relaxed">
                    {fc.hook && (
                      <p className="font-semibold text-base">{fc.hook}</p>
                    )}
                    {fc.paragraphs?.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                    {!fc.hook && !fc.paragraphs && fc.voiceover && (
                      <p className="italic text-slate-600">{fc.voiceover}</p>
                    )}
                    {!fc.hook && !fc.paragraphs && !fc.voiceover && (
                      <p className="whitespace-pre-wrap">{fc.raw}</p>
                    )}
                    {fc.cta && (
                      <p className="font-semibold text-blue-700">👉 {fc.cta}</p>
                    )}
                  </div>

                  {/* Hashtags */}
                  {(fc.hashtags || previewPost.hashtags) && (
                    <p className="text-xs text-blue-500 leading-relaxed">{fc.hashtags || previewPost.hashtags}</p>
                  )}
                </div>

                {/* Action bar */}
                <div className="flex gap-2 px-4 pb-4">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => handleCopy(copyText, 'post')}
                  >
                    {copiedField === 'post' ? <Check className="w-4 h-4 mr-1 text-green-600" /> : <Copy className="w-4 h-4 mr-1" />}
                    {copiedField === 'post' ? 'Copied!' : 'Copy post'}
                  </Button>
                  {(fc.hashtags || previewPost.hashtags) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleCopy((fc.hashtags || previewPost.hashtags)!, 'tags')}
                    >
                      {copiedField === 'tags' ? <Check className="w-4 h-4 mr-1 text-green-600" /> : <Copy className="w-4 h-4 mr-1" />}
                      {copiedField === 'tags' ? 'Copied!' : 'Copy hashtags'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { setPreviewPost(null); openEditDialog(previewPost); }}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Reel Script Dialog */}
      <Dialog open={reelDialogOpen} onOpenChange={setReelDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="w-5 h-5 text-purple-600" />
              Reel Script — 15-20 sec
            </DialogTitle>
          </DialogHeader>
          {reelScript ? (
            <div className="space-y-4 pt-2">
              {/* Hook */}
              <div className="rounded-xl bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-bold text-red-600 uppercase mb-1">⚡ Hook (0-2 sec)</p>
                <p className="text-sm font-semibold text-slate-900">{reelScript.hook}</p>
                {reelScript.pattern_interrupt && (
                  <p className="text-xs text-slate-500 mt-1">🎥 Visual: {reelScript.pattern_interrupt}</p>
                )}
              </div>

              {/* Sections */}
              {reelScript.sections?.map((s: any, i: number) => {
                const colors: Record<string, string> = {
                  HOOK: 'bg-red-500', PROBLEM: 'bg-orange-500',
                  SOLUTION: 'bg-blue-600', 'SAVE TRIGGER': 'bg-green-600', CTA: 'bg-purple-600',
                };
                return (
                  <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-slate-400 font-mono">{s.time}</span>
                      <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${colors[s.label] ?? 'bg-slate-600'}`}>{s.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">🎥 {s.visual}</p>
                    <p className="text-sm font-medium text-slate-800">🎙 {s.script}</p>
                  </div>
                );
              })}

              {/* Voiceover */}
              {reelScript.voiceover && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-blue-600">Full Voiceover Script</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-blue-600"
                      onClick={() => { navigator.clipboard.writeText(reelScript.voiceover); toast.success('Copied!'); }}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed italic">{reelScript.voiceover}</p>
                </div>
              )}

              {/* Algorithm tips */}
              <div className="rounded-xl border border-green-100 bg-green-50 p-3 space-y-2">
                <p className="text-xs font-bold text-green-700 uppercase">Algorithm Boosters</p>
                {reelScript.save_trigger && (
                  <p className="text-xs text-slate-700"><span className="font-semibold text-green-700">💾 Save trigger:</span> {reelScript.save_trigger}</p>
                )}
                {reelScript.comment_question && (
                  <p className="text-xs text-slate-700"><span className="font-semibold text-green-700">💬 Comment bait:</span> {reelScript.comment_question}</p>
                )}
                {reelScript.music_vibe && (
                  <p className="text-xs text-slate-700"><span className="font-semibold text-green-700">🎵 Music:</span> {reelScript.music_vibe}</p>
                )}
              </div>

              {/* Text overlays */}
              {reelScript.text_overlays?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Text Overlays (CapCut)</p>
                  <div className="flex flex-wrap gap-1">
                    {reelScript.text_overlays.map((t: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Caption */}
              {reelScript.caption && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Caption</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => { navigator.clipboard.writeText(reelScript.caption); toast.success('Copied!'); }}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-line">{reelScript.caption}</p>
                </div>
              )}

              {/* Video Generation */}
              <div className="rounded-xl border-2 border-purple-200 bg-purple-50 p-4 space-y-3">
                <p className="text-sm font-bold text-purple-700">🎬 Generate Video (no filming needed)</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={generateReelVideo.isPending || !selectedPost?.mediaUrl}
                    onClick={() => generateReelVideo.mutate({
                      mode: 'slideshow',
                      voiceover: reelScript.voiceover,
                      textOverlays: reelScript.text_overlays || [],
                      sections: reelScript.sections || [],
                      imageUrls: selectedPost?.mediaUrl ? [selectedPost.mediaUrl] : [],
                    })}
                    title={!selectedPost?.mediaUrl ? 'Post needs an image — add one in Edit' : ''}
                  >
                    {generateReelVideo.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : '🖼️'}
                    Slideshow (my image)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 border-purple-300 text-purple-700 hover:bg-purple-100"
                    disabled={generateReelVideo.isPending}
                    onClick={() => generateReelVideo.mutate({
                      mode: 'stock',
                      voiceover: reelScript.voiceover,
                      textOverlays: reelScript.text_overlays || [],
                      sections: reelScript.sections || [],
                    })}
                  >
                    {generateReelVideo.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : '🎞️'}
                    Stock footage (Pexels)
                  </Button>
                </div>
                {!selectedPost?.mediaUrl && (
                  <p className="text-xs text-slate-500">Slideshow requires a post image. Edit the post to add one, or use Stock footage.</p>
                )}
                {generateReelVideo.isPending && (
                  <p className="text-xs text-purple-600 animate-pulse">Generating video... this takes ~30-60 seconds ⏳</p>
                )}
              </div>

              {/* Video Player */}
              {reelVideoUrl && (
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                    <p className="text-xs font-semibold text-slate-600">✅ Ready to upload to Instagram</p>
                    <a
                      href={reelVideoUrl}
                      download
                      className="text-xs text-blue-600 hover:underline font-medium"
                    >
                      Download MP4
                    </a>
                  </div>
                  <video
                    src={reelVideoUrl}
                    controls
                    className="w-full max-h-96 bg-black"
                    style={{ aspectRatio: '9/16', maxWidth: '240px', margin: '0 auto', display: 'block' }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-purple-500" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
