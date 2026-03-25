import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Circle, Clock, ExternalLink, TrendingUp, FileText, Target } from 'lucide-react';
import DashboardLayout from '@/components/DashboardLayout';
import {
  KADMAP_ARTICLES,
  type ArticleStatus,
  type ArticleProgress,
  loadProgress,
  saveProgress,
  INITIAL_PROGRESS,
} from '@/data/kadmapArticles';

const STATUS_CONFIG: Record<ArticleStatus, { label: string; icon: typeof Circle; className: string }> = {
  todo:        { label: 'TODO',        icon: Circle,        className: 'bg-slate-100 text-slate-600 border-slate-200' },
  in_progress: { label: 'В работе',   icon: Clock,         className: 'bg-blue-100 text-blue-700 border-blue-200' },
  done:        { label: 'Готово',      icon: CheckCircle2,  className: 'bg-green-100 text-green-700 border-green-200' },
};

const PRIORITY_CONFIG = {
  high:   { label: 'Высокий', className: 'bg-red-100 text-red-700' },
  medium: { label: 'Средний', className: 'bg-yellow-100 text-yellow-700' },
  low:    { label: 'Низкий',  className: 'bg-slate-100 text-slate-500' },
};

export default function SeoTracker() {
  const [progress, setProgress] = useState<Record<number, ArticleProgress>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ArticleProgress>({ status: 'todo' });

  // Load from localStorage on mount, seed initial if empty
  useEffect(() => {
    const stored = loadProgress();
    const merged = { ...INITIAL_PROGRESS, ...stored };
    setProgress(merged);
    // Only save initial if nothing was stored yet
    if (!localStorage.getItem('kadmap_article_progress')) {
      saveProgress(merged);
    }
  }, []);

  function updateArticle(postId: number, update: Partial<ArticleProgress>) {
    const next = {
      ...progress,
      [postId]: { ...(progress[postId] ?? { status: 'todo' }), ...update },
    };
    setProgress(next);
    saveProgress(next);
  }

  function cycleStatus(postId: number) {
    const cur = progress[postId]?.status ?? 'todo';
    const next: ArticleStatus = cur === 'todo' ? 'in_progress' : cur === 'in_progress' ? 'done' : 'todo';
    const extra = next === 'done' ? { doneAt: new Date().toISOString().split('T')[0] } : {};
    updateArticle(postId, { status: next, ...extra });
  }

  function openEdit(postId: number) {
    setEditDraft(progress[postId] ?? { status: 'todo' });
    setEditingId(postId);
  }

  function saveEdit() {
    if (editingId !== null) {
      updateArticle(editingId, editDraft);
      setEditingId(null);
    }
  }

  // Stats
  const done = KADMAP_ARTICLES.filter(a => (progress[a.postId]?.status ?? 'todo') === 'done').length;
  const inProgress = KADMAP_ARTICLES.filter(a => (progress[a.postId]?.status ?? 'todo') === 'in_progress').length;
  const todo = KADMAP_ARTICLES.length - done - inProgress;
  const totalWordsBefore = KADMAP_ARTICLES.reduce((s, a) => s + (a.wordsBefore ?? 0), 0);
  const totalWordsAfter = KADMAP_ARTICLES.reduce((s, a) => s + (progress[a.postId]?.wordsAfter ?? 0), 0);

  const editingArticle = editingId !== null ? KADMAP_ARTICLES.find(a => a.postId === editingId) : null;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold">SEO Tracker — kadastrmap.info</h1>
            <p className="text-sm text-slate-500">Отслеживание улучшения статей до эталонного стандарта</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-green-600">{done}</div>
              <div className="text-xs text-slate-500 mt-0.5">Готово</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-blue-600">{inProgress}</div>
              <div className="text-xs text-slate-500 mt-0.5">В работе</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-slate-500">{todo}</div>
              <div className="text-xs text-slate-500 mt-0.5">Осталось</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="text-2xl font-bold text-violet-600">
                {totalWordsAfter > 0 ? `+${(totalWordsAfter - totalWordsBefore).toLocaleString()}` : '—'}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">Слов добавлено</div>
            </CardContent>
          </Card>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Прогресс</span>
            <span>{done} / {KADMAP_ARTICLES.length}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${(done / KADMAP_ARTICLES.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Articles table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Статьи
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {KADMAP_ARTICLES.map((article) => {
                const p = progress[article.postId] ?? { status: 'todo' as ArticleStatus };
                const sc = STATUS_CONFIG[p.status];
                const pc = PRIORITY_CONFIG[article.priority];
                const StatusIcon = sc.icon;

                return (
                  <div key={article.postId} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      {/* Status toggle */}
                      <button
                        onClick={() => cycleStatus(article.postId)}
                        className="mt-0.5 shrink-0 hover:scale-110 transition-transform"
                        title="Нажмите для смены статуса"
                      >
                        <StatusIcon className={`w-5 h-5 ${p.status === 'done' ? 'text-green-600' : p.status === 'in_progress' ? 'text-blue-500' : 'text-slate-300'}`} />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${sc.className}`}>
                            {sc.label}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${pc.className}`}>
                            {pc.label}
                          </span>
                          {article.postId > 0 && (
                            <span className="text-xs text-slate-400">#{article.postId}</span>
                          )}
                        </div>

                        <p className={`text-sm font-medium ${p.status === 'done' ? 'line-through text-slate-400' : ''}`}>
                          {article.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{article.reason}</p>

                        {/* Metrics row */}
                        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                          {article.wordsBefore && (
                            <span>До: <strong>{article.wordsBefore}</strong> слов</span>
                          )}
                          {p.wordsAfter && (
                            <span className="text-green-600">
                              После: <strong>{p.wordsAfter}</strong> слов
                              {article.wordsBefore && (
                                <span className="ml-1 font-normal text-green-500">
                                  (+{Math.round((p.wordsAfter / article.wordsBefore - 1) * 100)}%)
                                </span>
                              )}
                            </span>
                          )}
                          {p.doneAt && (
                            <span className="text-slate-400">✓ {p.doneAt}</span>
                          )}
                          {article.slug && (
                            <a
                              href={`https://kadastrmap.info/kadastr/${article.slug}/`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" />
                              kadastrmap.info
                            </a>
                          )}
                        </div>

                        {p.notes && (
                          <p className="text-xs text-slate-400 mt-1 italic">{p.notes}</p>
                        )}
                      </div>

                      {/* Edit button */}
                      <button
                        onClick={() => openEdit(article.postId)}
                        className="shrink-0 text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100"
                      >
                        ✏️
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Etalon standard reminder */}
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-sm text-blue-800">
                <strong>Эталон: </strong>
                ~3500 слов · 15+ H2 · 5 H3 · 10+ FAQ · 9 картинок (width/height) · [PRICE_3_DISC] · 9+ CTA на /spravki/ · Блок отзывов · Метадеск ≤160 символов
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit modal */}
      {editingId !== null && editingArticle && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-base">Редактировать: {editingArticle.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Статус</label>
                <div className="flex gap-2">
                  {(['todo', 'in_progress', 'done'] as ArticleStatus[]).map(s => (
                    <button
                      key={s}
                      onClick={() => setEditDraft(d => ({ ...d, status: s }))}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        editDraft.status === s
                          ? STATUS_CONFIG[s].className + ' border-current'
                          : 'bg-white text-slate-500 border-slate-200'
                      }`}
                    >
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Слов после улучшения</label>
                <Input
                  type="number"
                  value={editDraft.wordsAfter ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, wordsAfter: +e.target.value || undefined }))}
                  placeholder="напр. 3440"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Дата (YYYY-MM-DD)</label>
                <Input
                  value={editDraft.doneAt ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, doneAt: e.target.value || undefined }))}
                  placeholder="2026-03-25"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Заметки</label>
                <Textarea
                  value={editDraft.notes ?? ''}
                  onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value || undefined }))}
                  placeholder="Что было сделано..."
                  rows={2}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={saveEdit} size="sm" className="flex-1">Сохранить</Button>
                <Button onClick={() => setEditingId(null)} size="sm" variant="outline" className="flex-1">Отмена</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </DashboardLayout>
  );
}
