import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Download, Sparkles, RefreshCw, Zap, CalendarDays, Image, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';
import DashboardLayout from '@/components/DashboardLayout';

type PillarType = 'desi_business_owner' | 'five_minute_transformation' | 'roi_calculator';
type Platform = 'facebook' | 'instagram' | 'whatsapp' | 'youtube';
type ContentFormat = 'carousel' | 'reel' | 'story' | 'feed_post';
type Industry = 'retail' | 'real_estate' | 'restaurant' | 'ecommerce' | 'coaching' | 'services';
type ContentAngle = 'standard' | 'pov' | 'transformation' | 'comparison' | 'objection' | 'story';
type Season = 'none' | 'diwali' | 'ipl' | 'back_to_school' | 'gst_season' | 'wedding' | 'summer';

const PILLARS = {
  desi_business_owner: { icon: '😅', title: 'Relatable Owner', desc: 'Missed messages, competitor won' },
  five_minute_transformation: { icon: '⏱️', title: '5-Min Setup', desc: 'Simple, fast, live today' },
  roi_calculator: { icon: '💰', title: 'ROI Calculator', desc: '₹999/mo vs ₹15,000+/mo staff' },
} as const;

const PLATFORMS = {
  facebook: '👍 Facebook',
  instagram: '📸 Instagram',
  whatsapp: '💬 WhatsApp',
  youtube: '▶️ YouTube',
} as const;

const FORMATS: { key: ContentFormat; icon: string; label: string; desc: string }[] = [
  { key: 'carousel', icon: '🎠', label: 'Carousel', desc: '6 slides' },
  { key: 'reel', icon: '🎬', label: 'Reel Script', desc: '30-45 sec' },
  { key: 'story', icon: '📱', label: 'Story', desc: '3 frames' },
  { key: 'feed_post', icon: '📝', label: 'Feed Post', desc: 'Single post' },
];

const INDUSTRIES: { key: Industry; icon: string; label: string }[] = [
  { key: 'retail', icon: '👗', label: 'Retail / Clothing' },
  { key: 'real_estate', icon: '🏠', label: 'Real Estate' },
  { key: 'restaurant', icon: '🍽️', label: 'Restaurant' },
  { key: 'ecommerce', icon: '📦', label: 'E-commerce' },
  { key: 'coaching', icon: '📚', label: 'Coaching' },
  { key: 'services', icon: '🔧', label: 'Services' },
];

const SEASONS: { key: Season; icon: string; label: string; months: string }[] = [
  { key: 'none',          icon: '📅', label: 'No season',    months: 'Generic' },
  { key: 'diwali',        icon: '🪔', label: 'Diwali',       months: 'Oct–Nov' },
  { key: 'ipl',           icon: '🏏', label: 'IPL',          months: 'Mar–May' },
  { key: 'back_to_school',icon: '📚', label: 'Back to School', months: 'Jun–Jul' },
  { key: 'gst_season',    icon: '📊', label: 'GST Season',   months: 'Jul/Sep/Dec' },
  { key: 'wedding',       icon: '💒', label: 'Wedding',      months: 'Nov–Feb' },
  { key: 'summer',        icon: '☀️', label: 'Summer',       months: 'May–Jun' },
];

const ANGLES: { key: ContentAngle; icon: string; label: string; desc: string }[] = [
  { key: 'standard', icon: '🎯', label: 'Standard', desc: 'Direct conversion' },
  { key: 'pov', icon: '👁️', label: 'POV Story', desc: 'First-person' },
  { key: 'transformation', icon: '✨', label: 'Before/After', desc: 'Day 1 vs Day 30' },
  { key: 'comparison', icon: '⚖️', label: '₹ Comparison', desc: 'Side-by-side math' },
  { key: 'objection', icon: '🛡️', label: 'Objection Busting', desc: 'Flip common fears' },
  { key: 'story', icon: '📖', label: 'Mini Story', desc: 'Named protagonist' },
];

// ─── Preview sub-components ──────────────────────────────────────────────────

