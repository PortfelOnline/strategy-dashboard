import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, Circle, Clock, ExternalLink, TrendingUp, FileText, Target, Image, List, HelpCircle, RefreshCw, Trophy } from 'lucide-react';
import { trpc } from '@/lib/trpc';

function posDelta(cur: number | null | undefined, prev: number | null | undefined): string | null {
  if (cur === undefined || prev === undefined) return null;
  if (cur === null || prev === null) return null;
  const d = prev - cur; // positive = moved up (better)
  if (d === 0) return null;
  return d > 0 ? `▲${d}` : `▼${Math.abs(d)}`;
}

function PosBadge({ pos, prev, engine }: { pos: number | null | undefined; prev?: number | null; engine: 'G' | 'Y' }) {
  if (pos === undefined) return null;
  const color = pos === null
    ? 'bg-slate-100 text-slate-400'
    : pos <= 3
      ? 'bg-green-100 text-green-700 border-green-200'
      : pos <= 10
        ? 'bg-yellow-100 text-yellow-700 border-yellow-200'
        : 'bg-red-100 text-red-600 border-red-200';
  const label = pos === null ? `${engine}>50` : `${engine}#${pos}`;
  const delta = posDelta(pos, prev);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded border ${color}`}>
      {pos !== null && pos <= 3 && <Trophy className="w-3 h-3" />}
      {label}
      {delta && (
        <span className={`text-xs font-sans ${delta.startsWith('▲') ? 'text-green-600' : 'text-red-500'}`}>
          {delta}
        </span>
      )}
    </span>
  );
}

function PosHistory({ history }: { history?: PosSnapshot[] }) {
  if (!history?.length) return null;
  const last7 = history.slice(-7);
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-xs text-slate-400 mr-0.5">История G:</span>
      {last7.map((s, i) => {
        const pos = s.googlePos;
        const color = pos === null
          ? 'bg-slate-300'
          : pos <= 3 ? 'bg-green-500'
          : pos <= 10 ? 'bg-yellow-400'
          : 'bg-red-400';
        const label = pos === null ? '>10' : `#${pos}`;
        return (
          <span
            key={i}
            title={`${s.date}: G${label}`}
            className={`w-2.5 h-2.5 rounded-full ${color} cursor-default`}
          />
        );
      })}
      <span className="text-xs text-slate-400 ml-1">{last7[last7.length - 1]?.date}</span>
    </div>
  );
}

