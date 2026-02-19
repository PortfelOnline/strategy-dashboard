import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Calendar } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay } from 'date-fns';

interface ScheduledPost {
  id: number;
  title: string;
  platform: 'facebook' | 'instagram' | 'whatsapp';
  scheduledAt: Date | string | null;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
}

export default function ContentCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [draggedPost, setDraggedPost] = useState<ScheduledPost | null>(null);

  // Get all posts
  const { data: posts = [] } = trpc.content.listPosts.useQuery({ status: 'scheduled' });

  // Get calendar days
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Get posts for a specific date
  const getPostsForDate = (date: Date) => {
    return posts.filter((post: ScheduledPost) => post.scheduledAt && isSameDay(new Date(post.scheduledAt), date));
  };

  // Handle drag start
  const handleDragStart = (post: ScheduledPost) => {
    setDraggedPost(post);
  };

  // Handle drop on date
  const handleDrop = (date: Date) => {
    if (draggedPost) {
      // Update post scheduled time
      console.log(`Moving post ${draggedPost.id} to ${format(date, 'yyyy-MM-dd')}`);
      setDraggedPost(null);
    }
  };

  // Handle date click
  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    setShowScheduleDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Calendar</h1>
          <p className="text-slate-600">Plan and schedule your social media posts</p>
        </div>

        {/* Calendar Controls */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentDate(addDays(currentDate, -30))}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-2xl font-bold min-w-48 text-center">
                  {format(currentDate, 'MMMM yyyy')}
                </h2>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCurrentDate(addDays(currentDate, 30))}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Button onClick={() => setCurrentDate(new Date())}>
                Today
              </Button>
            </div>
          </CardHeader>
        </Card>

        {/* Calendar Grid */}
        <Card>
          <CardContent className="p-6">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center font-semibold text-slate-600 py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar days */}
            <div className="grid grid-cols-7 gap-2">
              {days.map(day => {
                const dayPosts = getPostsForDate(day);
                const isCurrentMonth = isSameMonth(day, currentDate);
                const isToday = isSameDay(day, new Date());

                return (
                    <div
                      key={day.toString()}
                      onClick={() => handleDateClick(day)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(day)}
                      className={`
                        min-h-32 p-2 border rounded-lg cursor-pointer transition-all
                        ${isCurrentMonth ? 'bg-white' : 'bg-slate-50'}
                        ${isToday ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}
                      `}
                    >
                      <div className={`text-sm font-semibold mb-2 ${isToday ? 'text-blue-600' : 'text-slate-600'}`}>
                        {format(day, 'd')}
                      </div>

                      {/* Posts for this date */}
                      <div className="space-y-1">
                        {dayPosts.map((post: ScheduledPost) => (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={() => handleDragStart(post)}
                          className="bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs p-1 rounded cursor-move hover:shadow-md transition-shadow truncate"
                        >
                          {post.title}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Schedule Dialog */}
        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Schedule Post</DialogTitle>
              <DialogDescription>
                {selectedDate && `Schedule a post for ${format(selectedDate, 'MMMM d, yyyy')}`}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Select Post from Library</label>
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                  {posts.filter((p: ScheduledPost) => p.status === 'draft').map((post: ScheduledPost) => (
                    <Card
                      key={post.id}
                      className="p-3 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => {
                        console.log(`Scheduling post ${post.id} for ${selectedDate}`);
                        setShowScheduleDialog(false);
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm">{post.title}</p>
                          <Badge variant="outline" className="mt-1">{post.platform}</Badge>
                        </div>
                        <Clock className="w-4 h-4 text-slate-400" />
                      </div>
                    </Card>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Time</label>
                <input
                  type="time"
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  defaultValue="09:00"
                />
              </div>

              <Button className="w-full">Schedule Post</Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Scheduled This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {posts.filter((p: ScheduledPost) => p.scheduledAt && isSameMonth(new Date(p.scheduledAt), currentDate)).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {posts.filter((p: ScheduledPost) => {
                  if (!p.scheduledAt) return false;
                  const postDate = new Date(p.scheduledAt);
                  const today = new Date();
                  const weekEnd = addDays(today, 7);
                  return postDate >= today && postDate <= weekEnd;
                }).length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Platforms</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {['facebook', 'instagram', 'whatsapp'].map((platform: string) => (
                  <div key={platform} className="flex justify-between text-sm">
                    <span className="text-slate-600">{platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
                    <span className="font-semibold">
                      {posts.filter((p: ScheduledPost) => p.platform === platform as any).length}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