function CarouselPreview({ data }: { data: any }) {
  if (!data?.slides) return null;
  return (
    <div className="space-y-3">
      {data.slides.map((slide: any) => (
        <div key={slide.num} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">{slide.num}</span>
            <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{slide.label}</span>
          </div>
          <p className="font-bold text-slate-900 text-sm leading-snug mb-1">{slide.headline}</p>
          {slide.sub && <p className="text-xs text-slate-500">{slide.sub}</p>}
          {slide.points && (
            <ul className="mt-2 space-y-1">
              {slide.points.map((p: string, i: number) => (
                <li key={i} className="text-xs text-slate-700 flex gap-1.5"><span className="text-blue-400 flex-shrink-0">•</span>{p}</li>
              ))}
            </ul>
          )}
          {slide.stat && (
            <div className="mt-2 bg-blue-50 rounded-lg p-2">
              <p className="text-lg font-black text-blue-700">{slide.stat}</p>
              {slide.context && <p className="text-xs text-slate-600 mt-0.5">{slide.context}</p>}
            </div>
          )}
          {slide.quote && (
            <blockquote className="mt-2 border-l-2 border-blue-400 pl-2 text-xs italic text-slate-600">
              "{slide.quote}"<br /><span className="not-italic font-semibold">— {slide.source}</span>
            </blockquote>
          )}
        </div>
      ))}
      {data.caption && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Caption</p>
          <p className="text-xs text-slate-700">{data.caption}</p>
        </div>
      )}
    </div>
  );
}