function parseNotesBadges(notes: string) {
  const h2 = notes.match(/(\d+)\s*H2/i)?.[1];
  const h3 = notes.match(/(\d+)\s*H3/i)?.[1];
  const faq = notes.match(/(\d+)\s*FAQ/i)?.[1];
  const img = notes.match(/(\d+)\s*(?:\S+\s+)?(?:картинок|img|изображений)/i)?.[1];
  const intent = notes.match(/(транзакционный|информационный|BOFU|бинарный|срочный|проблемный|острая\s+проблема|залог|ипотека)[^,.]*/i)?.[0];
  return { h2, h3, faq, img, intent };
}
import DashboardLayout from '@/components/DashboardLayout';
import {
  KADMAP_ARTICLES,
  KADMAP_NEWS,
  type ArticleStatus,
  type ArticleProgress,
  type NewsProgress,
  type PosSnapshot,
  loadProgress,
  saveProgress,
  loadNewsProgress,
  saveNewsProgress,
  INITIAL_PROGRESS,
  getMapFlag,
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

// keys.so keyword → postId mapping
const KEYWORD_TO_POST_ID: Record<string, number> = {
  // Обременение
  'как проверить квартиру на обременение при покупке': 5535,
  'проверить квартиру на обременение онлайн': 4299,
  'как проверить квартиру на обременение': 4305,
  'проверить квартиру арест судебных приставов': 5607,
  'где проверить квартиру на обременение': 7129,
  'как узнать обременение на квартиру': 4302,
  'как узнать наложен ли арест на квартиру': 4308,
  'как узнать квартира в аресте или нет': 5522,
  'как узнать квартира в залоге или нет': 5558,
  'выписка егрп обременение': 5707,
  'выписка егрн обременение': 5707,
  'заказать справку об обременении': 332861,
  'справка об обременении недвижимости в москве': 332861,
  // Кадастровая карта
  'расположение по кадастровому номеру': 732,
  'кадастровая публичная карта со спутника': 1111,
  'кадастровый план квартиры по адресу': 8751,
  // Снять обременение / арест
  'как снять обременение после погашения ипотеки': 331661,
  'снять обременение с квартиры': 333041,
  'как снять обременение с ипотечной квартиры': 332987,
  'как снять арест с квартиры': 332787,
  // Собственник
  'как узнать владельца квартиры по адресу': 333052,
  'проверить собственника по кадастровому номеру': 332955,
  // Кадастровая стоимость
  'кадастровая стоимость недвижимости по адресу': 333008,
  'кадастровая стоимость по кадастровому номеру': 332921,
  // Выписка ЕГРН
  'заказать выписку из егрн онлайн': 332874,
  'заказать кадастровую выписку онлайн цена способы получения': 332874,
  'кадастровая выписка егрн что это': 333098,
  // Кадастровый номер
  'узнать сведения по кадастровому номеру': 333070,
  'как узнать сведения по кадастровому номеру егрн и карта': 333070,
  // Кадастровый паспорт
  'кадастровый паспорт на квартиру': 2162,
};

/**
 * Parse pasted Keys.so position table (browser copy-paste).
 * Returns { date, googlePositions } mapping postId → Google position.
 */
function parseKeysosTable(text: string, date: string): { updated: number; skipped: number } {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results: { postId: number; googlePos: number | null }[] = [];

  const NAV_SKIP = new Set([
    'на главную', 'результатов не найдено', 'избранное',
    'список запросов страниц', 'мониторинг позиций', 'мои проекты',
    'сайты', 'ссылки', 'запросы', 'база запросов', 'кластеризатор',
    'реклама', 'трекер ии', 'все отчёты и инструменты',
    'настройка боковой панели', 'позиции', 'сниппеты', 'регион',
    'яндекс', 'google', 'москва',
  ]);

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Check if any known keyword is in this line
    for (const [kw, postId] of Object.entries(KEYWORD_TO_POST_ID)) {
      if (lower.includes(kw)) {
        // Extract position tokens from the line
        const tokens = line.split(/\s+/).filter(Boolean);
        // Find 4 leading nulls (Yandex positions), then Google positions follow
        let nullCount = 0;
        let gStart = -1;
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i] === '—') { nullCount++; if (nullCount === 4) { gStart = i + 1; break; } }
          else if (!isNaN(parseInt(tokens[i], 10))) break; // hit numbers before 4 nulls
        }
        let googlePos: number | null = null;
        if (gStart >= 0 && gStart < tokens.length) {
          const t = tokens[gStart];
          googlePos = t === '—' ? null : parseInt(t, 10) || null;
        }
        results.push({ postId, googlePos });
        break;
      }
    }
  }

  if (results.length === 0) return { updated: 0, skipped: 0 };

  // Apply to progress (called by the handler)
  return { updated: results.length, skipped: 0 };
}

function applyKeysosTable(
  text: string,
  date: string,
  progress: Record<number, ArticleProgress>,
  updateArticle: (id: number, update: Partial<ArticleProgress>) => void,
): string {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let updated = 0;

  for (const [kw, postId] of Object.entries(KEYWORD_TO_POST_ID)) {
    const kwLower = kw.toLowerCase();
    const matchLine = lines.find(l => l.toLowerCase().includes(kwLower));
    if (!matchLine) continue;

    const tokens = matchLine.split(/\s+/).filter(Boolean);
    let nullCount = 0;
    let gStart = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '—') {
        nullCount++;
        if (nullCount === 4) { gStart = i + 1; break; }
      } else if (!isNaN(parseInt(tokens[i], 10)) && nullCount < 4) {
        // Yandex has actual position — find after 4 Yandex entries
        break;
      }
    }

    let googlePos: number | null = null;
    if (gStart >= 0 && gStart < tokens.length) {
      const t = tokens[gStart];
      googlePos = t === '—' ? null : (parseInt(t, 10) || null);
    }

    const cur = progress[postId];
    const snapshot: PosSnapshot = { date, googlePos, yandexPos: cur?.yandexPos ?? null };
    const history = [...(cur?.posHistory ?? [])];
    const idx = history.findLastIndex(h => h.date === date);
    if (idx >= 0) history[idx] = snapshot; else history.push(snapshot);

    updateArticle(postId, {
      prevGooglePos: cur?.googlePos,
      googlePos,
      posCheckedAt: date + 'T00:00:00.000Z',
      posHistory: history,
    });
    updated++;
  }

  return `Импортировано Google позиций: ${updated} статей (${date})`;
}

