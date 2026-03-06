import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/trpc';
import { PublishToWordPress } from '@/components/PublishToWordPress';
import {
  Loader2, Search, BookOpen, TrendingUp, Save, Globe,
  ChevronDown, ChevronUp, History, Trash2, ExternalLink,
  List, ArrowRight, Users, Play, Square, Eye, ClipboardList,
  AlertTriangle, CheckCircle, XCircle, Filter,
} from 'lucide-react';
import { toast } from 'sonner';

type AnalysisResult = {
  analysisId: number | null;
  originalTitle: string;
  originalContent: string;
  originalMetaDescription: string;
  headings: { level: string; text: string }[];
  wordCount: number;
  improvedTitle: string;
  improvedContent: string;
  seo: {
    metaTitle: string;
    metaDescription: string;
    keywords: string[];
    headingsSuggestions: { level: string; current: string; suggested: string }[];
    generalSuggestions: string[];
    competitorInsights?: string[];
    score: number;
  };
};

type CatalogArticle = { url: string; title: string };

type SerpResult = { position: number; title: string; url: string; domain: string; snippet: string };
type CompetitorData = {
  keyword: string;
  google: { results: SerpResult[]; error: string | null };
  yandex: { results: SerpResult[]; error: string | null };
  ourPosition: { google: number | null; yandex: number | null };
  aiComparison: string | null;
};

function PositionBadge({ pos }: { pos: number | null }) {
  if (pos === null) return <Badge variant="outline" className="text-xs">не найден</Badge>;
  const color = pos <= 3 ? 'bg-green-100 text-green-800' : pos <= 10 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <Badge className={`text-xs ${color}`}>#{pos}</Badge>;
}

