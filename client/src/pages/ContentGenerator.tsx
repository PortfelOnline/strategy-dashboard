import { useState } from 'react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Copy, Download, Share2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

type PillarType = 'desi_business_owner' | 'five_minute_transformation' | 'roi_calculator';
type Platform = 'facebook' | 'instagram' | 'whatsapp';
type Language = 'hinglish' | 'hindi' | 'english' | 'tamil' | 'telugu' | 'bengali';

const pillarDescriptions = {
  desi_business_owner: {
    title: 'Relatable Desi Business Owner',
    description: 'Use humor and memes to show customer service struggles',
    icon: '😅',
  },
  five_minute_transformation: {
    title: '5-Minute Transformation',
    description: 'Fast-paced setup demonstration with timer',
    icon: '⏱️',
  },
  roi_calculator: {
    title: 'ROI Calculator',
    description: 'Focus on cost savings and financial benefits',
    icon: '💰',
  },
};

const platformIcons = {
  facebook: '👍',
  instagram: '📸',
  whatsapp: '💬',
};

export default function ContentGenerator() {
  const { user } = useAuth();
  const [selectedPillar, setSelectedPillar] = useState<PillarType>('desi_business_owner');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('instagram');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('hinglish');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatedHashtags, setGeneratedHashtags] = useState('');
  const [postTitle, setPostTitle] = useState('');

  const generateMutation = trpc.content.generatePost.useMutation();
  const saveMutation = trpc.content.savePost.useMutation();

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({
        pillarType: selectedPillar,
        platform: selectedPlatform,
        language: selectedLanguage,
        customPrompt: customPrompt || undefined,
      });
      
      setGeneratedContent(result.content);
      setGeneratedHashtags(result.hashtags);
      setPostTitle(`${pillarDescriptions[selectedPillar].title} - ${new Date().toLocaleDateString()}`);
      toast.success('Content generated successfully!');
    } catch (error) {
      toast.error('Failed to generate content');
      console.error(error);
    }
  };

  const handleSavePost = async () => {
    if (!generatedContent || !postTitle) {
      toast.error('Please generate content and add a title');
      return;
    }

    try {
      await saveMutation.mutateAsync({
        title: postTitle,
        content: generatedContent,
        platform: selectedPlatform,
        language: selectedLanguage,
        hashtags: generatedHashtags,
        status: 'draft',
      });
      
      toast.success('Post saved as draft!');
      setGeneratedContent('');
      setGeneratedHashtags('');
      setPostTitle('');
    } catch (error) {
      toast.error('Failed to save post');
      console.error(error);
    }
  };

  const handleCopyContent = () => {
    const fullContent = `${generatedContent}\n\n${generatedHashtags}`;
    navigator.clipboard.writeText(fullContent);
    toast.success('Copied to clipboard!');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Content Generator</h1>
          <p className="text-lg text-slate-600">Create viral-worthy content for your AI consultant service</p>
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
                <CardDescription className="text-blue-100">
                  Choose your content pillar and platform
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                {/* Content Pillar Selection */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">
                    Content Pillar
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(Object.entries(pillarDescriptions) as [PillarType, any][]).map(([key, pillar]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedPillar(key)}
                        className={`p-4 rounded-lg border-2 transition-all text-left ${
                          selectedPillar === key
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-blue-400'
                        }`}
                      >
                        <div className="text-2xl mb-2">{pillar.icon}</div>
                        <div className="font-semibold text-slate-900">{pillar.title}</div>
                        <div className="text-xs text-slate-600 mt-1">{pillar.description}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Platform Selection */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-3">
                    Platform
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(Object.entries(platformIcons) as [Platform, string][]).map(([key, icon]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedPlatform(key)}
                        className={`p-3 rounded-lg border-2 transition-all font-medium ${
                          selectedPlatform === key
                            ? 'border-blue-600 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-blue-400'
                        }`}
                      >
                        <span className="text-xl mr-2">{icon}</span>
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Language Selection */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Language
                  </label>
                  <Select value={selectedLanguage} onValueChange={(value) => setSelectedLanguage(value as Language)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hinglish">Hinglish (Hindi-English Mix)</SelectItem>
                      <SelectItem value="hindi">Hindi</SelectItem>
                      <SelectItem value="english">English</SelectItem>
                      <SelectItem value="tamil">Tamil</SelectItem>
                      <SelectItem value="telugu">Telugu</SelectItem>
                      <SelectItem value="bengali">Bengali</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Prompt */}
                <div>
                  <label className="block text-sm font-semibold text-slate-900 mb-2">
                    Custom Prompt (Optional)
                  </label>
                  <Textarea
                    placeholder="Add custom instructions for content generation..."
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    className="min-h-24"
                  />
                </div>

                {/* Generate Button */}
                <Button
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 rounded-lg"
                >
                  {generateMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Generate Content
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Preview Panel */}
          <div className="lg:col-span-1">
            <Card className="shadow-lg sticky top-4">
              <CardHeader className="bg-gradient-to-r from-orange-600 to-orange-700 text-white rounded-t-lg">
                <CardTitle>Preview</CardTitle>
                <CardDescription className="text-orange-100">
                  Your generated content
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {generatedContent ? (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase">Post Title</label>
                      <Input
                        value={postTitle}
                        onChange={(e) => setPostTitle(e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase">Content</label>
                      <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 max-h-48 overflow-y-auto">
                        <p className="text-sm text-slate-800 whitespace-pre-wrap">{generatedContent}</p>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 uppercase">Hashtags</label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {generatedHashtags.split(' ').map((tag, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2 pt-4 border-t">
                      <Button
                        onClick={handleCopyContent}
                        variant="outline"
                        className="w-full"
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Copy
                      </Button>
                      <Button
                        onClick={handleSavePost}
                        disabled={saveMutation.isPending}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {saveMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Save as Draft
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-2">📝</div>
                    <p className="text-sm text-slate-600">
                      Generate content to see preview here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