function parseKeysosCsv(text: string): { date: string; positions: Record<number, number | null> } | null {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 5) return null;
  // Row 4 (index 3) is the column header: "запросы;w;"!w";"[!w]";URL;2026-03-25"
  const headerCols = lines[3].split(';');
  const date = headerCols[5]?.replace(/"/g, '').trim() || new Date().toISOString().slice(0, 10);
  const positions: Record<number, number | null> = {};
  for (let i = 4; i < lines.length; i++) {
    const cols = lines[i].split(';');
    const keyword = cols[0]?.replace(/^"|"$/g, '').trim().toLowerCase();
    const posRaw = cols[5]?.replace(/"/g, '').trim();
    if (!keyword || !posRaw) continue;
    const postId = KEYWORD_TO_POST_ID[keyword];
    if (!postId) continue;
    positions[postId] = posRaw === '--' || posRaw === '' ? null : parseInt(posRaw, 10) || null;
  }
  return { date, positions };
}

export default function SeoTracker() {
  const [progress, setProgress] = useState<Record<number, ArticleProgress>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ArticleProgress>({ status: 'todo' });
  const [checkingId, setCheckingId] = useState<number | null>(null);
  const [autoChecking, setAutoChecking] = useState(false);
  const [newsProgress, setNewsProgress] = useState<Record<number, NewsProgress>>({});
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showTableImport, setShowTableImport] = useState(false);
  const [tableText, setTableText] = useState('');
  const csvInputRef = useRef<HTMLInputElement>(null);
  const checkPosMutation = trpc.articles.checkPosition.useMutation();

  const today = new Date().toISOString().slice(0, 10);

  const checkPosition = useCallback(async (postId: number, keyword: string, silent = false) => {
    if (!silent) setCheckingId(postId);
    try {
      const cur = progress[postId];
      const data = await checkPosMutation.mutateAsync({ keyword });
      const snapshot: PosSnapshot = {
        date: today,
        googlePos: data.googlePos ?? null,
        yandexPos: data.yandexPos ?? null,
      };
      const history = [...(cur?.posHistory ?? [])];
      // Append today's snapshot (replace if already checked today)
      const lastIdx = history.findLastIndex(h => h.date === today);
      if (lastIdx >= 0) history[lastIdx] = snapshot; else history.push(snapshot);

      updateArticle(postId, {
        prevGooglePos: cur?.googlePos,
        prevYandexPos: cur?.yandexPos,
        googlePos: data.googlePos,
        yandexPos: data.yandexPos,
        posCheckedAt: new Date().toISOString(),
        posHistory: history,
        top3Google: data.topCompetitors?.slice(0, 3).map((c, i) => ({
          pos: i + 1,
          domain: c.domain,
          title: c.title,
        })),
        top3Yandex: [],
      });
    } catch (e) {
      console.error('[checkPosition]', e);
    } finally {
      if (!silent) setCheckingId(null);
    }
  }, [progress, checkPosMutation, today]);

  // Load from localStorage on mount, seed initial if empty
  useEffect(() => {
    const stored = loadProgress();
    const merged = { ...INITIAL_PROGRESS, ...stored };
    setProgress(merged);
    if (!localStorage.getItem('kadmap_article_progress')) {
      saveProgress(merged);
    }
    setNewsProgress(loadNewsProgress());
  }, []);

  // Auto-check: run once after progress loads, for all articles not yet checked today
  useEffect(() => {
    if (autoChecking) return;
    const articlesNeedCheck = KADMAP_ARTICLES.filter(a => {
      if (!a.keyword) return false;
      const p = progress[a.postId];
      return !p?.posCheckedAt || p.posCheckedAt.slice(0, 10) !== today;
    });
    const newsNeedCheck = KADMAP_NEWS.filter(n => {
      if (!n.keyword) return false;
      const p = newsProgress[n.postId];
      return !p?.posCheckedAt || p.posCheckedAt.slice(0, 10) !== today;
    });
    const all = [
      ...articlesNeedCheck.map(a => ({ id: a.postId, kw: a.keyword!, type: 'article' as const })),
      ...newsNeedCheck.map(n => ({ id: n.postId, kw: n.keyword!, type: 'news' as const })),
    ];
    if (all.length === 0) return;

    setAutoChecking(true);
    let cancelled = false;
    (async () => {
      for (const item of all) {
        if (cancelled) break;
        if (item.type === 'article') await checkPosition(item.id, item.kw, true);
        else await checkNewsPosition(item.id, item.kw, true);
        await new Promise(r => setTimeout(r, 3000)); // 3s between requests
      }
      if (!cancelled) setAutoChecking(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(progress).length > 0, Object.keys(newsProgress).length >= 0]);

  function updateArticle(postId: number, update: Partial<ArticleProgress>) {
    setProgress(prev => {
      const next = { ...prev, [postId]: { ...(prev[postId] ?? { status: 'todo' as ArticleStatus }), ...update } };
      saveProgress(next);
      return next;
    });
  }

  function cycleStatus(postId: number) {
    const cur = progress[postId]?.status ?? 'todo';
    const next: ArticleStatus = cur === 'todo' ? 'in_progress' : cur === 'in_progress' ? 'done' : 'todo';
    const extra = next === 'done' ? { doneAt: new Date().toISOString().split('T')[0] } : {};
    updateArticle(postId, { status: next, ...extra });
  }

  function updateNews(postId: number, update: Partial<NewsProgress>) {
    setNewsProgress(prev => {
      const next = { ...prev, [postId]: { ...(prev[postId] ?? {}), ...update } };
      saveNewsProgress(next);
      return next;
    });
  }

  const checkNewsPosition = useCallback(async (postId: number, keyword: string, silent = false) => {
    if (!silent) setCheckingId(postId);
    try {
      const cur = newsProgress[postId];
      const data = await checkPosMutation.mutateAsync({ keyword });
      const snapshot: PosSnapshot = {
        date: today,
        googlePos: data.googlePos ?? null,
        yandexPos: data.yandexPos ?? null,
      };
      const history = [...(cur?.posHistory ?? [])];
      const lastIdx = history.findLastIndex(h => h.date === today);
      if (lastIdx >= 0) history[lastIdx] = snapshot; else history.push(snapshot);

      updateNews(postId, {
        prevGooglePos: cur?.googlePos,
        prevYandexPos: cur?.yandexPos,
        googlePos: data.googlePos,
        yandexPos: data.yandexPos,
        posCheckedAt: new Date().toISOString(),
        posHistory: history,
        top3Google: data.topCompetitors?.slice(0, 3).map((c, i) => ({ pos: i + 1, domain: c.domain, title: c.title })),
      });
    } catch (e) {
      console.error('[checkNewsPosition]', e);
    } finally {
      if (!silent) setCheckingId(null);
    }
  }, [newsProgress, checkPosMutation, today]);

  function handleCsvImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseKeysosCsv(text);
      if (!result) { setImportMsg('Ошибка: не удалось распарсить CSV'); return; }
      const { date, positions } = result;
      let updated = 0;
      setProgress(prev => {
        const next = { ...prev };
        for (const [postIdStr, newPos] of Object.entries(positions)) {
          const postId = Number(postIdStr);
          const cur = next[postId] ?? { status: 'todo' as ArticleStatus };
          next[postId] = {
            ...cur,
            prevYandexPos: cur.yandexPos,
            yandexPos: newPos,
            posCheckedAt: date + 'T00:00:00.000Z',
          };
          updated++;
        }
        saveProgress(next);
        return next;
      });
      setImportMsg(`Импортировано: ${updated} статей из keys.so (${date})`);
      setTimeout(() => setImportMsg(null), 5000);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
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
            <p className="text-sm text-slate-500">
              Отслеживание улучшения статей до эталонного стандарта
              {autoChecking && (
                <span className="ml-2 inline-flex items-center gap-1 text-blue-500">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  авто-проверка позиций...
                </span>
              )}
            </p>
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
              <div className="ml-auto flex items-center gap-2">
                {importMsg && (
                  <span className="text-xs text-green-600 font-normal">{importMsg}</span>
                )}
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleCsvImport}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2"
                  onClick={() => setShowTableImport(v => !v)}
                >
                  ↑ Keys.so таблица
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 px-2"
                  onClick={() => csvInputRef.current?.click()}
                >
                  ↑ keys.so CSV
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          {showTableImport && (
            <div className="px-4 pb-4 border-t space-y-2">
              <p className="text-xs text-slate-500 pt-3">
                Вставьте таблицу позиций из Keys.so (скопируйте страницу целиком). Дата берётся из таблицы автоматически.
              </p>
              <Textarea
                value={tableText}
                onChange={e => setTableText(e.target.value)}
                placeholder="Вставьте сюда таблицу из Keys.so..."
                className="text-xs font-mono h-28 resize-none"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => {
                    const date = tableText.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1]
                      ?.split('.').reverse().join('-') ?? today;
                    const msg = applyKeysosTable(tableText, date, progress, updateArticle);
                    setImportMsg(msg);
                    setShowTableImport(false);
                    setTableText('');
                    setTimeout(() => setImportMsg(null), 6000);
                  }}
                  disabled={!tableText.trim()}
                >
                  Импортировать Google позиции
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setShowTableImport(false); setTableText(''); }}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
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
                          {/* Map block indicator */}
                          {(() => {
                            const hasMap = article.needsMap ?? getMapFlag(article.slug);
                            return (
                              <span className={`text-xs px-1.5 py-0.5 rounded border font-mono ${hasMap ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
                                title={hasMap ? 'outmap=1: блок карты показан' : 'outmap=0: блок карты скрыт'}>
                                🗺 {hasMap ? 'on' : 'off'}
                              </span>
                            );
                          })()}
                        </div>

                        <p className={`text-sm font-medium ${p.status === 'done' ? 'line-through text-slate-400' : ''}`}>
                          {article.title}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{article.reason}</p>

                        {/* Metrics row */}
                        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                          {article.wordstatW !== undefined && article.wordstatW > 0 && (
                            <span title="Яндекс Wordstat базовая / точная частотность">
                              📊 <strong>{article.wordstatW.toLocaleString('ru-RU')}</strong>
                              {article.wordstatExact !== undefined && article.wordstatExact > 0 && (
                                <span className="text-slate-400"> / {article.wordstatExact}</span>
                              )}
                            </span>
                          )}
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

                        {p.notes && p.status === 'done' && (() => {
                          const { h2, h3, faq, img, intent } = parseNotesBadges(p.notes!);
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {h2 && (
                                <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">
                                  <List className="w-3 h-3" />{h2} H2
                                </span>
                              )}
                              {h3 && (
                                <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 rounded px-1.5 py-0.5">
                                  {h3} H3
                                </span>
                              )}
                              {faq && (
                                <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
                                  <HelpCircle className="w-3 h-3" />{faq} FAQ
                                </span>
                              )}
                              {img && (
                                <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                                  <Image className="w-3 h-3" />{img} img
                                </span>
                              )}
                              {intent && (
                                <span className="inline-flex items-center text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded px-1.5 py-0.5">
                                  {intent.trim()}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {p.notes && (
                          <p className="text-xs text-slate-400 mt-1 italic">{p.notes}</p>
                        )}

                        {/* Position row */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <PosBadge pos={p.googlePos} prev={p.prevGooglePos} engine="G" />
                          <PosBadge pos={p.yandexPos} prev={p.prevYandexPos} engine="Y" />
                          {p.posCheckedAt && (
                            <span className="text-xs text-slate-400">
                              проверено {p.posCheckedAt.slice(0, 10)}
                            </span>
                          )}
                          {article.keyword && (
                            <button
                              onClick={() => checkPosition(article.postId, article.keyword!)}
                              disabled={checkingId === article.postId}
                              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3 h-3 ${checkingId === article.postId ? 'animate-spin' : ''}`} />
                              {checkingId === article.postId ? 'Проверяю...' : 'Позиции'}
                            </button>
                          )}
                        </div>

                        <PosHistory history={p.posHistory} />

                        {/* Top-3 competitors */}
                        {(p.top3Google?.length || p.top3Yandex?.length) && (
                          <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                            {p.top3Google?.slice(0, 3).map((r, i) => (
                              <div key={i} className="truncate">
                                <span className="text-slate-400">G#{r.pos}</span> {r.domain}
                                {r.domain === 'kadastrmap.info' && <span className="ml-1 text-green-600 font-medium">← МЫ</span>}
                              </div>
                            ))}
                          </div>
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

        {/* News section */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4 text-orange-500" />
              Новости
              <span className="text-xs font-normal text-slate-500 ml-1">конверсия трафика → услуги</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {KADMAP_NEWS.map((news) => {
                const np = newsProgress[news.postId] ?? {};
                return (
                  <div key={news.postId} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-xs text-slate-400">#{news.postId}</span>
                          <span className="text-xs text-slate-400">{news.publishedAt}</span>
                          {news.images && (
                            <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                              <Image className="w-3 h-3" />{news.images} img
                            </span>
                          )}
                          <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5">
                            BLOCK_PRICE ✓
                          </span>
                          <span className="text-xs bg-violet-50 text-violet-600 border border-violet-200 rounded px-1.5 py-0.5">
                            Читайте также ✓
                          </span>
                        </div>
                        <p className="text-sm font-medium">{news.title}</p>
                        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                          <a
                            href={`https://kadastrmap.info/novosti/${news.slug}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            открыть
                          </a>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <PosBadge pos={np.googlePos} prev={np.prevGooglePos} engine="G" />
                          <PosBadge pos={np.yandexPos} prev={np.prevYandexPos} engine="Y" />
                          {np.posCheckedAt && (
                            <span className="text-xs text-slate-400">проверено {np.posCheckedAt.slice(0, 10)}</span>
                          )}
                          {news.keyword && (
                            <button
                              onClick={() => checkNewsPosition(news.postId, news.keyword!)}
                              disabled={checkingId === news.postId}
                              className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 disabled:opacity-50"
                            >
                              <RefreshCw className={`w-3 h-3 ${checkingId === news.postId ? 'animate-spin' : ''}`} />
                              {checkingId === news.postId ? 'Проверяю...' : 'Позиции'}
                            </button>
                          )}
                        </div>
                        <PosHistory history={np.posHistory} />

                        {np.top3Google?.length && (
                          <div className="mt-2 text-xs text-slate-500 space-y-0.5">
                            {np.top3Google.slice(0, 3).map((r, i) => (
                              <div key={i} className="truncate">
                                <span className="text-slate-400">G#{r.pos}</span> {r.domain}
                                {r.domain === 'kadastrmap.info' && <span className="ml-1 text-green-600 font-medium">← МЫ</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
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
                <strong>Цель: 1–3 место в Гугл / Яндекс</strong>
                <br />
                <span className="font-medium">Эталон:</span> ~3500 слов · 15+ H2 · 5 H3 · 10+ FAQ · 9 картинок (width/height) · [PRICE_3_DISC] · 9+ CTA на /spravki/ · Блок отзывов · Метадеск ≤160 символов
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