function SerpTable({ results, error, engine }: { results: SerpResult[]; error: string | null; engine: string }) {
  if (error) return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">{error}</div>
  );
  if (results.length === 0) return (
    <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-500">Результатов не найдено</div>
  );
  return (
    <div className="divide-y border rounded-lg overflow-hidden">
      {results.map((r) => (
        <div key={r.position} className="flex gap-3 p-3 hover:bg-slate-50">
          <span className="text-lg font-bold text-slate-300 w-6 shrink-0 text-center leading-tight mt-0.5">{r.position}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="text-sm font-medium text-blue-700 hover:underline line-clamp-1 flex-1">{r.title}</a>
              <ExternalLink className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
            </div>
            <p className="text-xs text-green-700 truncate mt-0.5">{r.domain}</p>
            {r.snippet && <p className="text-xs text-slate-500 line-clamp-2 mt-1">{r.snippet}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Extract a short search keyword from an article title.
 * Rules: take text before first comma/dash/colon, trim to max 5 words.
 * "Кадастровая справка онлайн, как заказать..." → "Кадастровая справка онлайн"
 */
function extractKeyword(title: string): string {
  if (!title) return '';
  // Split at comma, dash (surrounded by spaces), colon, or question mark
  const short = title.split(/[,–—:?]|(?:\s+-\s+)/)[0].trim();
  // Limit to 5 words
  const words = short.split(/\s+/).slice(0, 5);
  return words.join(' ');
}

function CompetitorPanel({
  ourUrl, ourContent, ourTitle, onRewrite,
}: {
  ourUrl?: string;
  ourContent?: string;
  ourTitle?: string;
  onRewrite?: (newContent: string) => void;
}) {
  const [keyword, setKeyword] = useState(() => extractKeyword(ourTitle || ''));
  const [data, setData] = useState<CompetitorData | null>(null);
  const lastAnalyzedRef = useRef('');

  const { mutate: analyze, isPending } = trpc.articles.analyzeCompetitors.useMutation({
    onSuccess: (d) => {
      setData(d as CompetitorData);
      const total = d.google.results.length + d.yandex.results.length;
      if (total === 0) toast.warning('Результатов не найдено — поисковики могли заблокировать запрос');
      else toast.success(`Google: ${d.google.results.length} рез., Яндекс: ${d.yandex.results.length} рез.`);
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка'),
  });

  const { mutate: rewrite, isPending: isRewriting } = trpc.articles.rewriteWithCompetitors.useMutation({
    onSuccess: (d) => {
      onRewrite?.(d.improvedContent);
      toast.success('Улучшенная версия обновлена с учётом конкурентов');
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка перезаписи'),
  });

  const allCompetitors = data
    ? [...data.google.results, ...data.yandex.results]
        .filter((r, i, arr) => arr.findIndex(x => x.domain === r.domain) === i)
        .slice(0, 8)
    : [];

  // Auto-run when article changes (use extracted short keyword)
  useEffect(() => {
    if (!ourTitle || ourTitle === lastAnalyzedRef.current) return;
    lastAnalyzedRef.current = ourTitle;
    const kw = extractKeyword(ourTitle);
    setKeyword(kw);
    setData(null);
    analyze({ keyword: kw, ourUrl, ourContent });
  }, [ourTitle]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Input
              placeholder="Ключевое слово для поиска..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && keyword.trim() && analyze({ keyword: keyword.trim(), ourUrl, ourContent })}
              className="flex-1"
            />
            <Button
              onClick={() => keyword.trim() && analyze({ keyword: keyword.trim(), ourUrl, ourContent })}
              disabled={isPending || !keyword.trim()}
              className="gap-2 shrink-0"
              variant="outline"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isPending ? 'Парсим...' : 'Обновить'}
            </Button>
          </div>
          <p className="text-xs text-slate-400 mt-2">Ключевое слово = заголовок статьи. Можно изменить и запустить заново.</p>
        </CardContent>
      </Card>

      {isPending && (
        <Card>
          <CardContent className="flex flex-col items-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <p className="text-slate-600 text-sm">Загружаю выдачу Google и Яндекс...</p>
          </CardContent>
        </Card>
      )}

      {data && !isPending && (
        <div className="space-y-4">
          {/* Our position */}
          {ourUrl && (
            <Card>
              <CardContent className="pt-4 flex gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Наша позиция в Google:</span>
                  <PositionBadge pos={data.ourPosition.google} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-600">Наша позиция в Яндекс:</span>
                  <PositionBadge pos={data.ourPosition.yandex} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* SERPs side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>🔍 Google</span>
                  <Badge variant="outline" className="text-xs">{data.google.results.length} рез.</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <SerpTable results={data.google.results} error={data.google.error} engine="google" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>🔎 Яндекс</span>
                  <Badge variant="outline" className="text-xs">{data.yandex.results.length} рез.</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <SerpTable results={data.yandex.results} error={data.yandex.error} engine="yandex" />
              </CardContent>
            </Card>
          </div>

          {/* AI comparison */}
          {data.aiComparison && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  AI-анализ конкурентов
                  <Badge className="bg-blue-100 text-blue-800 text-xs">AI</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {data.aiComparison}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rewrite button */}
          {onRewrite && ourContent && allCompetitors.length > 0 && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-blue-900">Переписать статью с учётом конкурентов</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    AI обновит "Улучшенную версию" так, чтобы она покрывала все темы из ТОП-{allCompetitors.length}
                  </p>
                </div>
                <Button
                  onClick={() => rewrite({
                    originalTitle: ourTitle || '',
                    originalContent: ourContent,
                    keyword: keyword.trim(),
                    competitors: allCompetitors.map(r => ({ title: r.title, domain: r.domain, snippet: r.snippet })),
                  })}
                  disabled={isRewriting}
                  className="gap-2 shrink-0"
                >
                  {isRewriting ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                  {isRewriting ? 'Переписываю...' : 'Переписать'}
                </Button>
              </CardContent>
            </Card>
          )}

          {ourContent && !data.aiComparison && (data.google.results.length > 0 || data.yandex.results.length > 0) && (
            <p className="text-xs text-slate-400 text-center">AI-анализ не выполнен — нет данных для сравнения</p>
          )}
        </div>
      )}
    </div>
  );
}

// Convert plain text to preview HTML with CTA buttons
function buildPreviewHtml(title: string, text: string, ctaUrl: string): string {
  const ctaBlock = `
    <div style="text-align:center;margin:2em 0 2.5em;">
      <a href="${ctaUrl || '#'}"
         style="display:inline-block;background:#4CAF50;color:#fff;padding:16px 48px;
                border-radius:8px;font-size:16px;font-weight:500;text-decoration:none;
                letter-spacing:0.2px;cursor:pointer;">
        Получить полную информацию о вашем объекте недвижимости
      </a>
    </div>`;

  const blocks = text.split(/\n{2,}/);
  const html: string[] = [];

  for (const block of blocks) {
    const t = block.trim();
    if (!t) continue;
    if (t.startsWith('### ')) html.push(`<h3>${t.slice(4)}</h3>`);
    else if (t.startsWith('## ')) html.push(`<h2>${t.slice(3)}</h2>`);
    else if (t.startsWith('# ')) html.push(`<h2>${t.slice(2)}</h2>`);
    else {
      const lines = t.split('\n');
      if (lines.every(l => /^[-*]\s/.test(l)))
        html.push('<ul>' + lines.map(l => `<li>${l.slice(2)}</li>`).join('') + '</ul>');
      else if (lines.every(l => /^\d+\.\s/.test(l)))
        html.push('<ol>' + lines.map(l => `<li>${l.replace(/^\d+\.\s/, '')}</li>`).join('') + '</ol>');
      else
        html.push(`<p>${t.replace(/\n/g, '<br>')}</p>`);
    }
  }

  const total = html.length;
  const pos1 = Math.floor(total / 3);
  const pos2 = Math.floor((total * 2) / 3);
  const result: string[] = [];
  for (let i = 0; i < html.length; i++) {
    result.push(html[i]);
    if (i === pos1 - 1 || i === pos2 - 1) result.push(ctaBlock);
  }
  result.push(ctaBlock);

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; max-width: 780px; margin: 0 auto; padding: 32px 24px;
         color: #1a1a1a; line-height: 1.8; font-size: 17px; background: #fff; }
  h1 { font-size: 2em; line-height: 1.3; margin-bottom: 0.5em; color: #111; }
  h2 { font-size: 1.4em; margin-top: 2em; margin-bottom: 0.5em; color: #111; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  h3 { font-size: 1.15em; margin-top: 1.5em; color: #222; }
  p  { margin: 0 0 1.2em; }
  ul, ol { padding-left: 1.5em; margin: 0 0 1.2em; }
  li { margin-bottom: 0.4em; }
  a  { color: #1a73e8; }
</style></head><body>
<h1>${title}</h1>
${result.join('\n')}
</body></html>`;
}

const CTA_URL_KEY = 'publish_cta_url';

function PublishToSiteDialog({
  open, onOpenChange, originalUrl, title, content,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  originalUrl: string;
  title: string;
  content: string;
}) {
  const [ctaUrl, setCtaUrl] = useState(() => localStorage.getItem(CTA_URL_KEY) || 'https://kadastrmap.info/order/');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [generateImage, setGenerateImage] = useState(true);
  const [result, setResult] = useState<{ link: string; ctaTexts: string[]; imageUploaded: boolean } | null>(null);

  const { data: accounts = [] } = trpc.wordpress.getAccounts.useQuery();

  // Auto-select first account
  if (accounts.length > 0 && accountId === null) setAccountId(accounts[0].id);

  const { mutate: publish, isPending } = trpc.articles.publishArticleToSite.useMutation({
    onSuccess: (d) => {
      setResult(d);
      localStorage.setItem(CTA_URL_KEY, ctaUrl);
      toast.success('Статья обновлена на сайте!');
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка публикации'),
  });

  const handlePublish = () => {
    if (!accountId) { toast.error('Выберите WordPress аккаунт'); return; }
    if (!ctaUrl.trim()) { toast.error('Введите URL для кнопок'); return; }
    publish({ accountId, originalUrl, title, content, ctaUrl, generateImage });
  };

  return open ? (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Обновить статью на сайте</h2>
          <button onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {result ? (
          <div className="p-6 space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
              <p className="text-green-800 font-medium mb-1">✓ Статья успешно обновлена</p>
              {result.imageUploaded && <p className="text-green-600 text-sm">· Картинка загружена</p>}
              <p className="text-green-600 text-sm">· Добавлено 3 кнопки конверсии</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-2">Тексты кнопок:</p>
              <div className="space-y-1">
                {result.ctaTexts.map((t, i) => (
                  <div key={i} className="bg-green-50 px-3 py-2 rounded text-sm text-center text-green-800 font-medium">{t}</div>
                ))}
              </div>
            </div>
            <a href={result.link} target="_blank" rel="noopener noreferrer"
              className="block text-center text-sm text-blue-600 hover:underline">
              Открыть статью на сайте →
            </a>
            <Button className="w-full" variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">URL оригинальной статьи</p>
              <div className="bg-slate-50 px-3 py-2 rounded text-sm text-slate-600 truncate">{originalUrl}</div>
            </div>

            {accounts.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 mb-1">WordPress аккаунт</p>
                <select
                  value={accountId ?? ''}
                  onChange={(e) => setAccountId(Number(e.target.value))}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.siteName} ({a.siteUrl})</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <p className="text-xs text-slate-500 mb-1">URL кнопок заказа документов</p>
              <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://kadastrmap.info/order/" />
              <p className="text-xs text-slate-400 mt-1">Сохраняется автоматически</p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={generateImage} onChange={(e) => setGenerateImage(e.target.checked)} className="w-4 h-4" />
              <div>
                <p className="text-sm font-medium">Генерировать картинку (DALL-E)</p>
                <p className="text-xs text-slate-400">Создаст изображение и загрузит как featured image</p>
              </div>
            </label>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Будет сделано:</strong> найти статью по slug · {generateImage ? 'сгенерировать картинку · ' : ''}AI напишет 3 текста кнопок · вставить кнопки в 3 места · обновить статью
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Отмена</Button>
              <Button
                className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                onClick={handlePublish}
                disabled={isPending || !accountId}
              >
                {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />{generateImage ? 'Генерирую...' : 'Публикую...'}</> : <>Обновить на сайте</>}
              </Button>
            </div>
            {isPending && generateImage && (
              <p className="text-xs text-slate-400 text-center">Генерация картинки занимает ~20 сек</p>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70 ? 'bg-green-100 text-green-800' :
    score >= 40 ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800';
  return <Badge className={color}>SEO {score}/100</Badge>;
}

function AnalysisPanel({
  result, onSave, onWpOpen, isSaving, savedPostId, originalUrl,
}: {
  result: AnalysisResult;
  onSave: (content: string) => void;
  onWpOpen: () => void;
  isSaving: boolean;
  savedPostId: number | null;
  originalUrl: string;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [overriddenContent, setOverriddenContent] = useState<string | null>(null);
  const [overriddenAt, setOverriddenAt] = useState<Date | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  const displayContent = overriddenContent ?? result.improvedContent;

  const handleRewrite = (newContent: string) => {
    setOverriddenContent(newContent);
    setOverriddenAt(new Date());
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 line-clamp-2">{result.originalTitle}</h2>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
            <span>{result.wordCount} слов</span>
            <span>•</span>
            <span>{result.headings.length} заголовков</span>
            <span>•</span>
            <ScoreBadge score={result.seo.score} />
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={isSaving || !!savedPostId} onClick={() => onSave(displayContent)} className="gap-1">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {savedPostId ? 'Сохранено' : 'В библиотеку'}
          </Button>
          <Button variant="outline" size="sm" disabled={!savedPostId} onClick={onWpOpen} className="gap-1">
            <Globe className="w-4 h-4" />
            В WordPress
          </Button>
          <Button
            size="sm"
            className="gap-1 bg-green-600 hover:bg-green-700 text-white"
            onClick={() => setPublishDialogOpen(true)}
          >
            <Globe className="w-4 h-4" />
            Обновить на сайте
          </Button>
        </div>
      </div>

      <Tabs defaultValue="improved">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="improved"><TrendingUp className="w-4 h-4 mr-1" />Текст</TabsTrigger>
          <TabsTrigger value="preview"><Eye className="w-4 h-4 mr-1" />Предпросмотр</TabsTrigger>
          <TabsTrigger value="seo"><BookOpen className="w-4 h-4 mr-1" />SEO</TabsTrigger>
          <TabsTrigger value="competitors"><Users className="w-4 h-4 mr-1" />Конкуренты</TabsTrigger>
        </TabsList>

        <TabsContent value="improved" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Улучшенная версия</span>
                <div className="flex items-center gap-2">
                  {overriddenContent && (
                    <Badge className="bg-green-100 text-green-800 text-xs">
                      ✓ Обновлено с учётом конкурентов
                      {overriddenAt && ` · ${overriddenAt.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`}
                    </Badge>
                  )}
                  <Badge className="bg-blue-100 text-blue-800">AI</Badge>
                </div>
              </CardTitle>
              <p className="text-sm text-slate-500"><span className="font-medium">Заголовок:</span> {result.improvedTitle}</p>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[500px] overflow-y-auto">
                {displayContent}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 cursor-pointer" onClick={() => setShowOriginal(!showOriginal)}>
              <CardTitle className="text-base flex items-center justify-between text-slate-500">
                <span>Оригинал</span>
                {showOriginal ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CardTitle>
            </CardHeader>
            {showOriginal && (
              <CardContent>
                <div className="bg-slate-50 p-4 rounded-lg text-sm text-slate-600 whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                  {result.originalContent.slice(0, 3000)}{result.originalContent.length > 3000 ? '...' : ''}
                </div>
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* Preview tab */}
        <TabsContent value="preview">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Предпросмотр статьи</span>
                <div className="flex items-center gap-2">
                  {overriddenContent && (
                    <Badge className="bg-green-100 text-green-700 text-xs">с учётом конкурентов</Badge>
                  )}
                  <Badge variant="outline" className="text-xs">с кнопками конверсии</Badge>
                </div>
              </CardTitle>
              <p className="text-xs text-slate-400 mt-1">
                Так статья будет выглядеть на сайте — с форматированием и 3 кнопками заказа
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <iframe
                srcDoc={buildPreviewHtml(
                  result.improvedTitle,
                  displayContent,
                  localStorage.getItem(CTA_URL_KEY) || 'https://kadastrmap.info/order/'
                )}
                className="w-full rounded-b-lg border-0"
                style={{ height: '75vh', minHeight: 500 }}
                sandbox="allow-same-origin"
                title="Предпросмотр статьи"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Мета-теги</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Title (рекомендуемый)</p>
                <div className="bg-slate-50 p-3 rounded text-sm font-medium">{result.seo.metaTitle}</div>
                <p className="text-xs text-slate-400 mt-1">Оригинал: {result.originalTitle}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Meta Description</p>
                <div className="bg-slate-50 p-3 rounded text-sm">{result.seo.metaDescription}</div>
              </div>
            </CardContent>
          </Card>

          {result.seo.keywords?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Ключевые слова</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {result.seo.keywords.map((kw, i) => <Badge key={i} variant="secondary">{kw}</Badge>)}
                </div>
              </CardContent>
            </Card>
          )}

          {result.seo.headingsSuggestions?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Заголовки</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {result.seo.headingsSuggestions.map((h, i) => (
                  <div key={i} className="border rounded-lg p-3">
                    <Badge variant="outline" className="text-xs mb-2">{h.level}</Badge>
                    <p className="text-sm text-slate-500 line-through">{h.current}</p>
                    <p className="text-sm font-medium text-slate-800">→ {h.suggested}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {result.seo.generalSuggestions?.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Рекомендации</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.seo.generalSuggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="text-blue-500 mt-0.5 shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.seo.competitorInsights && result.seo.competitorInsights.length > 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <span>🏆</span> Анализ конкурентов из SERP
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.seo.competitorInsights.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-orange-800">
                      <span className="text-orange-500 mt-0.5 shrink-0">▲</span>{s}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {result.headings.length > 0 && (
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Текущая структура заголовков</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {result.headings.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-xs w-10 justify-center shrink-0">{h.level}</Badge>
                      <span className="text-slate-700 truncate">{h.text}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Competitors tab */}
        <TabsContent value="competitors">
          <CompetitorPanel
            ourUrl={undefined}
            ourContent={result.originalContent}
            ourTitle={result.seo.metaTitle || result.originalTitle}
            onRewrite={handleRewrite}
          />
        </TabsContent>
      </Tabs>

      <PublishToSiteDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        originalUrl={originalUrl}
        title={result.improvedTitle}
        content={displayContent}
      />
    </div>
  );
}

type ArticleIdea = {
  title: string;
  keyword: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  searchIntent: 'informational' | 'transactional' | 'navigational';
};

const PRIORITY_COLORS = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-slate-100 text-slate-600',
};
const PRIORITY_LABELS = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const INTENT_LABELS = { informational: 'Инфо', transactional: 'Коммерция', navigational: 'Навигация' };

function ArticleIdeas({ onAnalyze }: { onAnalyze: (url: string) => void }) {
  const [catalogUrl, setCatalogUrl]   = useState('https://kadastrmap.info/kadastr/');
  const [niche, setNiche]             = useState('кадастр, земельные участки, недвижимость, кадастровая стоимость');
  const [count, setCount]             = useState(20);
  const [ourTitles, setOurTitles]     = useState<string[]>([]);
  const [ideas, setIdeas]             = useState<ArticleIdea[]>([]);
  const [ourCount, setOurCount]       = useState(0);
  const [filterPriority, setFilterPriority] = useState<'all'|'high'|'medium'|'low'>('all');
  const [serpKeyword, setSerpKeyword] = useState('');
  const [serpTitles, setSerpTitles]   = useState<string[]>([]);

  // Load from cache first
  const [cachedLoaded, setCachedLoaded] = useState(false);
  if (!cachedLoaded) {
    const cached = loadCachedArticles();
    if (cached.length > 0 && ourTitles.length === 0) setOurTitles(cached.map(a => a.title));
    setCachedLoaded(true);
  }

  // Scan catalog to get our titles
  const { mutate: scanCatalog, isPending: isScanning } = trpc.articles.scanCatalog.useMutation({
    onSuccess: (data) => {
      const titles = data.articles.map(a => a.title);
      setOurTitles(titles);
      toast.success(`Загружено ${titles.length} заголовков со ${data.scannedPages} стр.`);
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка сканирования'),
  });

  // Fetch SERP for competitor titles
  const { mutate: analyzeSerp, isPending: isSerpLoading } = trpc.articles.analyzeCompetitors.useMutation({
    onSuccess: (data) => {
      const titles = [
        ...data.google.results.map(r => r.title),
        ...data.yandex.results.map(r => r.title),
      ].filter(Boolean);
      setSerpTitles(titles);
      toast.success(`Загружено ${titles.length} заголовков конкурентов`);
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка SERP'),
  });

  const [ideasError, setIdeasError] = useState<string | null>(null);

  // Generate ideas
  const { mutate: suggest, isPending: isGenerating } = trpc.articles.suggestArticleIdeas.useMutation({
    onSuccess: (data) => {
      setIdeas(data.ideas as ArticleIdea[]);
      setOurCount(data.ourCount);
      setIdeasError(null);
      if (data.ideas.length === 0) setIdeasError('AI не вернул идеи — попробуйте ещё раз');
    },
    onError: (e: any) => {
      const msg = e?.message || 'Ошибка генерации';
      setIdeasError(msg);
      toast.error(msg);
    },
  });

  const filtered = ideas.filter(i => filterPriority === 'all' || i.priority === filterPriority);

  return (
    <div className="space-y-4">
      {/* Step 1: Load our articles */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-600">Шаг 1 — Загрузить наши статьи</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Input
              value={catalogUrl}
              onChange={(e) => setCatalogUrl(e.target.value)}
              placeholder="URL каталога"
              className="flex-1"
            />
            <Button
              variant="outline"
              onClick={() => scanCatalog({ url: catalogUrl, maxPages: 150, startPage: 1 })}
              disabled={isScanning}
              className="gap-2 shrink-0"
            >
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <List className="w-4 h-4" />}
              {isScanning ? 'Загружаю...' : ourTitles.length > 0 ? `Обновить (${ourTitles.length})` : 'Загрузить'}
            </Button>
          </div>
          {ourTitles.length > 0 && (
            <p className="text-xs text-green-700">✓ Загружено {ourTitles.length} статей</p>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Optional SERP */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-600">Шаг 2 — Загрузить конкурентов из поиска (необязательно)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <Input
              value={serpKeyword}
              onChange={(e) => setSerpKeyword(e.target.value)}
              placeholder="Ключевое слово для SERP (напр. кадастровая стоимость)"
              className="flex-1"
              onKeyDown={(e) => e.key === 'Enter' && serpKeyword.trim() && analyzeSerp({ keyword: serpKeyword })}
            />
            <Button
              variant="outline"
              onClick={() => analyzeSerp({ keyword: serpKeyword })}
              disabled={isSerpLoading || !serpKeyword.trim()}
              className="gap-2 shrink-0"
            >
              {isSerpLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              {isSerpLoading ? 'Парсим...' : serpTitles.length > 0 ? `Обновить (${serpTitles.length})` : 'Загрузить'}
            </Button>
          </div>
          {serpTitles.length > 0 && (
            <p className="text-xs text-green-700">✓ Загружено {serpTitles.length} заголовков конкурентов</p>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Generate ideas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-slate-600">Шаг 3 — Найти пробелы в контенте</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Ниша / тематика сайта</label>
            <Input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="кадастр, земельные участки, недвижимость..."
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-500 whitespace-nowrap">Количество идей:</label>
            <Input
              type="number" min={5} max={50} value={count}
              onChange={(e) => setCount(Math.min(50, Math.max(5, parseInt(e.target.value) || 20)))}
              className="w-24"
            />
            <Button
              onClick={() => suggest({ niche, ourTitles, competitorTitles: serpTitles, count })}
              disabled={isGenerating || ourTitles.length === 0}
              className="gap-2 flex-1"
              title={ourTitles.length === 0 ? 'Сначала загрузите статьи (шаг 1)' : ''}
            >
              {isGenerating
                ? <><Loader2 className="w-4 h-4 animate-spin" />Анализирую пробелы...</>
                : <><TrendingUp className="w-4 h-4" />Найти пробелы</>}
            </Button>
          </div>
          {ourTitles.length === 0 && (
            <p className="text-xs text-orange-600">Сначала выполните шаг 1 — загрузите наши статьи</p>
          )}
        </CardContent>
      </Card>

      {/* Generating loader */}
      {isGenerating && (
        <Card>
          <CardContent className="flex flex-col items-center py-12 gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
            <p className="text-slate-700 font-medium">AI анализирует пробелы в контенте...</p>
            <p className="text-sm text-slate-400">Анализирую {ourTitles.length} ваших статей и подбираю идеи. Обычно 15–30 сек.</p>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {ideasError && !isGenerating && ideas.length === 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-4">
            <p className="text-sm text-red-700 font-medium">Ошибка генерации</p>
            <p className="text-xs text-red-600 mt-1">{ideasError}</p>
            <Button
              size="sm" variant="outline"
              className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
              onClick={() => { setIdeasError(null); suggest({ niche, ourTitles, competitorTitles: serpTitles, count }); }}
            >Попробовать ещё раз</Button>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {ideas.length > 0 && !isGenerating && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">
                Идеи для статей ({filtered.length} / {ideas.length})
                <span className="text-sm font-normal text-slate-500 ml-2">
                  — проанализировано {ourCount} наших статей
                </span>
              </CardTitle>
              <div className="flex gap-1">
                {(['all','high','medium','low'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setFilterPriority(p)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${filterPriority === p ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    {p === 'all' ? 'Все' : PRIORITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {filtered.map((idea, i) => (
                <div key={i} className="px-4 py-3 hover:bg-slate-50 group">
                  <div className="flex items-start gap-3">
                    <span className="text-sm font-bold text-slate-300 w-5 shrink-0 mt-0.5">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800 leading-tight">{idea.title}</p>
                        <div className="flex gap-1.5 shrink-0">
                          <Badge className={`text-xs ${PRIORITY_COLORS[idea.priority] || PRIORITY_COLORS.low}`}>
                            {PRIORITY_LABELS[idea.priority] || idea.priority}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {INTENT_LABELS[idea.searchIntent] || idea.searchIntent}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">{idea.keyword}</Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{idea.reason}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => onAnalyze(idea.title)}
                      title="Открыть в анализаторе"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const CATALOG_CACHE_KEY = 'catalog_articles_cache';
const PAGE_SIZE = 20; // articles per page in the list UI

function loadCachedArticles(): CatalogArticle[] {
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCachedArticles(articles: CatalogArticle[]) {
  try { localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(articles)); } catch {}
}

function CatalogScanner({
  onAnalyze, onBatchAnalyze, analyzedUrls, isBatching, batchDone, batchTotal, onStopBatch,
  onServerBatch, serverBatch, onStopServerBatch,
}: {
  onAnalyze: (url: string) => void;
  onBatchAnalyze: (urls: string[]) => void;
  analyzedUrls: Set<string>;
  isBatching: boolean;
  batchDone: number;
  batchTotal: number;
  onStopBatch: () => void;
  onServerBatch: (urls: string[]) => void;
  serverBatch?: { running: boolean; done: number; total: number; errors: number } | null;
  onStopServerBatch: () => void;
}) {
  const [catalogUrl, setCatalogUrl] = useState('https://kadastrmap.info/kadastr/');
  const [articles, setArticles]     = useState<CatalogArticle[]>(() => loadCachedArticles());
  const [totalPages, setTotalPages] = useState(0);
  const [scannedPages, setScannedPages] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0); // 0-100
  const [search, setSearch]         = useState('');
  const [page, setPage]             = useState(1);     // current UI page

  const CHUNK = 30; // pages per batch request

  const { mutateAsync: scanChunk } = trpc.articles.scanCatalog.useMutation();

  const filtered = articles.filter(a =>
    !search ||
    a.title.toLowerCase().includes(search.toLowerCase()) ||
    a.url.toLowerCase().includes(search.toLowerCase())
  );

  const totalUiPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset UI page when search changes
  const handleSearch = (val: string) => { setSearch(val); setPage(1); };

  async function startScan(scanAll: boolean) {
    setIsScanning(true);
    setScanProgress(0);

    try {
      // First chunk — also discovers totalPages
      const first = await scanChunk({ url: catalogUrl, maxPages: CHUNK, startPage: 1 });
      const total = first.totalPages;
      setTotalPages(total);

      const newArticles: CatalogArticle[] = [...first.articles];
      setScanProgress(Math.round((Math.min(CHUNK, total) / total) * 100));

      if (scanAll && total > CHUNK) {
        for (let start = CHUNK + 1; start <= total; start += CHUNK) {
          const chunk = await scanChunk({
            url: catalogUrl,
            maxPages: Math.min(CHUNK, total - start + 1),
            startPage: start,
          });
          newArticles.push(...chunk.articles);
          setScannedPages(Math.min(start + CHUNK - 1, total));
          setScanProgress(Math.round((Math.min(start + CHUNK - 1, total) / total) * 100));
        }
      }

      // Merge with existing articles (dedup by URL)
      setArticles(prev => {
        const existingUrls = new Set(newArticles.map(a => a.url));
        const kept = prev.filter(a => !existingUrls.has(a.url));
        const merged = [...kept, ...newArticles];
        saveCachedArticles(merged);
        return merged;
      });

      setScannedPages(scanAll ? total : Math.min(CHUNK, total));
      setScanProgress(100);
      toast.success(`Добавлено ${newArticles.length} статей из ${catalogUrl}`);
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка сканирования');
    } finally {
      setIsScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Scan form */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <Input
            value={catalogUrl}
            onChange={(e) => setCatalogUrl(e.target.value)}
            placeholder="https://kadastrmap.info/kadastr/"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => startScan(false)}
              disabled={isScanning}
              className="gap-2"
            >
              {isScanning && scanProgress < 100 / (149 / CHUNK)
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <List className="w-4 h-4" />}
              Первые {CHUNK} стр.
            </Button>
            <Button
              onClick={() => startScan(true)}
              disabled={isScanning}
              className="gap-2 flex-1"
            >
              {isScanning
                ? <><Loader2 className="w-4 h-4 animate-spin" />Сканирую... {scanProgress}%</>
                : <><List className="w-4 h-4" />Сканировать все страницы</>}
            </Button>
            {articles.length > 0 && !isScanning && (
              <Button variant="ghost" size="sm" onClick={() => { setArticles([]); saveCachedArticles([]); }} className="text-slate-400 hover:text-red-500">
                Очистить
              </Button>
            )}
          </div>

          {/* Progress bar */}
          {isScanning && (
            <div className="space-y-1">
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${scanProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                Загружено: <strong>{articles.length}</strong> статей · {scanProgress}%
              </p>
            </div>
          )}

          {!isScanning && articles.length > 0 && (
            <p className="text-xs text-slate-400">
              Всего страниц: <strong>{totalPages}</strong> ·
              Отсканировано: <strong>{scannedPages}</strong> ·
              Статей: <strong>{articles.length}</strong>
              {articles.length > 0 && <span className="text-green-600 ml-2">· кэш сохранён</span>}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Server batch progress bar */}
      {serverBatch && (serverBatch.running || serverBatch.total > 0) && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-green-800 font-medium">
                🖥 Сервер: {serverBatch.done} / {serverBatch.total}
                {serverBatch.errors > 0 && <span className="text-orange-600 ml-2">({serverBatch.errors} ошибок)</span>}
                {!serverBatch.running && serverBatch.done > 0 && <span className="text-green-700 ml-2">✓ Готово</span>}
              </span>
              {serverBatch.running && (
                <Button size="sm" variant="outline" onClick={onStopServerBatch} className="gap-1 h-7 text-xs border-green-300 text-green-700 hover:bg-green-100">
                  <Square className="w-3 h-3" />Стоп
                </Button>
              )}
            </div>
            <div className="w-full bg-green-200 rounded-full h-2">
              <div className="bg-green-500 h-2 rounded-full transition-all duration-300" style={{ width: `${serverBatch.total > 0 ? Math.round((serverBatch.done / serverBatch.total) * 100) : 0}%` }} />
            </div>
            <p className="text-xs text-green-600">Вкладку можно закрыть — анализ продолжается на сервере</p>
          </CardContent>
        </Card>
      )}

      {/* Browser batch progress bar */}
      {isBatching && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-blue-800 font-medium">
                Пакетный анализ: {batchDone} / {batchTotal}
              </span>
              <Button size="sm" variant="outline" onClick={onStopBatch} className="gap-1 h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100">
                <Square className="w-3 h-3" />Стоп
              </Button>
            </div>
            <div className="w-full bg-blue-200 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${batchTotal > 0 ? Math.round((batchDone / batchTotal) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-blue-600">Результаты сохраняются в историю автоматически</p>
          </CardContent>
        </Card>
      )}

      {/* Article list with pagination */}
      {articles.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <CardTitle className="text-base shrink-0">
                Статьи ({filtered.length})
                {analyzedUrls.size > 0 && (
                  <span className="text-xs font-normal text-green-600 ml-2">
                    · {articles.filter(a => analyzedUrls.has(a.url)).length} ✓
                  </span>
                )}
              </CardTitle>
              <Input
                placeholder="Поиск..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="flex-1 h-8 text-sm min-w-[120px]"
              />
              {(() => {
                const unanalyzed = filtered.filter(a => !analyzedUrls.has(a.url));
                if (unanalyzed.length === 0) return null;
                return (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBatching || serverBatch?.running}
                      onClick={() => {
                        if (!confirm(`Серверный анализ: ${unanalyzed.length} статей (concurrency=3, ~${Math.round(unanalyzed.length * 7 / 60)} мин). Вкладку можно закрыть. Продолжить?`)) return;
                        onServerBatch(unanalyzed.map(a => a.url));
                      }}
                      className="gap-1 h-8 text-xs bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                      title="Анализ запускается на сервере — вкладку можно закрыть"
                    >
                      <Play className="w-3 h-3" />
                      На сервере ({unanalyzed.length})
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBatching || serverBatch?.running}
                      onClick={() => {
                        if (!confirm(`Браузерный анализ: ${unanalyzed.length} статей. Вкладку нельзя закрывать! Продолжить?`)) return;
                        onBatchAnalyze(unanalyzed.map(a => a.url));
                      }}
                      className="gap-1 h-8 text-xs"
                    >
                      <Play className="w-3 h-3" />
                      В браузере ({unanalyzed.length})
                    </Button>
                  </div>
                );
              })()}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {pageItems.map((article, i) => {
                const isAnalyzed = analyzedUrls.has(article.url);
                return (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 group">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-800 truncate">{article.title}</p>
                        {isAnalyzed && (
                          <Badge className="bg-green-100 text-green-700 text-xs shrink-0 px-1.5 py-0">✓</Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate">{article.url}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a href={article.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-slate-200">
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                      </a>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => onAnalyze(article.url)}>
                        <ArrowRight className="w-3 h-3" />
                        {isAnalyzed ? 'Повторить' : 'Анализировать'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalUiPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-slate-400">
                  Стр. {page} / {totalUiPages}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(1)} className="h-7 px-2 text-xs">«</Button>
                  <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="h-7 px-2 text-xs">‹</Button>
                  {Array.from({ length: Math.min(5, totalUiPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 2, totalUiPages - 4));
                    const p = start + i;
                    return (
                      <Button key={p} size="sm" variant={p === page ? 'default' : 'outline'}
                        onClick={() => setPage(p)} className="h-7 px-2 text-xs">{p}</Button>
                    );
                  })}
                  <Button size="sm" variant="outline" disabled={page === totalUiPages} onClick={() => setPage(p => p + 1)} className="h-7 px-2 text-xs">›</Button>
                  <Button size="sm" variant="outline" disabled={page === totalUiPages} onClick={() => setPage(totalUiPages)} className="h-7 px-2 text-xs">»</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isScanning && articles.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <List className="w-10 h-10 text-slate-300" />
            <p className="text-slate-500">Нажмите "Сканировать все страницы" для загрузки всего каталога</p>
            <p className="text-xs text-slate-400">149 страниц, ~1490 статей · займёт ~1 мин</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── SerpMonitor ─────────────────────────────────────────────────────────────

const SERP_CACHE_KEY = 'serp_positions_cache';

type SerpCacheEntry = {
  keyword:        string;
  googlePos:      number | null;
  yandexPos:      number | null;
  googleError:    string | null;
  yandexError:    string | null;
  topCompetitors: { title: string; domain: string; snippet: string }[];
  checkedAt:      string;
};
type SerpCache = Record<string, SerpCacheEntry>;

function loadSerpCache(): SerpCache {
  try { return JSON.parse(localStorage.getItem(SERP_CACHE_KEY) || '{}'); } catch { return {}; }
}
function saveSerpCache(c: SerpCache) {
  try { localStorage.setItem(SERP_CACHE_KEY, JSON.stringify(c)); } catch {}
}

function PosBadge({ pos, error }: { pos: number | null; error: string | null }) {
  if (error) return <span className="text-xs text-slate-400">ошибка</span>;
  if (pos === null) return <Badge variant="outline" className="text-xs text-slate-400">не в топ</Badge>;
  const cls = pos <= 3 ? 'bg-green-100 text-green-800' : pos <= 10 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
  return <Badge className={`text-xs ${cls}`}>#{pos}</Badge>;
}

type SerpPosFilter = 'all' | 'top3' | 'top10' | 'out' | 'unchecked';

function NewArticleDialog({ open, onOpenChange, keyword, competitors, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keyword: string;
  competitors: { title: string; domain: string; snippet: string }[];
  onCreated?: (content: string, title: string) => void;
}) {
  const [title, setTitle] = useState('');

  const { mutate: generate, isPending } = trpc.articles.generateNewArticle.useMutation({
    onSuccess: (d) => {
      toast.success(`Статья создана и сохранена в библиотеку (${d.content.split(/\s+/).length} слов)`);
      onCreated?.(d.content, d.title);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  return open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Новая статья</h2>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Заголовок статьи</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            placeholder={`Например: ${keyword}...`}
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
        </div>
        <div className="text-xs text-slate-500">
          Ключевое слово: <strong>{keyword}</strong> · Конкурентов: {competitors.length}
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            disabled={!title.trim() || isPending}
            onClick={() => generate({ title: title.trim(), keyword, competitors })}
            className="gap-2"
          >
            {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Генерирую...</> : <><ArrowRight className="w-4 h-4" />Создать статью</>}
          </Button>
        </div>
      </div>
    </div>
  ) : null;
}

function SerpMonitor({ onAnalyze }: { onAnalyze: (url: string) => void }) {
  const [cache, setCache]         = useState<SerpCache>(() => loadSerpCache());
  const [filter, setFilter]       = useState<SerpPosFilter>('all');
  const [search, setSearch]       = useState('');
  const [page, setPage]           = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone]           = useState(0);
  const [total, setTotal]         = useState(0);
  const [newArticleKw, setNewArticleKw]       = useState('');
  const [newArticleComps, setNewArticleComps] = useState<{ title: string; domain: string; snippet: string }[]>([]);
  const [newArticleOpen, setNewArticleOpen]   = useState(false);
  const queueRef     = useRef<{ url: string; title: string }[]>([]);
  const isRunRef     = useRef(false);
  const PAGE = 50;

  const articles = loadCachedArticles();

  const { mutate: checkPos } = trpc.articles.checkPosition.useMutation({
    onSuccess: (d, vars) => {
      const url = queueRef.current[0]?.url || '';
      setCache(prev => {
        const next = { ...prev, [url]: { ...d, checkedAt: new Date().toISOString() } };
        saveSerpCache(next);
        return next;
      });
      advanceQueue();
    },
    onError: () => advanceQueue(),
  });

  function advanceQueue() {
    queueRef.current = queueRef.current.slice(1);
    setDone(d => d + 1);
    if (queueRef.current.length > 0) {
      const next = queueRef.current[0];
      checkPos({ keyword: extractKeyword(next.title) });
    } else {
      isRunRef.current = false;
      setIsRunning(false);
      toast.success('Мониторинг позиций завершён');
    }
  }

  function startMonitoring(onlyUnchecked: boolean) {
    const toCheck = articles.filter(a => !onlyUnchecked || !cache[a.url]);
    if (toCheck.length === 0) { toast.info('Все статьи уже проверены'); return; }
    queueRef.current = toCheck;
    isRunRef.current = true;
    setIsRunning(true);
    setDone(0);
    setTotal(toCheck.length);
    checkPos({ keyword: extractKeyword(toCheck[0].title) });
  }

  function stopMonitoring() {
    queueRef.current = [];
    isRunRef.current = false;
    setIsRunning(false);
  }

  function clearCache() {
    if (!confirm('Очистить все сохранённые позиции?')) return;
    setCache({});
    saveSerpCache({});
  }

  // Build rows
  const rows = articles.map(a => ({ ...a, cached: cache[a.url] ?? null }));

  const filtered = rows.filter(r => {
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    const pos = r.cached ? Math.min(r.cached.googlePos ?? 999, r.cached.yandexPos ?? 999) : 999;
    if (filter === 'unchecked') return !r.cached;
    if (filter === 'top3')  return r.cached && pos <= 3;
    if (filter === 'top10') return r.cached && pos > 3 && pos <= 10;
    if (filter === 'out')   return r.cached && pos > 10;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const pa = a.cached ? Math.min(a.cached.googlePos ?? 999, a.cached.yandexPos ?? 999) : 1000;
    const pb = b.cached ? Math.min(b.cached.googlePos ?? 999, b.cached.yandexPos ?? 999) : 1000;
    return pa - pb;
  });

  const totalPages = Math.ceil(sorted.length / PAGE);
  const visible = sorted.slice((page - 1) * PAGE, page * PAGE);

  const checkedCount  = articles.filter(a => cache[a.url]).length;
  const top3Count     = articles.filter(a => { const c = cache[a.url]; return c && Math.min(c.googlePos ?? 999, c.yandexPos ?? 999) <= 3; }).length;
  const top10Count    = articles.filter(a => { const c = cache[a.url]; return c && Math.min(c.googlePos ?? 999, c.yandexPos ?? 999) <= 10 && Math.min(c.googlePos ?? 999, c.yandexPos ?? 999) > 3; }).length;
  const outCount      = articles.filter(a => { const c = cache[a.url]; return c && Math.min(c.googlePos ?? 999, c.yandexPos ?? 999) > 10; }).length;
  const uncheckedCount = articles.length - checkedCount;

  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <TrendingUp className="w-10 h-10 text-slate-300" />
          <p className="text-slate-500">Сначала загрузите каталог на вкладке «Каталог»</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium text-slate-800">{articles.length} статей · проверено {checkedCount}</p>
              <p className="text-xs text-slate-500 mt-0.5">Проверяет позиции в Google и Яндекс по ключевому слову из заголовка</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isRunning ? (
                <Button size="sm" variant="outline" onClick={stopMonitoring} className="gap-1.5 text-red-600 border-red-200">
                  <Square className="w-3.5 h-3.5" />Стоп
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => startMonitoring(true)} disabled={uncheckedCount === 0} className="gap-1.5">
                    <Play className="w-3.5 h-3.5" />Новые ({uncheckedCount})
                  </Button>
                  <Button size="sm" onClick={() => startMonitoring(false)} className="gap-1.5">
                    <Play className="w-3.5 h-3.5" />Все заново
                  </Button>
                  {checkedCount > 0 && (
                    <Button size="sm" variant="ghost" onClick={clearCache} className="text-slate-400">Сбросить</Button>
                  )}
                </>
              )}
            </div>
          </div>

          {isRunning && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-blue-600">
                <span><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" />Проверяю: {queueRef.current[0]?.title?.slice(0, 60)}...</span>
                <span>{done} / {total}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {checkedCount > 0 && (
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Все', value: articles.length, f: 'all' as SerpPosFilter, color: 'bg-slate-50 text-slate-700' },
            { label: 'ТОП-3', value: top3Count, f: 'top3' as SerpPosFilter, color: 'bg-green-50 text-green-700' },
            { label: 'ТОП-10', value: top10Count, f: 'top10' as SerpPosFilter, color: 'bg-yellow-50 text-yellow-700' },
            { label: 'Вне ТОП', value: outCount, f: 'out' as SerpPosFilter, color: 'bg-red-50 text-red-700' },
            { label: 'Не проверены', value: uncheckedCount, f: 'unchecked' as SerpPosFilter, color: 'bg-slate-100 text-slate-500' },
          ].map(({ label, value, f, color }) => (
            <button key={f} onClick={() => { setFilter(f); setPage(1); }}
              className={`flex-1 min-w-[100px] rounded-xl p-3 border-2 transition-all text-left
                ${filter === f ? `border-current ${color}` : 'border-transparent bg-slate-50 hover:bg-slate-100'}`}>
              <div className="text-2xl font-bold text-slate-700">{value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="pt-4 pb-2">
          <div className="flex gap-2 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="Поиск по заголовку..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <span className="text-xs text-slate-500 self-center">{sorted.length} статей</span>
            <Button size="sm" variant="outline" className="gap-1.5"
              onClick={() => {
                const csv = ['URL,Keyword,Google,Yandex,Checked',
                  ...sorted.filter(r => r.cached).map(r =>
                    [r.url, `"${r.cached!.keyword}"`, r.cached!.googlePos ?? '', r.cached!.yandexPos ?? '', r.cached!.checkedAt].join(',')
                  )].join('\n');
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
                a.download = `serp_${new Date().toISOString().slice(0,10)}.csv`;
                a.click();
              }}>
              ↓ CSV
            </Button>
          </div>

          <div className="divide-y text-sm">
            {visible.map(r => (
              <div key={r.url} className="flex items-start gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded group">
                <div className="flex-1 min-w-0">
                  <button className="text-blue-700 hover:underline font-medium line-clamp-1 text-left w-full" onClick={() => onAnalyze(r.url)}>
                    {r.title}
                  </button>
                  {r.cached && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      ключ: <span className="text-slate-600">{r.cached.keyword}</span>
                      {r.cached.topCompetitors.length > 0 && (
                        <span className="ml-2 text-slate-400">· конкуренты: {r.cached.topCompetitors.map(c => c.domain).join(', ')}</span>
                      )}
                    </div>
                  )}
                </div>

                {r.cached ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-400">G:</span>
                    <PosBadge pos={r.cached.googlePos} error={r.cached.googleError} />
                    <span className="text-xs text-slate-400">Я:</span>
                    <PosBadge pos={r.cached.yandexPos} error={r.cached.yandexError} />
                  </div>
                ) : (
                  <span className="text-xs text-slate-300 shrink-0">не проверено</span>
                )}

                {/* Actions */}
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    title="Улучшить статью"
                    className="p-1 rounded hover:bg-blue-50 text-blue-600"
                    onClick={() => onAnalyze(r.url)}
                  ><ArrowRight className="w-3.5 h-3.5" /></button>
                  {r.cached && r.cached.topCompetitors.length > 0 && (
                    <button
                      title="Написать новую статью по этой теме"
                      className="p-1 rounded hover:bg-green-50 text-green-600"
                      onClick={() => {
                        setNewArticleKw(r.cached!.keyword);
                        setNewArticleComps(r.cached!.topCompetitors);
                        setNewArticleOpen(true);
                      }}
                    ><BookOpen className="w-3.5 h-3.5" /></button>
                  )}
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-slate-100">
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </a>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-3 pt-3 border-t">
              <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</Button>
              <span className="text-sm self-center text-slate-600">{page} / {totalPages}</span>
              <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>→</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <NewArticleDialog
        open={newArticleOpen}
        onOpenChange={setNewArticleOpen}
        keyword={newArticleKw}
        competitors={newArticleComps}
      />
    </div>
  );
}

// ── Duplicate Scanner ───────────────────────────────────────────────────────

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
}

type DuplicateGroup = { key: string; articles: CatalogArticle[] };

function findTitleDuplicates(articles: CatalogArticle[]): DuplicateGroup[] {
  const groups = new Map<string, CatalogArticle[]>();
  for (const art of articles) {
    const key = normalizeTitleKey(art.title);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(art);
  }
  return Array.from(groups.entries())
    .filter(([, arts]) => arts.length > 1)
    .map(([key, arts]) => ({ key, articles: arts }))
    .sort((a, b) => b.articles.length - a.articles.length);
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  '301_redirect': { label: '301 редирект', color: 'bg-blue-100 text-blue-700' },
  merge:          { label: 'Объединить',   color: 'bg-yellow-100 text-yellow-700' },
  delete:         { label: 'Удалить',      color: 'bg-red-100 text-red-700' },
};

type DupRec = {
  group: number;
  keepUrl: string;
  keepTitle: string;
  others: { url: string; action: string }[];
  reason: string;
};

function DuplicateScanner({
  onAnalyze, history = [], onServerBatch,
}: {
  onAnalyze: (url: string) => void;
  history?: { url: string; seoScore: number; wordCount: number }[];
  onServerBatch?: (urls: string[]) => void;
}) {
  const articles = loadCachedArticles().filter(a => a.title.length >= 5);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [recommendations, setRecommendations] = useState<DupRec[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [appliedUrls, setAppliedUrls] = useState<Set<string>>(new Set());
  const [applyingUrl, setApplyingUrl] = useState<string | null>(null);

  const { data: wpAccounts = [] } = trpc.wordpress.getAccounts.useQuery();
  const [applyAllProgress, setApplyAllProgress] = useState<{ done: number; total: number } | null>(null);

  // Auto-select first account when it loads
  useEffect(() => {
    if (wpAccounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId((wpAccounts as any[])[0].id);
    }
  }, [wpAccounts, selectedAccountId]);

  const { mutate: applyRedirect, mutateAsync: applyRedirectAsync } = trpc.articles.applyRedirect.useMutation({
    onSuccess: (_: any, vars: any) => {
      setAppliedUrls(prev => new Set(Array.from(prev).concat(vars.fromUrl)));
      setApplyingUrl(null);
      toast.success('301 редирект создан');
    },
    onError: (e: any) => {
      setApplyingUrl(null);
      toast.error(e?.message || 'Ошибка создания редиректа');
    },
  });

  const historyMap = new Map(history.map(h => [h.url, h]));

  const { mutate: getRecommendations, isPending: isRecommending } =
    trpc.articles.recommendDuplicates.useMutation({
      onSuccess: (d) => {
        setRecommendations(d.recommendations);
        toast.success('AI-рекомендации готовы');
      },
      onError: (e: any) => toast.error(e?.message || 'Ошибка AI'),
    });

  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-400 text-sm">
          Сначала загрузите каталог на вкладке «Каталог»
        </CardContent>
      </Card>
    );
  }

  const groups = findTitleDuplicates(articles);
  const filtered = search
    ? groups.filter(g => g.articles.some(a => a.title.toLowerCase().includes(search.toLowerCase())))
    : groups;

  const totalDuplicateArticles = groups.reduce((sum, g) => sum + g.articles.length, 0);
  const allDupUrls = groups.flatMap(g => g.articles.map(a => a.url));

  function handleAiRecommend() {
    const groupsInput = groups.map(g => ({
      articles: g.articles.map(a => {
        const h = historyMap.get(a.url);
        return { url: a.url, title: a.title, seoScore: h?.seoScore ?? null, wordCount: h?.wordCount ?? null };
      }),
    }));
    getRecommendations({ groups: groupsInput });
  }

  function downloadRedirectsJson() {
    const redirects: { url: string; action_code: number; action_type: string; action_data: { url: string }; match_type: string; group_id: number; enabled: boolean }[] = [];
    for (const rec of recommendations) {
      for (const other of rec.others) {
        if (other.action === '301_redirect') {
          try {
            const u = new URL(other.url);
            redirects.push({
              url: u.pathname,
              action_code: 301,
              action_type: 'url',
              action_data: { url: rec.keepUrl },
              match_type: 'url',
              group_id: 1,
              enabled: true,
            });
          } catch {}
        }
      }
    }
    if (redirects.length === 0) { toast.error('Нет 301-редиректов в рекомендациях'); return; }
    const json = JSON.stringify({ redirects }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'redirects-import.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Скачан файл с ${redirects.length} редиректами`);
  }

  async function handleApplyAll() {
    const accountId = selectedAccountId ?? ((wpAccounts as any[])[0]?.id ?? null);
    if (!accountId) { toast.error('Нет подключённых WordPress сайтов'); return; }
    const toApply: { fromUrl: string; toUrl: string }[] = [];
    for (const rec of recommendations) {
      for (const other of rec.others) {
        if (other.action === '301_redirect' && !appliedUrls.has(other.url)) {
          toApply.push({ fromUrl: other.url, toUrl: rec.keepUrl });
        }
      }
    }
    if (toApply.length === 0) { toast.error('Нет 301-редиректов для применения (все уже применены?)'); return; }
    if (!confirm(`Создать ${toApply.length} редиректов на WordPress?\nЭто действие необратимо.`)) return;

    setApplyAllProgress({ done: 0, total: toApply.length });
    for (const item of toApply) {
      try {
        await applyRedirectAsync({ accountId: accountId!, fromUrl: item.fromUrl, toUrl: item.toUrl, deletePost: false });
        setAppliedUrls(prev => new Set(Array.from(prev).concat(item.fromUrl)));
      } catch (e: any) {
        toast.error(`Ошибка: ${item.fromUrl.split('/').pop()}`);
      }
      setApplyAllProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
    }
    setApplyAllProgress(null);
    toast.success('Все редиректы применены!');
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium text-slate-800">
                Найдено <span className="text-pink-700 font-bold">{groups.length}</span> групп дублей
                <span className="text-slate-400 font-normal ml-1">({totalDuplicateArticles} статей)</span>
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Из {articles.length} статей · группировка по первым 6 словам заголовка
              </p>
            </div>
            <Input placeholder="Поиск..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-40 h-8 text-sm" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm" variant="outline"
              disabled={isRecommending}
              onClick={handleAiRecommend}
              className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
            >
              {isRecommending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              {isRecommending ? 'AI анализирует...' : 'AI-рекомендации для всех групп'}
            </Button>
            {onServerBatch && (
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  if (!confirm(`Проанализировать все ${allDupUrls.length} дублей на сервере?`)) return;
                  onServerBatch(allDupUrls);
                }}
                className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50"
              >
                <Play className="w-3.5 h-3.5" />Анализировать все дубли ({allDupUrls.length})
              </Button>
            )}
            {wpAccounts.length > 0 && (
              <select
                className="h-8 border border-slate-200 rounded text-xs px-2 text-slate-600 bg-white"
                value={selectedAccountId ?? ''}
                onChange={e => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">WP сайт для редиректов...</option>
                {wpAccounts.map((a: any) => (
                  <option key={a.id} value={a.id}>{a.siteName}</option>
                ))}
              </select>
            )}
            {recommendations.length > 0 && (wpAccounts.length > 0 || selectedAccountId) && (
              <Button
                size="sm"
                disabled={!!applyAllProgress}
                onClick={handleApplyAll}
                className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white border-0"
              >
                {applyAllProgress
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{applyAllProgress.done}/{applyAllProgress.total}</>
                  : <><Play className="w-3.5 h-3.5" />Применить все 301</>
                }
              </Button>
            )}
            {recommendations.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={downloadRedirectsJson}
                className="gap-1.5 text-slate-600 border-slate-200 hover:bg-slate-50"
              >
                ↓ JSON для Redirection
              </Button>
            )}
          </div>
          {applyAllProgress && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Применяю редиректы...</span>
                <span>{applyAllProgress.done} / {applyAllProgress.total}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${(applyAllProgress.done / applyAllProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-slate-400 text-sm">
            {search ? 'Не найдено' : 'Дублей не обнаружено — отлично!'}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((group, gi) => {
          const rec = recommendations.find(r => r.group === gi + 1);
          return (
            <Card key={group.key} className={rec ? 'border-purple-200' : 'border-pink-100'}>
              <CardContent className="pt-3 pb-3">
                <button className="w-full text-left" onClick={() => setExpanded(expanded === group.key ? null : group.key)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{group.articles[0].title}</p>
                      <p className="text-xs text-pink-600 mt-0.5">{group.articles.length} похожих статей</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rec && <Badge className="bg-purple-100 text-purple-700 text-xs">✓ AI</Badge>}
                      <Badge className="bg-pink-100 text-pink-700 text-xs">{group.articles.length}×</Badge>
                      {expanded === group.key ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>
                </button>

                {rec && (
                  <div className="mt-2 p-2.5 rounded-lg bg-purple-50 border border-purple-100 text-xs text-purple-800">
                    <span className="font-semibold">AI: </span>{rec.reason}
                    <span className="ml-2 text-purple-600">Оставить: <a href={rec.keepUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-purple-900">{rec.keepTitle || rec.keepUrl}</a></span>
                  </div>
                )}

                {expanded === group.key && (
                  <div className="mt-3 divide-y border rounded-lg overflow-hidden">
                    {group.articles.map((art, i) => {
                      const h = historyMap.get(art.url);
                      const artAction = rec?.others.find(o => o.url === art.url)?.action;
                      const isKeep = rec?.keepUrl === art.url;
                      return (
                        <div key={i} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isKeep ? 'bg-green-50' : 'hover:bg-slate-50'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-slate-700 truncate">{art.title}</p>
                              {isKeep && <Badge className="bg-green-100 text-green-700 text-xs shrink-0">оставить</Badge>}
                              {artAction && ACTION_LABELS[artAction] && (
                                <Badge className={`text-xs shrink-0 ${ACTION_LABELS[artAction].color}`}>{ACTION_LABELS[artAction].label}</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-xs text-slate-400 truncate">{art.url}</p>
                              {h && <span className={`text-xs font-medium shrink-0 ${h.seoScore >= 80 ? 'text-green-600' : h.seoScore >= 60 ? 'text-yellow-600' : 'text-red-500'}`}>SEO {h.seoScore}</span>}
                              {h && <span className="text-xs text-slate-400 shrink-0">{h.wordCount} сл.</span>}
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0 items-center">
                            {artAction === '301_redirect' && rec && (wpAccounts.length > 0 || selectedAccountId) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!applyingUrl || appliedUrls.has(art.url)}
                                className={`h-7 px-2 text-xs gap-1 ${appliedUrls.has(art.url) ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'}`}
                                onClick={() => {
                                  if (!confirm(`Создать 301 редирект:\n${art.url}\n→ ${rec.keepUrl}`)) return;
                                  setApplyingUrl(art.url);
                                  applyRedirect({ accountId: selectedAccountId ?? (wpAccounts as any[])[0]?.id ?? 0, fromUrl: art.url, toUrl: rec.keepUrl, deletePost: false });
                                }}
                              >
                                {applyingUrl === art.url ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                {appliedUrls.has(art.url) ? '✓ Готово' : '→ 301'}
                              </Button>
                            )}
                            <a href={art.url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-slate-200">
                              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                            </a>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs gap-1" onClick={() => onAnalyze(art.url)}>
                              <ArrowRight className="w-3 h-3" />Анализ
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── CatalogAudit ────────────────────────────────────────────────────────────

type AuditIssueFilter = 'all' | 'issues' | 'ok' | 'tooShort' | 'noMeta' | 'noH1' | 'multiH1' | 'duplicates' | 'errors';
type AuditSort = 'wordCount' | 'h1' | 'issues' | 'title';
type SortDir = 'asc' | 'desc';

type AuditRow = {
  url: string;
  title: string;
  wordCount: number;
  headingsCount: number;
  hasMeta: boolean;
  h1Count: number;
  issues: string[];
};

type AuditStats = {
  total: number;
  tooShort: number;
  noMeta: number;
  noH1: number;
  duplicates: number;
  errors: number;
  ok: number;
};

function getSection(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split('/').filter(Boolean)[0];
    return seg || '?';
  } catch { return '?'; }
}

function sectionColor(s: string): string {
  if (s === 'kadastr') return 'bg-blue-50 text-blue-700';
  if (s === 'reestr')  return 'bg-violet-50 text-violet-700';
  return 'bg-slate-100 text-slate-600';
}

function exportCsv(rows: AuditRow[]) {
  const header = ['URL', 'Заголовок', 'Слов', 'Заголовков', 'H1', 'Мета', 'Раздел', 'Проблемы'];
  const lines = rows.map(r => [
    r.url,
    `"${r.title.replace(/"/g, '""')}"`,
    r.wordCount,
    r.headingsCount,
    r.h1Count,
    r.hasMeta ? 'да' : 'нет',
    getSection(r.url),
    `"${r.issues.join('; ')}"`,
  ].join(','));
  const csv = [header.join(','), ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

function StatCard({ label, value, color, filter, active, onClick }: {
  label: string; value: number; color: string;
  filter: AuditIssueFilter; active: boolean; onClick: (f: AuditIssueFilter) => void;
}) {
  return (
    <button
      onClick={() => onClick(filter)}
      className={`flex-1 min-w-[110px] rounded-xl p-3 border-2 transition-all text-left
        ${active ? `border-current ${color}` : `border-transparent bg-slate-50 hover:bg-slate-100`}`}
    >
      <div className={`text-2xl font-bold ${active ? '' : 'text-slate-700'}`}>{value}</div>
      <div className={`text-xs mt-0.5 ${active ? '' : 'text-slate-500'}`}>{label}</div>
    </button>
  );
}

function CatalogAudit({ onAnalyze, onBatchAnalyze, history, onServerBatch }: {
  onAnalyze: (url: string) => void;
  onBatchAnalyze: (urls: string[]) => void;
  history?: { url: string; seoScore: number; wordCount: number }[];
  onServerBatch?: (urls: string[]) => void;
}) {
  const [filter, setFilter] = useState<AuditIssueFilter>('all');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [sortBy, setSortBy]   = useState<AuditSort>('wordCount');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const PAGE = 50;

  const articles = loadCachedArticles().filter(a => {
    const t = a.title.toLowerCase();
    return a.title.length >= 5 && !t.includes('читать дальше') && !t.includes('read more') && !/^[→←\s.]+$/.test(a.title);
  });

  // Derive unique sections from cached articles
  const sections = Array.from(new Set(articles.map(a => getSection(a.url)))).sort();

  const { mutateAsync: auditChunk } = trpc.articles.auditArticles.useMutation();
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditDone, setAuditDone] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [allRows, setAllRows] = useState<AuditRow[]>([]);
  const stopAuditRef = useRef(false);

  const isPending = auditRunning;
  const rows: AuditRow[] = allRows;
  const multiH1Count = rows.filter(r => r.h1Count > 1).length;

  const stats: AuditStats | null = rows.length > 0 ? {
    total: rows.length,
    tooShort: rows.filter(r => r.wordCount > 0 && r.wordCount < 500).length,
    noMeta: rows.filter(r => r.wordCount > 0 && !r.hasMeta).length,
    noH1: rows.filter(r => r.wordCount > 0 && r.h1Count === 0).length,
    duplicates: rows.filter(r => r.issues.includes('Дубликат заголовка')).length,
    errors: rows.filter(r => r.issues.includes('Ошибка загрузки')).length,
    ok: rows.filter(r => r.issues.length === 0).length,
  } : null;

  async function startChunkedAudit() {
    stopAuditRef.current = false;
    setAuditRunning(true);
    setAllRows([]);
    setAuditDone(0);
    setAuditTotal(articles.length);
    const CHUNK = 100;
    const accumulated: AuditRow[] = [];
    for (let i = 0; i < articles.length; i += CHUNK) {
      if (stopAuditRef.current) break;
      const chunk = articles.slice(i, i + CHUNK);
      try {
        const result = await auditChunk({ articles: chunk });
        accumulated.push(...result.results);
        setAllRows([...accumulated]);
      } catch (e: any) {
        toast.error(`Ошибка блока ${i + 1}–${Math.min(i + CHUNK, articles.length)}: ${e?.message || 'неизвестная ошибка'}`);
      }
      setAuditDone(Math.min(i + CHUNK, articles.length));
    }
    setAuditRunning(false);
    if (!stopAuditRef.current) toast.success(`Аудит завершён: ${accumulated.length} статей`);
    else toast.info('Аудит остановлен');
  }

  const filtered = rows.filter(r => {
    if (sectionFilter !== 'all' && getSection(r.url) !== sectionFilter) return false;
    if (search && !r.title.toLowerCase().includes(search.toLowerCase()) && !r.url.includes(search)) return false;
    if (filter === 'all') return true;
    if (filter === 'ok') return r.issues.length === 0;
    if (filter === 'issues') return r.issues.length > 0;
    if (filter === 'tooShort') return r.wordCount > 0 && r.wordCount < 500;
    if (filter === 'noMeta') return !r.hasMeta && r.wordCount > 0;
    if (filter === 'noH1') return r.h1Count === 0 && r.wordCount > 0;
    if (filter === 'multiH1') return r.h1Count > 1;
    if (filter === 'duplicates') return r.issues.includes('Дубликат заголовка');
    if (filter === 'errors') return r.issues.includes('Ошибка загрузки');
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'wordCount') cmp = a.wordCount - b.wordCount;
    else if (sortBy === 'h1') cmp = a.h1Count - b.h1Count;
    else if (sortBy === 'issues') cmp = a.issues.length - b.issues.length;
    else if (sortBy === 'title') cmp = a.title.localeCompare(b.title, 'ru');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalPages = Math.ceil(sorted.length / PAGE);
  const visible = sorted.slice((page - 1) * PAGE, page * PAGE);

  function handleFilter(f: AuditIssueFilter) { setFilter(f); setPage(1); }
  function handleSort(col: AuditSort) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }
  function SortIcon({ col }: { col: AuditSort }) {
    if (sortBy !== col) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-blue-500 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <ClipboardList className="w-10 h-10 text-slate-300" />
          <p className="text-slate-500">Сначала загрузите каталог на вкладке «Каталог»</p>
        </CardContent>
      </Card>
    );
  }

  const [auditTab, setAuditTab] = useState<'duplicates' | 'audit'>('duplicates');

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="flex gap-2">
        <Button variant={auditTab === 'duplicates' ? 'default' : 'outline'} size="sm" onClick={() => setAuditTab('duplicates')} className="gap-1.5">
          Дубли по заголовкам
        </Button>
        <Button variant={auditTab === 'audit' ? 'default' : 'outline'} size="sm" onClick={() => {
          setAuditTab('audit');
          if (rows.length === 0 && !auditRunning) setTimeout(() => startChunkedAudit(), 100);
        }} className="gap-1.5">
          Полный аудит {auditRunning ? `(${auditDone}/${auditTotal})` : rows.length > 0 ? `(${rows.length})` : ''}
        </Button>
      </div>

      {auditTab === 'duplicates' && <DuplicateScanner onAnalyze={onAnalyze} history={history} onServerBatch={onServerBatch} />}

      {auditTab === 'audit' && <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-slate-800">{articles.length} статей в каталоге</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Разделы: {sections.map(s => (
                  <span key={s} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs mr-1 ${sectionColor(s)}`}>{s}</span>
                ))}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                onClick={startChunkedAudit}
                disabled={auditRunning}
                className="gap-2"
              >
                {auditRunning ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Аудит {auditDone}/{auditTotal}</>
                ) : (
                  <><ClipboardList className="w-4 h-4" />{rows.length > 0 ? 'Перезапустить' : 'Запустить аудит'}</>
                )}
              </Button>
              {auditRunning && (
                <Button variant="outline" size="sm" onClick={() => { stopAuditRef.current = true; }} className="gap-1 text-red-600 border-red-200 hover:bg-red-50">
                  <Square className="w-3.5 h-3.5" />Стоп
                </Button>
              )}
            </div>
          </div>

          {auditRunning && (
            <div className="mt-3 space-y-1.5">
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${auditTotal > 0 ? Math.round((auditDone / auditTotal) * 100) : 0}%` }} />
              </div>
              <p className="text-xs text-slate-500">
                Проверено <strong>{auditDone}</strong> из <strong>{auditTotal}</strong> статей · {auditTotal > 0 ? Math.round((auditDone / auditTotal) * 100) : 0}%
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats */}
      {stats && (
        <div className="flex gap-2 flex-wrap">
          <StatCard label="Всего" value={stats.total} color="bg-slate-100 text-slate-700" filter="all" active={filter === 'all'} onClick={handleFilter} />
          <StatCard label="Без проблем" value={stats.ok} color="bg-green-50 text-green-700" filter="ok" active={filter === 'ok'} onClick={handleFilter} />
          <StatCard label="С проблемами" value={stats.total - stats.ok - stats.errors} color="bg-yellow-50 text-yellow-700" filter="issues" active={filter === 'issues'} onClick={handleFilter} />
          <StatCard label="Мало текста" value={stats.tooShort} color="bg-orange-50 text-orange-700" filter="tooShort" active={filter === 'tooShort'} onClick={handleFilter} />
          <StatCard label="Несколько H1" value={multiH1Count} color="bg-red-50 text-red-700" filter="multiH1" active={filter === 'multiH1'} onClick={handleFilter} />
          <StatCard label="Нет H1" value={stats.noH1} color="bg-rose-50 text-rose-700" filter="noH1" active={filter === 'noH1'} onClick={handleFilter} />
          <StatCard label="Нет мета" value={stats.noMeta} color="bg-purple-50 text-purple-700" filter="noMeta" active={filter === 'noMeta'} onClick={handleFilter} />
          <StatCard label="Дубликаты" value={stats.duplicates} color="bg-pink-50 text-pink-700" filter="duplicates" active={filter === 'duplicates'} onClick={handleFilter} />
          <StatCard label="Ошибки" value={stats.errors} color="bg-gray-100 text-gray-600" filter="errors" active={filter === 'errors'} onClick={handleFilter} />
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <Card>
          <CardContent className="pt-4 pb-2">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-2 mb-3">
              <div className="relative flex-1 min-w-[180px]">
                <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  className="w-full pl-9 pr-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Поиск по заголовку или URL..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                />
              </div>

              {/* Section filter */}
              {sections.length > 1 && (
                <select
                  className="text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                  value={sectionFilter}
                  onChange={e => { setSectionFilter(e.target.value); setPage(1); }}
                >
                  <option value="all">Все разделы</option>
                  {sections.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              )}

              <span className="text-xs text-slate-500 self-center shrink-0">{sorted.length} статей</span>

              {/* Batch analyze button */}
              {filter !== 'ok' && sorted.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0 text-blue-700 border-blue-200 hover:bg-blue-50"
                  onClick={() => {
                    if (confirm(`Запустить AI-анализ для ${sorted.length} статей? Это займёт время.`)) {
                      onBatchAnalyze(sorted.map(r => r.url));
                    }
                  }}
                >
                  <Play className="w-3.5 h-3.5" />
                  Анализировать {sorted.length > 50 ? `(${sorted.length})` : `все (${sorted.length})`}
                </Button>
              )}

              {/* CSV export */}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 shrink-0"
                onClick={() => exportCsv(sorted)}
              >
                ↓ CSV
              </Button>
            </div>

            {/* Column headers */}
            <div className="flex gap-3 pb-1.5 border-b text-xs font-medium text-slate-500 mb-1">
              <div className="w-4 shrink-0" />
              <div className="flex-1">
                <button onClick={() => handleSort('title')} className="hover:text-slate-800">
                  Заголовок <SortIcon col="title" />
                </button>
              </div>
              <button onClick={() => handleSort('wordCount')} className="shrink-0 w-20 text-right hover:text-slate-800">
                Слов <SortIcon col="wordCount" />
              </button>
              <button onClick={() => handleSort('h1')} className="shrink-0 w-10 text-right hover:text-slate-800">
                H1 <SortIcon col="h1" />
              </button>
              <button onClick={() => handleSort('issues')} className="shrink-0 w-16 text-right hover:text-slate-800">
                Проблем <SortIcon col="issues" />
              </button>
              <div className="w-6 shrink-0" />
            </div>

            {/* Rows */}
            <div className="divide-y text-sm">
              {visible.map(r => {
                const sec = getSection(r.url);
                return (
                  <div key={r.url} className="flex items-start gap-3 py-2.5 hover:bg-slate-50 -mx-2 px-2 rounded">
                    {/* Status icon */}
                    <div className="mt-0.5 shrink-0 w-4">
                      {r.issues.includes('Ошибка загрузки') ? (
                        <XCircle className="w-4 h-4 text-gray-400" />
                      ) : r.issues.length === 0 ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-yellow-500" />
                      )}
                    </div>

                    {/* Title + meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${sectionColor(sec)}`}>{sec}</span>
                        <button
                          className="text-blue-700 hover:underline font-medium line-clamp-1 text-left"
                          onClick={() => onAnalyze(r.url)}
                        >
                          {r.title || r.url}
                        </button>
                      </div>
                      {r.issues.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {r.issues.map(issue => (
                            <span key={issue} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-red-50 text-red-700 border border-red-100">
                              {issue}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Word count */}
                    <div className={`shrink-0 w-20 text-right text-xs tabular-nums
                      ${r.wordCount > 0 && r.wordCount < 500 ? 'text-orange-600 font-semibold' : 'text-slate-500'}`}>
                      {r.wordCount > 0 ? `${r.wordCount} сл.` : '–'}
                    </div>

                    {/* H1 count */}
                    <div className={`shrink-0 w-10 text-right text-xs tabular-nums
                      ${r.h1Count === 0 ? 'text-red-500 font-semibold' : r.h1Count > 1 ? 'text-orange-500 font-semibold' : 'text-slate-400'}`}>
                      {r.wordCount > 0 ? r.h1Count : '–'}
                    </div>

                    {/* Issues count */}
                    <div className="shrink-0 w-16 text-right text-xs tabular-nums text-slate-400">
                      {r.issues.length > 0 ? <span className="text-red-500">{r.issues.length}</span> : '✓'}
                    </div>

                    {/* External link */}
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="shrink-0 w-6 p-0.5 hover:bg-slate-100 rounded mt-0.5">
                      <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                    </a>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-3 pt-3 border-t">
                <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>←</Button>
                <span className="text-sm self-center text-slate-600">{page} / {totalPages}</span>
                <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>→</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>}
    </div>
  );
}

export default function ArticleAnalyzer() {
  const [activeTab, setActiveTab] = useState<'analyze' | 'catalog' | 'ideas' | 'audit' | 'serp'>('catalog');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [savedPostId, setSavedPostId] = useState<number | null>(null);
  const [wpDialogOpen, setWpDialogOpen] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [prevHistoryId, setPrevHistoryId] = useState<number | null>(null);

  // Batch analysis state
  const batchQueueRef = useRef<string[]>([]);
  const isBatchingRef = useRef(false);
  const [isBatching, setIsBatching] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);

  const utils = trpc.useUtils();

  const { data: history = [], isLoading: historyLoading } = trpc.articles.getHistory.useQuery();
  const analyzedUrls = new Set(history.map(h => h.url));

  // Server-side batch (runs on server, browser tab can be closed)
  const { data: serverBatch } = trpc.articles.getBatchStatus.useQuery(undefined, {
    refetchInterval: (query) => query.state.data?.running ? 3000 : false,
  });
  const { mutate: startServerBatch } = trpc.articles.startBatchAnalysis.useMutation({
    onSuccess: (d) => {
      if (d.started) toast.success('Серверный анализ запущен: ' + d.total + ' статей. Можно закрыть вкладку.');
      else toast.info(d.message || 'Нечего анализировать');
      utils.articles.getBatchStatus.invalidate();
      utils.articles.getHistory.invalidate();
    },
    onError: (e) => toast.error(e?.message || 'Ошибка запуска'),
  });
  const { mutate: stopServerBatch } = trpc.articles.stopBatchAnalysis.useMutation({
    onSuccess: () => { toast.info('Серверный анализ остановлен'); utils.articles.getBatchStatus.invalidate(); },
  });

  const { mutate: analyze, isPending: isAnalyzing } = trpc.articles.analyzeUrl.useMutation({
    onSuccess: (data) => {
      setResult(data as AnalysisResult);
      setSavedPostId(null);
      utils.articles.getHistory.invalidate();
      if (isBatchingRef.current) {
        setBatchDone(d => d + 1);
        const queue = batchQueueRef.current;
        if (queue.length > 0) {
          batchQueueRef.current = queue.slice(1);
          analyze({ url: queue[0] });
        } else {
          isBatchingRef.current = false;
          setIsBatching(false);
          toast.success('Пакетный анализ завершён');
        }
      } else {
        toast.success('Анализ завершён');
      }
    },
    onError: (e: any) => {
      if (isBatchingRef.current) {
        // skip failed article, continue
        setBatchDone(d => d + 1);
        const queue = batchQueueRef.current;
        if (queue.length > 0) {
          batchQueueRef.current = queue.slice(1);
          analyze({ url: queue[0] });
        } else {
          isBatchingRef.current = false;
          setIsBatching(false);
          toast.success('Пакетный анализ завершён');
        }
      } else {
        toast.error(e?.message || 'Ошибка анализа');
      }
    },
  });

  const { data: historyDetail } = trpc.articles.getAnalysis.useQuery(
    { id: selectedHistoryId! },
    { enabled: selectedHistoryId !== null }
  );

  if (historyDetail && selectedHistoryId !== prevHistoryId) {
    setPrevHistoryId(selectedHistoryId);
    setResult(historyDetail as unknown as AnalysisResult);
    setSavedPostId(null);
  }

  const { mutate: deleteAnalysis } = trpc.articles.deleteAnalysis.useMutation({
    onSuccess: () => {
      utils.articles.getHistory.invalidate();
      toast.success('Удалено из истории');
    },
  });

  const { mutate: saveToLibrary, isPending: isSaving } = trpc.articles.saveToLibrary.useMutation({
    onSuccess: (data) => {
      setSavedPostId(data.postId ?? null);
      utils.content.listPosts.invalidate();
      toast.success('Сохранено в библиотеку');
    },
    onError: (e: any) => toast.error(e?.message || 'Ошибка сохранения'),
  });

  const handleAnalyze = (articleUrl?: string) => {
    const targetUrl = articleUrl || url;
    if (!targetUrl.trim()) { toast.error('Введите URL статьи'); return; }
    if (articleUrl) setUrl(articleUrl);
    setResult(null);
    setSelectedHistoryId(null);
    setPrevHistoryId(null);
    setActiveTab('analyze');
    analyze({ url: targetUrl.trim() });
  };

  const handleBatchAnalyze = (urls: string[]) => {
    if (urls.length === 0) return;
    batchQueueRef.current = urls.slice(1);
    setBatchTotal(urls.length);
    setBatchDone(0);
    isBatchingRef.current = true;
    setIsBatching(true);
    analyze({ url: urls[0] });
  };

  const stopBatch = () => {
    batchQueueRef.current = [];
    isBatchingRef.current = false;
    setIsBatching(false);
    toast.info('Пакетный анализ остановлен');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Анализ и улучшение статей</h1>
          <p className="text-slate-600">Сканируйте каталог или введите URL статьи — AI улучшит текст и даст SEO-рекомендации</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          {/* Main area */}
          <div>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="catalog">
                  <List className="w-4 h-4 mr-1.5" />Каталог
                </TabsTrigger>
                <TabsTrigger value="analyze">
                  <Search className="w-4 h-4 mr-1.5" />Анализ
                </TabsTrigger>
                <TabsTrigger value="serp">
                  <TrendingUp className="w-4 h-4 mr-1.5" />SERP
                </TabsTrigger>
                <TabsTrigger value="audit">
                  <ClipboardList className="w-4 h-4 mr-1.5" />Аудит
                </TabsTrigger>
                <TabsTrigger value="ideas">
                  <BookOpen className="w-4 h-4 mr-1.5" />Идеи
                </TabsTrigger>
              </TabsList>

              {/* Catalog tab */}
              <TabsContent value="catalog">
                <CatalogScanner
                  onAnalyze={handleAnalyze}
                  onBatchAnalyze={handleBatchAnalyze}
                  analyzedUrls={analyzedUrls}
                  isBatching={isBatching}
                  batchDone={batchDone}
                  batchTotal={batchTotal}
                  onStopBatch={stopBatch}
                  onServerBatch={(urls) => startServerBatch({ urls, skipAnalyzed: false })}
                  serverBatch={serverBatch}
                  onStopServerBatch={() => stopServerBatch()}
                />
              </TabsContent>

              {/* SERP tab */}
              <TabsContent value="serp">
                <SerpMonitor onAnalyze={(url) => { setUrl(url); setActiveTab('analyze'); }} />
              </TabsContent>

              {/* Ideas tab */}
              <TabsContent value="ideas">
                <ArticleIdeas onAnalyze={(title) => { setUrl(title); setActiveTab('analyze'); }} />
              </TabsContent>

              {/* Audit tab */}
              <TabsContent value="audit">
                <CatalogAudit
                  onAnalyze={(url) => { setUrl(url); setActiveTab('analyze'); }}
                  onBatchAnalyze={(urls) => { handleBatchAnalyze(urls); setActiveTab('analyze'); }}
                  history={history}
                  onServerBatch={(urls) => { startServerBatch({ urls, skipAnalyzed: false }); }}
                />
              </TabsContent>

              {/* Analyze tab */}
              <TabsContent value="analyze" className="space-y-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex gap-3">
                      <Input
                        placeholder="https://kadastrmap.info/kadastr/..."
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                        className="flex-1"
                      />
                      <Button onClick={() => handleAnalyze()} disabled={isAnalyzing} className="gap-2 min-w-[140px]">
                        {isAnalyzing ? (
                          <><Loader2 className="w-4 h-4 animate-spin" />Анализирую...</>
                        ) : (
                          <><Search className="w-4 h-4" />Анализировать</>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {isAnalyzing && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                      <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                      {isBatching ? (
                        <>
                          <p className="text-slate-600 font-medium">Пакетный анализ: {batchDone + 1} / {batchTotal}</p>
                          <div className="w-64">
                            <div className="w-full bg-slate-200 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${Math.round(((batchDone) / batchTotal) * 100)}%` }}
                              />
                            </div>
                          </div>
                          <Button size="sm" variant="outline" onClick={stopBatch} className="gap-1">
                            <Square className="w-3 h-3" />Остановить
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-slate-600">Загружаю статью, анализирую и улучшаю текст...</p>
                          <p className="text-sm text-slate-400">Обычно занимает 10–30 секунд</p>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                {result && !isAnalyzing && (
                  <AnalysisPanel
                    result={result}
                    isSaving={isSaving}
                    savedPostId={savedPostId}
                    onSave={(content) => saveToLibrary({ title: result.improvedTitle, content })}
                    onWpOpen={() => setWpDialogOpen(true)}
                    originalUrl={url}
                  />
                )}

                {!result && !isAnalyzing && (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
                      <Search className="w-10 h-10 text-slate-300" />
                      <p className="text-slate-500">Введите URL статьи или выберите из каталога</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* History sidebar */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-700 font-medium">
              <History className="w-4 h-4" />
              <span>История ({history.length})</span>
            </div>

            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : history.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-slate-400">История пуста</CardContent>
              </Card>
            ) : (
              <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                {history.map((item) => (
                  <Card
                    key={item.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${selectedHistoryId === item.id ? 'ring-2 ring-blue-500' : ''}`}
                    onClick={() => {
                      setSelectedHistoryId(item.id);
                      setUrl(item.url);
                      setActiveTab('analyze');
                    }}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-tight">{item.originalTitle}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <ScoreBadge score={item.seoScore} />
                            <span className="text-xs text-slate-400">{item.wordCount} сл.</span>
                            {item.googlePos != null && (
                              <span className={`text-xs font-medium ${item.googlePos <= 3 ? 'text-green-600' : item.googlePos <= 10 ? 'text-yellow-600' : 'text-red-500'}`}>
                                G#{item.googlePos}
                              </span>
                            )}
                            {item.yandexPos != null && (
                              <span className={`text-xs font-medium ${item.yandexPos <= 3 ? 'text-green-600' : item.yandexPos <= 10 ? 'text-yellow-600' : 'text-red-500'}`}>
                                Я#{item.yandexPos}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-1">
                            {new Date(item.createdAt).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 rounded hover:bg-slate-100">
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                          </a>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (confirm('Удалить?')) deleteAnalysis({ id: item.id }); }}
                            className="p-1 rounded hover:bg-red-50"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {savedPostId && (
        <PublishToWordPress
          open={wpDialogOpen}
          onOpenChange={setWpDialogOpen}
          postId={savedPostId}
          title={result?.improvedTitle || ''}
          content={result?.improvedContent || ''}
        />
      )}
    </div>
  );
}
