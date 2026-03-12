import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Calendar, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import {
  format, addMonths, subMonths, startOfMonth, endOfMonth,
  eachDayOfInterval, isSameMonth, isSameDay, addDays, getDay,
} from 'date-fns';
import DashboardLayout from '@/components/DashboardLayout';

interface ScheduledPost {
  id: number;
  title: string;
  platform: 'facebook' | 'instagram' | 'whatsapp' | 'youtube';
  scheduledAt: Date | string | null;
  status: 'draft' | 'scheduled' | 'published' | 'archived';
}

const PLATFORM_COLORS: Record<string, string> = {
  facebook: 'bg-blue-600 text-white',
  instagram: 'bg-gradient-to-r from-pink-500 to-purple-600 text-white',
  whatsapp: 'bg-green-500 text-white',
  youtube: 'bg-red-500 text-white',
};

const PLATFORM_EMOJI: Record<string, string> = {
  facebook: '👍',
  instagram: '📸',
  whatsapp: '💬',
  youtube: '▶️',
};

export default function ContentCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [draggedPost, setDraggedPost] = useState<ScheduledPost | null>(null);
  const [selectedSchedulePost, setSelectedSchedulePost] = useState<ScheduledPost | null>(null);
  const [selectedTime, setSelectedTime] = useState('09:00');

  const utils = trpc.useUtils();

  const { data: scheduledPosts = [] } = trpc.content.listPosts.useQuery({ status: 'scheduled' });
  const { data: draftPosts = [] } = trpc.content.listPosts.useQuery({ status: 'draft' });

  const schedulePost = trpc.content.schedulePost.useMutation({
    onSuccess: () => {
      utils.content.listPosts.invalidate();
      toast.success('Post scheduled!');
      setShowScheduleDialog(false);
      setSelectedSchedulePost(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const dragDropPost = trpc.content.updatePost.useMutation({
    onSuccess: () => {
      utils.content.listPosts.invalidate();
      toast.success('Post rescheduled');
    },
    onError: (e) => toast.error(e.message),
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Padding cells before the 1st (Sunday = 0)
  const leadingBlanks = getDay(monthStart);

  const getPostsForDate = (date: Date) => {
    return (scheduledPosts as ScheduledPost[]).filter(
      (post) => post.scheduledAt && isSameDay(new Date(post.scheduledAt), date)
    );
  };

  const handleDragStart = (post: ScheduledPost) => setDraggedPost(post);

  const handleDrop = (date: Date) => {
    if (!draggedPost) return;
    const [hours, minutes] = selectedTime.split(':');
    const scheduledAt = new Date(date);
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    dragDropPost.mutate({ id: draggedPost.id, scheduledAt });
    setDraggedPost(null);
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
    setSelectedSchedulePost(null);
    setShowScheduleDialog(true);
  };

  const handleScheduleConfirm = () => {
    if (!selectedSchedulePost || !selectedDate) return;
    const [hours, minutes] = selectedTime.split(':');
    const scheduledAt = new Date(selectedDate);
    scheduledAt.setHours(parseInt(hours), parseInt(minutes), 0, 0);
    schedulePost.mutate({ id: selectedSchedulePost.id, scheduledAt });
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Calendar</h1>
          <p className="text-slate-600">Plan and schedule your social media posts</p>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => setCurrentDate(subMonths(currentDate, 1))}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-2xl font-bold min-w-48 text-center">
                  {format(currentDate, 'MMMM yyyy')}
                </h2>
                <Button variant="outline" size="icon" onClick={() => setCurrentDate(addMonths(currentDate, 1))}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
              <Button variant="outline" onClick={() => setCurrentDate(new Date())}>Today</Button>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs font-semibold text-slate-500 py-2 uppercase tracking-wide">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {/* Leading blank cells */}
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} className="min-h-28 p-1 bg-slate-50 rounded-lg opacity-40" />
              ))}

              {days.map(day => {
                const dayPosts = getPostsForDate(day);
                const isToday = isSameDay(day, new Date());

                return (
                  <div
                    key={day.toString()}
                    onClick={() => handleDateClick(day)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(day)}
                    className={`
                      min-h-28 p-1.5 border rounded-lg cursor-pointer transition-all
                      ${isToday ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50'}
                    `}
                  >
                    <div className={`text-xs font-bold mb-1 w-6 h-6 flex items-center justify-center rounded-full
                      ${isToday ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>
                      {format(day, 'd')}
                    </div>
                    <div className="space-y-0.5">
                      {dayPosts.slice(0, 3).map((post) => (
                        <div
                          key={post.id}
                          draggable
                          onDragStart={(e) => { e.stopPropagation(); handleDragStart(post); }}
                          className={`text-xs px-1.5 py-0.5 rounded cursor-move truncate flex items-center gap-1 ${PLATFORM_COLORS[post.platform] || 'bg-slate-500 text-white'}`}
                          title={`${post.title}${post.scheduledAt ? ' · ' + format(new Date(post.scheduledAt), 'HH:mm') : ''}`}
                        >
                          <span>{PLATFORM_EMOJI[post.platform]}</span>
                          <span className="truncate">{post.title}</span>
                        </div>
                      ))}
                      {dayPosts.length > 3 && (
                        <div className="text-xs text-slate-500 pl-1">+{dayPosts.length - 3} more</div>
                      )}
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
                <label className="text-sm font-medium">Select Draft Post</label>
                <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                  {(draftPosts as ScheduledPost[]).length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">No draft posts available</p>
                  ) : (
                    (draftPosts as ScheduledPost[]).map((post) => (
                      <Card
                        key={post.id}
                        className={`p-3 cursor-pointer transition-colors ${selectedSchedulePost?.id === post.id ? 'border-blue-500 bg-blue-50' : 'hover:bg-slate-50'}`}
                        onClick={() => setSelectedSchedulePost(post)}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-sm">{post.title}</p>
                            <Badge variant="outline" className="mt-1 capitalize">{post.platform}</Badge>
                          </div>
                          <Clock className="w-4 h-4 text-slate-400" />
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Time</label>
                <input
                  type="time"
                  className="w-full mt-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={selectedTime}
                  onChange={(e) => setSelectedTime(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                onClick={handleScheduleConfirm}
                disabled={!selectedSchedulePost || schedulePost.isPending}
              >
                {schedulePost.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
                Schedule Post
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Scheduled This Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {(scheduledPosts as ScheduledPost[]).filter((p) => p.scheduledAt && isSameMonth(new Date(p.scheduledAt), currentDate)).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Next 7 Days</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">
                {(scheduledPosts as ScheduledPost[]).filter((p) => {
                  if (!p.scheduledAt) return false;
                  const d = new Date(p.scheduledAt);
                  const today = new Date();
                  return d >= today && d <= addDays(today, 7);
                }).length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600">Draft Posts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-900">{(draftPosts as ScheduledPost[]).length}</div>
            </CardContent>
          </Card>
        </div>

        {/* Platform legend */}
        <div className="flex flex-wrap gap-3 mt-4">
          {Object.entries(PLATFORM_EMOJI).map(([platform, emoji]) => (
            <div key={platform} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${PLATFORM_COLORS[platform]}`}>
              {emoji} <span className="capitalize">{platform}</span>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
