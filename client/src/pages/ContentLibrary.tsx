import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Loader2, Trash2, Edit2, Share2, Calendar, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PublishToMeta } from '@/components/PublishToMeta';

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

export default function ContentLibrary() {
  const { user } = useAuth();
  const [selectedStatus, setSelectedStatus] = useState<Status>('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<any>(null);

  const { data: posts, isLoading } = trpc.content.listPosts.useQuery({
    status: selectedStatus,
  });

  const filteredPosts = posts?.filter(post =>
    post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    post.content.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Library</h1>
          <p className="text-lg text-slate-600">Manage and organize your generated content</p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <Input
            placeholder="Search posts by title or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Status Tabs */}
        <Tabs value={selectedStatus} onValueChange={(value) => setSelectedStatus(value as Status)} className="mb-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="published">Published</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Posts Grid */}
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
            {filteredPosts.map((post) => (
              <Card key={post.id} className="shadow-lg hover:shadow-xl transition-shadow">
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

                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm text-slate-700 line-clamp-3 bg-slate-50 p-3 rounded-lg">
                      {post.content}
                    </p>
                  </div>

                  {post.hashtags && (
                    <div className="flex flex-wrap gap-1">
                      {post.hashtags.split(' ').slice(0, 3).map((tag, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
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

                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    {post.status === 'draft' && (
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
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                    >
                      <Share2 className="w-4 h-4 mr-1" />
                      Share
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
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

      {selectedPost && (
        <PublishToMeta
          open={publishDialogOpen}
          onOpenChange={setPublishDialogOpen}
          postId={selectedPost.id}
          content={selectedPost.content}
          platform={selectedPost.platform}
          imageUrl={selectedPost.mediaUrl}
        />
      )}
    </div>
  );
}
