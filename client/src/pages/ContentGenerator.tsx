import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Download, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/DashboardLayout';

type PillarType = 'desi_business_owner' | 'five_minute_transformation' | 'roi_calculator';
type Platform = 'facebook' | 'instagram' | 'whatsapp' | 'youtube';
type ContentFormat = 'carousel' | 'reel' | 'story' | 'feed_post';

const PILLARS = {
  desi_business_owner: { icon: '😅', title: 'Relatable Business Owner', desc: 'Missed messages, lost leads, competitor won' },
  five_minute_transformation: { icon: '⏱️', title: '5-Minute Setup', desc: 'Simple, fast, live today' },
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
    HOOK: 'bg-red-500',
    PROBLEM: 'bg-orange-500',
    SOLUTION: 'bg-blue-600',
    PROOF: 'bg-green-600',
    CTA: 'bg-purple-600',
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
  const frameBgs = ['from-blue-900 to-blue-700', 'from-slate-900 to-blue-900', 'from-blue-600 to-cyan-500'];
  return (
    <div className="space-y-3">
      {data.frames.map((f: any, i: number) => (
        <div key={f.num} className={`rounded-2xl bg-gradient-to-br ${frameBgs[i] ?? frameBgs[0]} p-5 text-white shadow-lg`}>
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

function RawPreview({ content }: { content: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ContentGenerator() {
  const [selectedPillar, setSelectedPillar] = useState<PillarType>('roi_calculator');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('instagram');
  const [contentFormat, setContentFormat] = useState<ContentFormat>('carousel');
  const [customPrompt, setCustomPrompt] = useState('');

  const [generatedContent, setGeneratedContent] = useState('');
  const [parsedContent, setParsedContent] = useState<any>(null);
  const [currentFormat, setCurrentFormat] = useState<ContentFormat>('carousel');
  const [generatedHashtags, setGeneratedHashtags] = useState('');
  const [postTitle, setPostTitle] = useState('');

  const generateMutation = trpc.content.generatePost.useMutation();
  const saveMutation = trpc.content.savePost.useMutation();

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({
        pillarType: selectedPillar,
        platform: selectedPlatform,
        contentFormat,
        language: 'english',
        customPrompt: customPrompt || undefined,
      });

      setGeneratedContent(result.content);
      setParsedContent(result.parsed ?? null);
      setCurrentFormat(result.format as ContentFormat);
      setGeneratedHashtags(result.hashtags);
      setPostTitle(`${PILLARS[selectedPillar].title} · ${FORMATS.find(f => f.key === contentFormat)?.label} · ${new Date().toLocaleDateString()}`);
      toast.success('Content generated!');
    } catch (error) {
      toast.error('Failed to generate content');
      console.error(error);
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

  const handleCopy = () => {
    const text = parsedContent
      ? `${generatedContent}\n\n${generatedHashtags}`
      : `${generatedContent}\n\n${generatedHashtags}`;
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };

  const hasContent = !!generatedContent;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Generator</h1>
          <p className="text-lg text-slate-600">Create viral-worthy content for get-my-agent.com</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Generator Panel */}
          <div className="lg:col-span-2">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  Generate Content
                </CardTitle>
                <CardDescription className="text-blue-100">English · Indian SMB audience · get-my-agent.com</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">

                {/* Content Pillar */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Content Pillar</label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(Object.entries(PILLARS) as [PillarType, any][]).map(([key, p]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedPillar(key)}
                        className={`p-4 rounded-lg border-2 transition-all text-left ${
                          selectedPillar === key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'
                        }`}
                      >
                        <div className="text-2xl mb-2">{p.icon}</div>
                        <div className="font-semibold text-slate-900 text-sm">{p.title}</div>
                        <div className="text-xs text-slate-500 mt-1">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Platform */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Platform</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(Object.entries(PLATFORMS) as [Platform, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedPlatform(key)}
                        className={`p-3 rounded-lg border-2 transition-all font-medium text-sm ${
                          selectedPlatform === key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Content Format */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">Content Format</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {FORMATS.map(f => (
                      <button
                        key={f.key}
                        onClick={() => setContentFormat(f.key)}
                        className={`p-3 rounded-lg border-2 transition-all text-left ${
                          contentFormat === f.key ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-400'
                        }`}
                      >
                        <div className="text-xl mb-1">{f.icon}</div>
                        <div className="font-semibold text-slate-900 text-sm">{f.label}</div>
                        <div className="text-xs text-slate-500">{f.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Prompt */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">Custom Instructions (optional)</label>
                  <Textarea
                    placeholder="e.g. Focus on real estate agents, mention ₹999 pricing, add urgency..."
                    value={customPrompt}
                    onChange={e => setCustomPrompt(e.target.value)}
                    className="min-h-20 text-sm"
                  />
                </div>

                {/* Buttons */}
                <div className="flex gap-3">
                  <Button
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3"
                  >
                    {generateMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                    ) : (
                      <><Sparkles className="w-4 h-4 mr-2" />Generate</>
                    )}
                  </Button>
                  {hasContent && (
                    <Button
                      onClick={handleGenerate}
                      disabled={generateMutation.isPending}
                      variant="outline"
                      className="px-4"
                      title="Regenerate"
                    >
                      <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg sticky top-4 max-h-[calc(100vh-6rem)] flex flex-col">
              <CardHeader className="bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-t-lg flex-shrink-0">
                <CardTitle className="flex items-center justify-between">
                  <span>Preview</span>
                  {hasContent && (
                    <Badge variant="secondary" className="text-xs bg-white/20 text-white border-0">
                      {FORMATS.find(f => f.key === currentFormat)?.label}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-orange-100">Generated content</CardDescription>
              </CardHeader>
              <CardContent className="pt-4 flex-1 overflow-y-auto">
                {hasContent ? (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase">Title</label>
                      <Input value={postTitle} onChange={e => setPostTitle(e.target.value)} className="mt-1 text-xs" />
                    </div>

                    {/* Format-aware preview */}
                    {parsedContent ? (
                      <>
                        {currentFormat === 'carousel' && <CarouselPreview data={parsedContent} />}
                        {currentFormat === 'reel' && <ReelPreview data={parsedContent} />}
                        {currentFormat === 'story' && <StoryPreview data={parsedContent} />}
                        {currentFormat === 'feed_post' && <FeedPreview data={parsedContent} />}
                      </>
                    ) : (
                      <RawPreview content={generatedContent} />
                    )}

                    {/* Hashtags */}
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

                    {/* Actions */}
                    <div className="space-y-2 pt-2 border-t">
                      <Button onClick={handleCopy} variant="outline" className="w-full text-sm">
                        <Copy className="w-4 h-4 mr-2" />Copy
                      </Button>
                      <Button
                        onClick={handleSave}
                        disabled={saveMutation.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm"
                      >
                        {saveMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                        ) : (
                          <><Download className="w-4 h-4 mr-2" />Save Draft</>
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <div className="text-5xl mb-3">✨</div>
                    <p className="text-sm text-slate-500">Choose a pillar, platform and format,<br />then hit Generate.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