function ReelPreview({ data }: { data: any }) {
  if (!data?.sections) return null;
  const labelColors: Record<string, string> = {
    HOOK: 'bg-red-500', PROBLEM: 'bg-orange-500',
    SOLUTION: 'bg-blue-600', PROOF: 'bg-green-600', CTA: 'bg-purple-600',
  };
  return (
    <div className="space-y-3">
      {data.sections.map((s: any, i: number) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-slate-400 font-mono flex-shrink-0">{s.time}</span>
            <span className={`text-xs font-bold text-white px-2 py-0.5 rounded-full ${labelColors[s.label] ?? 'bg-slate-600'}`}>{s.label}</span>
          </div>
          <p className="text-xs text-slate-500 mb-1">🎥 {s.visual}</p>
          <p className="text-sm font-medium text-slate-800">🎙 {s.audio}</p>
        </div>
      ))}
      {data.voiceover && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-semibold text-blue-600 mb-1">Full Voiceover Script</p>
          <p className="text-xs text-slate-700 leading-relaxed italic">{data.voiceover}</p>
        </div>
      )}
      {data.text_overlays?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Text Overlays</p>
          <div className="flex flex-wrap gap-1">
            {data.text_overlays.map((t: string, i: number) => (
              <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StoryPreview({ data }: { data: any }) {
  if (!data?.frames) return null;
  const bgs = ['from-blue-900 to-blue-700', 'from-slate-900 to-blue-900', 'from-blue-600 to-cyan-500'];
  return (
    <div className="space-y-3">
      {data.frames.map((f: any, i: number) => (
        <div key={f.num} className={`rounded-2xl bg-gradient-to-br ${bgs[i] ?? bgs[0]} p-5 text-white shadow-lg`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold bg-white/10 px-2 py-0.5 rounded-full">Frame {f.num}: {f.label}</span>
            <span className="text-2xl">{f.emoji}</span>
          </div>
          <p className="text-xl font-black leading-tight mb-1">{f.main_text}</p>
          <p className="text-sm text-white/70">{f.sub_text}</p>
          {f.list && (
            <ul className="mt-3 space-y-1">
              {f.list.map((item: string, j: number) => (
                <li key={j} className="text-sm flex gap-2"><span className="text-cyan-300">✓</span>{item}</li>
              ))}
            </ul>
          )}
          {f.button_text && (
            <div className="mt-3 bg-white text-blue-700 font-bold text-sm rounded-full px-4 py-1.5 inline-block">{f.button_text}</div>
          )}
        </div>
      ))}
      {data.poll && (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 mb-2">Poll Sticker</p>
          <p className="text-sm font-medium text-slate-800 mb-2">{data.poll.question}</p>
          <div className="flex gap-2">
            <span className="flex-1 text-center bg-blue-100 text-blue-700 text-xs font-semibold rounded-full py-1">{data.poll.yes}</span>
            <span className="flex-1 text-center bg-slate-100 text-slate-600 text-xs font-semibold rounded-full py-1">{data.poll.no}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedPreview({ data }: { data: any }) {
  if (!data?.hook) return null;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-blue-200 bg-white p-4 shadow-sm">
        <p className="text-base font-black text-slate-900 leading-tight mb-3">{data.hook}</p>
        {data.paragraphs?.map((p: string, i: number) => (
          <p key={i} className="text-sm text-slate-700 leading-relaxed mb-2">{p}</p>
        ))}
        {data.cta && (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-sm font-semibold text-blue-600">→ {data.cta}</p>
          </div>
        )}
      </div>
      {data.caption && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Full Caption</p>
          <p className="text-xs text-slate-700 whitespace-pre-line">{data.caption}</p>
        </div>
      )}
    </div>
  );
}

function HookVariants({ hooks, onSelect }: { hooks: any[]; onSelect: (h: string) => void }) {
  if (!hooks.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-semibold text-amber-700 uppercase mb-3">⚡ Hook Variants — pick one for Custom Instructions</p>
      <div className="space-y-2">
        {hooks.map((h: any, i: number) => (
          <button
            key={i}
            onClick={() => onSelect(h.text)}
            className="w-full text-left rounded-lg bg-white border border-amber-200 px-3 py-2 hover:border-amber-400 hover:bg-amber-50 transition-all group"
          >
            <span className="text-xs font-semibold text-amber-600 block mb-0.5">{h.style}</span>
            <span className="text-sm text-slate-800 group-hover:text-slate-900">{h.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ContentGenerator() {
  const [, navigate] = useLocation();
  const [selectedPillar, setSelectedPillar] = useState<PillarType>('roi_calculator');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('carousel');
  const [industry, setIndustry] = useState<Industry>('retail');
  const [contentAngle, setContentAngle] = useState<ContentAngle>('standard');
  const [season, setSeason] = useState<Season>('none');
  const [customPrompt, setCustomPrompt] = useState('');

  const [generatedContent, setGeneratedContent] = useState('');
  const [parsedContent, setParsedContent] = useState<any>(null);
  const [currentFormat, setCurrentFormat] = useState<ContentFormat>('carousel');
  const [generatedHashtags, setGeneratedHashtags] = useState('');
  const [postTitle, setPostTitle] = useState('');
  const [hookVariants, setHookVariants] = useState<any[]>([]);
  const [generatedImageUrl, setGeneratedImageUrl] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState('');

  // Bulk generate state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCount, setBulkCount] = useState(7);
  const [bulkSchedule, setBulkSchedule] = useState(false);
  const [bulkStartDate, setBulkStartDate] = useState('');

  const generateMutation = trpc.content.generatePost.useMutation();
  const saveMutation = trpc.content.savePost.useMutation();
  const hooksMutation = trpc.content.generateHooks.useMutation();
  const bulkMutation = trpc.content.bulkGenerate.useMutation();
  const visualMutation = trpc.content.generateVisual.useMutation();
  const videoMutation = trpc.content.generateVideo.useMutation();

  const handleGenerate = async () => {
    setHookVariants([]);
    try {
      const result = await generateMutation.mutateAsync({
        pillarType: selectedPillar,
        platform: selectedPlatform,
        contentFormat,
        industry,
        contentAngle,
        season,
        language: 'english',
        customPrompt: customPrompt || undefined,
      });
      setGeneratedContent(result.content);
      setParsedContent(result.parsed ?? null);
      setCurrentFormat(result.format as ContentFormat);
      setGeneratedHashtags(result.hashtags);
      setPostTitle(`${INDUSTRIES.find(i => i.key === industry)?.label} · ${PILLARS[selectedPillar].title} · ${FORMATS.find(f => f.key === contentFormat)?.label}`);
      toast.success('Content generated!');
    } catch {
      toast.error('Failed to generate content');
    }
  };

  const handleGetHooks = async () => {
    try {
      const result = await hooksMutation.mutateAsync({ pillarType: selectedPillar, industry });
      setHookVariants(result.hooks);
      toast.success('5 hook variants ready!');
    } catch {
      toast.error('Failed to generate hooks');
    }
  };

  const handleSave = async () => {
    if (!generatedContent || !postTitle) return toast.error('Nothing to save');
    try {
      await saveMutation.mutateAsync({
        title: postTitle,
        content: generatedContent,
        platform: selectedPlatform,
        language: 'english',
        hashtags: generatedHashtags,
        status: 'draft',
      });
      toast.success('Saved as draft!');
      setGeneratedContent('');
      setParsedContent(null);
      setGeneratedHashtags('');
      setPostTitle('');
    } catch {
      toast.error('Failed to save');
    }
  };

  const handleBulkGenerate = async () => {
    try {
      const result = await bulkMutation.mutateAsync({
        pillarType: selectedPillar,
        contentFormat,
        industry,
        contentAngle,
        season,
        platform: selectedPlatform,
        count: bulkCount,
        language: 'english',
        startDate: bulkSchedule && bulkStartDate ? new Date(bulkStartDate) : undefined,
      });
      setBulkOpen(false);
      toast.success(`${result.count} posts saved!`);
      navigate('/library');
    } catch {
      toast.error('Bulk generation failed');
    }
  };

  const handleGenerateVisual = async () => {
    const hook = parsedContent?.slides?.[0]?.headline
      || parsedContent?.sections?.[0]?.audio
      || parsedContent?.hook
      || postTitle;
    try {
      const result = await visualMutation.mutateAsync({ industry, contentFormat, hook });
      setGeneratedImageUrl(result.url ?? '');
      toast.success('Image generated!');
    } catch (e: any) {
      toast.error(e.message || 'Image generation failed');
    }
  };

  const handleGenerateVideo = async () => {
    const hook = parsedContent?.sections?.[0]?.audio || parsedContent?.hook || postTitle;
    try {
      const result = await videoMutation.mutateAsync({ industry, hook });
      setGeneratedVideoUrl(result.url ?? '');
      toast.success('Video generated!');
    } catch (e: any) {
      toast.error(e.message || 'Video generation failed — Veo 2 requires special API access');
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(`${generatedContent}\n\n${generatedHashtags}`);
    toast.success('Copied!');
  };

  const hasContent = !!generatedContent;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Generator</h1>
          <p className="text-lg text-slate-600">Viral-worthy content for get-my-agent.com — specific to your industry</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Generator Panel */}
          <div className="lg:col-span-2 space-y-4">

            {/* Row 1: Pillar + Platform */}
            <Card className="shadow-sm">
              <CardContent className="pt-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Content Pillar</label>
                  <div className="grid grid-cols-3 gap-3">
                    {(Object.entries(PILLARS) as [PillarType, any][]).map(([key, p]) => (
                      <button key={key} onClick={() => setSelectedPillar(key)}
                        className={`p-3 rounded-lg border-2 transition-all text-left ${selectedPillar === key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'}`}>
                        <div className="text-xl mb-1">{p.icon}</div>
                        <div className="font-semibold text-slate-900 text-xs">{p.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Platform</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(Object.entries(PLATFORMS) as [Platform, string][]).map(([key, label]) => (
                      <button key={key} onClick={() => setSelectedPlatform(key)}
                        className={`p-2.5 rounded-lg border-2 transition-all font-medium text-xs ${selectedPlatform === key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Row 2: Industry + Season */}
            <Card className="shadow-sm border-orange-100">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-semibold text-slate-900">🏪 Industry</CardTitle>
                <CardDescription className="text-xs">Makes content specific to this type of business — not generic</CardDescription>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-4">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {INDUSTRIES.map(ind => (
                    <button key={ind.key} onClick={() => setIndustry(ind.key)}
                      className={`p-2.5 rounded-lg border-2 transition-all text-center ${industry === ind.key ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-orange-300'}`}>
                      <div className="text-xl mb-1">{ind.icon}</div>
                      <div className="text-xs font-medium text-slate-700 leading-tight">{ind.label}</div>
                    </button>
                  ))}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                    🗓️ Seasonal Trigger
                    <span className="ml-1.5 font-normal text-slate-400 normal-case">— adds urgency tied to a specific moment</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {SEASONS.map(s => (
                      <button key={s.key} onClick={() => setSeason(s.key)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-medium transition-all ${
                          season === s.key
                            ? 'border-rose-500 bg-rose-50 text-rose-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-rose-300 hover:text-rose-600'
                        }`}>
                        <span>{s.icon}</span>
                        <span>{s.label}</span>
                        {s.key !== 'none' && <span className="text-slate-400 font-normal">{s.months}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Row 3: Format + Angle */}
            <Card className="shadow-sm">
              <CardContent className="pt-5 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Content Format</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {FORMATS.map(f => (
                      <button key={f.key} onClick={() => setContentFormat(f.key)}
                        className={`p-3 rounded-lg border-2 transition-all text-left ${contentFormat === f.key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'}`}>
                        <div className="text-xl mb-1">{f.icon}</div>
                        <div className="font-semibold text-slate-900 text-xs">{f.label}</div>
                        <div className="text-xs text-slate-500">{f.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-1">Content Angle
                    <span className="ml-2 text-xs font-normal text-slate-500">— narrative style</span>
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {ANGLES.map(a => (
                      <button key={a.key} onClick={() => setContentAngle(a.key)}
                        className={`p-2.5 rounded-lg border-2 transition-all text-left ${contentAngle === a.key ? 'border-purple-500 bg-purple-50' : 'border-slate-200 bg-white hover:border-purple-300'}`}>
                        <span className="text-lg mr-1">{a.icon}</span>
                        <span className="font-semibold text-slate-900 text-xs">{a.label}</span>
                        <div className="text-xs text-slate-500 mt-0.5">{a.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Row 4: Custom + Actions */}
            <Card className="shadow-sm">
              <CardContent className="pt-5 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Custom Instructions
                    <span className="ml-2 text-xs font-normal text-slate-500">(optional)</span>
                  </label>
                  <Textarea
                    placeholder="e.g. Focus on saree shops, mention Diwali season, target Tier-2 cities..."
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    className="min-h-16 text-sm"
                  />
                </div>

                {/* Hook variants */}
                {hookVariants.length > 0 && (
                  <HookVariants hooks={hookVariants} onSelect={text => setCustomPrompt(`Start with this hook: "${text}"`)} />
                )}

                <div className="flex gap-2">
                  <Button onClick={handleGenerate} disabled={generateMutation.isPending}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold">
                    {generateMutation.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                      : <><Sparkles className="w-4 h-4 mr-2" />Generate</>}
                  </Button>
                  {hasContent && (
                    <Button onClick={handleGenerate} disabled={generateMutation.isPending} variant="outline" className="px-3" title="Regenerate">
                      <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                  <Button onClick={handleGetHooks} disabled={hooksMutation.isPending} variant="outline" className="px-3 border-amber-300 text-amber-700 hover:bg-amber-50" title="Get 5 hook variants">
                    {hooksMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  </Button>
                  <Button onClick={() => setBulkOpen(true)} variant="outline" className="px-3 border-green-300 text-green-700 hover:bg-green-50" title="Generate a full week of posts">
                    <CalendarDays className="w-4 h-4" />
                  </Button>
                </div>
                {!hasContent && (
                  <p className="text-xs text-slate-400 text-center">
                    ⚡ = hooks &nbsp;·&nbsp; 📅 = week plan (batch)
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg sticky top-4 max-h-[calc(100vh-6rem)] flex flex-col">
              <CardHeader className="bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-t-lg flex-shrink-0 py-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>Preview</span>
                  {hasContent && (
                    <Badge variant="secondary" className="text-xs bg-white/20 text-white border-0">
                      {FORMATS.find(f => f.key === currentFormat)?.label}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-orange-100 text-xs">Generated content</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex-1 overflow-y-auto">
                {hasContent ? (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Title</label>
                      <Input value={postTitle} onChange={e => setPostTitle(e.target.value)} className="mt-1 text-xs" />
                    </div>

                    {parsedContent ? (
                      <>
                        {currentFormat === 'carousel' && <CarouselPreview data={parsedContent} />}
                        {currentFormat === 'reel' && <ReelPreview data={parsedContent} />}
                        {currentFormat === 'story' && <StoryPreview data={parsedContent} />}
                        {currentFormat === 'feed_post' && <FeedPreview data={parsedContent} />}
                      </>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm text-slate-700 whitespace-pre-wrap">{generatedContent}</p>
                      </div>
                    )}

                    {generatedHashtags && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase">Hashtags</label>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {generatedHashtags.split(' ').filter(Boolean).map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generated visual */}
                    {generatedImageUrl && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">Generated Image</label>
                        <img src={generatedImageUrl} alt="Generated visual" className="w-full rounded-lg border border-slate-200" />
                        <a href={generatedImageUrl} download className="mt-1 text-xs text-blue-600 hover:underline block">↓ Download</a>
                      </div>
                    )}
                    {generatedVideoUrl && (
                      <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase block mb-1">Generated Video</label>
                        <video src={generatedVideoUrl} controls className="w-full rounded-lg border border-slate-200" />
                        <a href={generatedVideoUrl} download className="mt-1 text-xs text-blue-600 hover:underline block">↓ Download</a>
                      </div>
                    )}

                    <div className="space-y-2 pt-2 border-t">
                      {/* Gemini visual buttons */}
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          onClick={handleGenerateVisual}
                          disabled={visualMutation.isPending}
                          variant="outline"
                          className="text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                        >
                          {visualMutation.isPending
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <Image className="w-3 h-3 mr-1" />}
                          Generate Image
                        </Button>
                        <Button
                          onClick={handleGenerateVideo}
                          disabled={videoMutation.isPending}
                          variant="outline"
                          className="text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                          title="Veo 2 — requires special Google API access"
                        >
                          {videoMutation.isPending
                            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            : <Video className="w-3 h-3 mr-1" />}
                          Generate Video
                        </Button>
                      </div>
                      <Button onClick={handleCopy} variant="outline" className="w-full text-sm">
                        <Copy className="w-4 h-4 mr-2" />Copy
                      </Button>
                      <Button onClick={handleSave} disabled={saveMutation.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm">
                        {saveMutation.isPending
                          ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                          : <><Download className="w-4 h-4 mr-2" />Save Draft</>}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="text-5xl mb-3">✨</div>
                    <p className="text-sm text-slate-500 mb-4">Select industry + angle,<br />then Generate.</p>
                    <div className="text-left bg-slate-50 rounded-lg p-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-600">Pro tips:</p>
                      <p className="text-xs text-slate-500">⚡ Hit ⚡ for 5 hooks first</p>
                      <p className="text-xs text-slate-500">📖 "Mini Story" gets most engagement</p>
                      <p className="text-xs text-slate-500">⚖️ "₹ Comparison" converts best</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Bulk Generate Dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-green-600" />
              Week Plan — Bulk Generate
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div>
              <label className="text-sm font-semibold text-slate-800 block mb-2">How many posts?</label>
              <div className="flex gap-2">
                {[3, 5, 7].map(n => (
                  <button key={n} onClick={() => setBulkCount(n)}
                    className={`flex-1 py-2.5 rounded-lg border-2 font-bold text-sm transition-all ${bulkCount === n ? 'border-green-600 bg-green-50 text-green-700' : 'border-slate-200 hover:border-green-400'}`}>
                    {n} posts
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-700">Will use current settings:</p>
              <p>🏪 {INDUSTRIES.find(i => i.key === industry)?.label} · {PILLARS[selectedPillar].title}</p>
              <p>📸 {PLATFORMS[selectedPlatform]} · {FORMATS.find(f => f.key === contentFormat)?.label}</p>
              {season !== 'none' && <p>🗓️ Season: {SEASONS.find(s => s.key === season)?.label}</p>}
              <p>🔄 Rotates through {bulkCount} content angles automatically</p>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="rounded" checked={bulkSchedule} onChange={e => setBulkSchedule(e.target.checked)} />
                <span className="text-sm font-medium text-slate-700">Schedule: 1 post per day starting from</span>
              </label>
              {bulkSchedule && (
                <input
                  type="date"
                  className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={bulkStartDate}
                  onChange={e => setBulkStartDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button
              onClick={handleBulkGenerate}
              disabled={bulkMutation.isPending || (bulkSchedule && !bulkStartDate)}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {bulkMutation.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating {bulkCount} posts...</>
                : <><CalendarDays className="w-4 h-4 mr-2" />Generate {bulkCount} Posts</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
