import * as fs from 'fs';
import * as path from 'path';
import { scanCatalog } from './_core/articleParser';
import * as articlesDb from './articles.db';
import { getAvgNewArticleImageCount } from './_core/imageStats';
import { alertPublishFailure } from './_core/alert';

export interface ArticleSchedulerConfig {
  enabled: boolean;
  catalogUrl: string;
  articlesPerNight: number;
  hour: number;          // 0–23, local server time
  userId: number;
  skipImprovedDays: number; // skip articles improved within N days
  newsShare: number;        // доля новостей от articlesPerNight (0.2 = 4 новости при 20 статьях)
  evergreenPerNight?: number; // новых evergreen /kadastr/ страниц за ночь (keyword-gap)
}

const DEFAULT_CONFIG: ArticleSchedulerConfig = {
  enabled: false,
  catalogUrl: 'https://kadastrmap.info/kadastr/',
  articlesPerNight: 20,
  hour: 2,
  userId: 1,
  skipImprovedDays: 30,
  newsShare: 0.2,
  evergreenPerNight: 3,
};

const CONFIG_FILE  = path.join(process.cwd(), 'article-scheduler.json');
const LASTRUN_FILE = path.join(process.cwd(), 'article-scheduler-lastrun.json');
const TICK_MS = 10 * 60 * 1000; // check every 10 min
const STUB_SWEEP_MS = 30 * 60 * 1000; // как часто искать застрявшие заглушки
let lastStubSweep = 0;

let tickTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Merge measured candidates with the existing safe queue. The feedback loop
 * must never stop a nightly batch when GSC is unavailable, and never expands
 * an automated batch beyond three URLs.
 */
export function selectPositionFeedbackBatch(rankedUrls: string[], fallbackUrls: string[]): { urls: string[]; usedFallback: boolean } {
  const urls: string[] = [];
  for (const url of [...rankedUrls, ...fallbackUrls]) {
    if (!url || url.includes('/reestr/') || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length === 3) break;
  }
  return { urls, usedFallback: rankedUrls.length === 0 };
}

export function getSchedulerConfig(): ArticleSchedulerConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

// Мерж поверх текущего: UI шлёт не все поля (newsShare / evergreenPerNight в форме нет),
// полная перезапись молча сбрасывала их в дефолт.
export function saveSchedulerConfig(config: Partial<ArticleSchedulerConfig>): void {
  const merged: ArticleSchedulerConfig = { ...getSchedulerConfig(), ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

function getLastRunDate(): string | null {
  try {
    if (fs.existsSync(LASTRUN_FILE)) {
      return JSON.parse(fs.readFileSync(LASTRUN_FILE, 'utf8')).date ?? null;
    }
  } catch {}
  return null;
}

function setLastRunDate(): void {
  fs.writeFileSync(LASTRUN_FILE, JSON.stringify({ date: todayStr() }));
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextRunIso(config: ArticleSchedulerConfig): string | null {
  if (!config.enabled) return null;
  const d = new Date();
  d.setHours(config.hour, 0, 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// Денежные страницы: ведут на платные услуги /spravki/ (выписки, справки, проверки
// документов и договоров). Остальное — информационный трафик.
// "prover" вместо "proverk" — ловит и "proverka", и "proverit" (08.09.2026: слаг
// .../kadastrovyj-nomer-obekta-nedvizhimosti-proverit-po-adresu/ не совпадал).
const MONEY_SLUG_RE = /egrn|vypisk|spravk|zakaz|stoimost|tsen[ay]|prover|obremen|dogovor|srochno|onlajn|uslug|poshlin|kupl|prodazh/i;

// Машинный статус последнего батча — источник правды для проверок вместо docker logs.
const BATCH_STATUS_FILE = path.join(process.cwd(), 'data', 'last-batch.json');
function writeBatchStatus(status: Record<string, unknown>): void {
  fs.writeFileSync(BATCH_STATUS_FILE, JSON.stringify(status, null, 1));
}

/**
 * Сколько картинок нужно новой статье — для планирования, сколько статей потянет
 * дневная квота Flow. Раньше была статичная догадка 20, а реальная цель генерации
 * (avgCompetitorImages+2 в routers/articles.ts) по аудиту нередко 23+ — оценка
 * систематически занижала расход. Теперь берём скользящее среднее по последним
 * реально опубликованным новым статьям (imageStats.ts), с фолбэком на env/20,
 * пока данных недостаточно.
 */
function imagesPerNewArticle(): number {
  const fallback = Number(process.env.FLOW_IMAGES_PER_ARTICLE ?? 20);
  return getAvgNewArticleImageCount(fallback);
}

/**
 * Сколько картинок наш проект ещё может взять сегодня.
 * `null` — мост не ответил или не отдал квоту: тогда НЕ ограничиваем, чтобы недоступность
 * моста не останавливала выпуск статей сама по себе.
 */
async function flowQuotaRoom(): Promise<number | null> {
  const flowUrl = process.env.FLOW_IMG_URL ?? 'http://viralcraft:3100';
  const project = process.env.FLOW_PROJECT || '100zem';
  try {
    const r = await fetch(`${flowUrl}/health`, { signal: AbortSignal.timeout(5000) });
    const h: any = await r.json();
    // 🚨 22.08.2026: сперва НАСТОЯЩИЙ лимит. Проверено прямым запросом: мост отдавал
    // 429 daily-limit, а quota.used показывал 0 из 240 — планирование по used пропустило
    // бы 12 статей в заведомый провал. used считает только успешные генерации за
    // тихоокеанские сутки, а лимит держит сам Flow, и это разные вещи.
    if (h?.dailyLimit === true) return 0;
    const q = h?.quota;
    if (!q || typeof q.total !== 'number') return null;
    // Гарантия — наша доля, общий остаток — жёсткий потолок. Берём меньшее.
    const mine = Math.max(0, Number(q.guarantees?.[project] ?? 0) - Number(q.used?.[project] ?? 0));
    const shared = Math.max(0, Number(q.total ?? 0) - Number(q.usedTotal ?? 0));
    return Math.min(mine, shared);
  } catch {
    return null;
  }
}

export async function runScheduledBatch(config: ArticleSchedulerConfig): Promise<void> {
  if (running) return;
  running = true;

  // Конвейер идёт круглосуточно, поэтому прод (kad) и остальные сервисы на этой машине
  // важнее. 🚨 21.08.2026: настоящий ограничитель — НЕ этот вызов, а cgroup контейнера
  // (docker-compose: cpu_shares 256 → cpu.weight 35 против 100 у kad; cpus 2 из 8;
  // blkio weight 100 → io.weight 910; mem 3g). Проверено на живом.
  // setPriority внутри контейнера, ограниченного двумя ядрами, почти ничего не даёт:
  // процесс там конкурирует сам с собой, а без CAP_SYS_NICE вызов всё равно падает
  // с EACCES. Поэтому неудача здесь — ожидаемая норма. Прежний console.warn читался как
  // «конвейер жрёт прод наравне» и однажды увёл разбор нагрузки не туда.
  // Успешный путь оставлен: вне контейнера (ручной запуск скриптов) вызов срабатывает.
  try {
    const nice = Number(process.env.ARTICLES_NICE ?? 10);
    (await import('os')).setPriority(0, nice);
    console.log(`[ArticleScheduler] приоритет процесса понижен до ${nice}`);
  } catch {
    // ожидаемо без CAP_SYS_NICE — ограничение держит cgroup, см. комментарий выше
  }
  console.log('[ArticleScheduler] Ночной батч запущен');

  try {
    // Startup-race fix: дождаться готовности Flow (Nano Banana), чтобы ВСЕ картинки шли
    // через мост, а не в фолбэк (Chrome в viralcraft поднимается дольше, чем стартует батч).
    {
      const flowUrl = process.env.FLOW_IMG_URL ?? 'http://viralcraft:3100';
      for (let i = 0; i < 60; i++) {
        try {
          const r = await fetch(`${flowUrl}/health`, { signal: AbortSignal.timeout(5000) });
          const h: any = await r.json();
          // 🚨 02.08.2026: ждали именно chromeReady, а Chrome в viralcraft поднимается
          // ТОЛЬКО по требованию (аренда берётся при первой картинке). Поэтому условие
          // не выполнялось никогда и каждый батч платил 10 минут простоя впустую.
          // Достаточно, чтобы мост отвечал и Flow не был выключен — Chrome стартует сам.
          if ((h?.ok === true || h?.status === 'ok') && h?.flowDisabled !== true) {
            console.log(`[ArticleScheduler] Flow отвечает (credits=${h.credits}, chromeReady=${!!h.chromeReady}) — стартуем`);
            break;
          }
          console.log(`[ArticleScheduler] Flow выключен или не готов, жду… (${i})`);
        } catch {
          console.log(`[ArticleScheduler] Flow /health недоступен, жду… (${i})`);
        }
        await new Promise((res) => setTimeout(res, 10_000));
      }
    }

    // Dynamic import to avoid potential module init order issues
    // 🚨 13.08.2026: evergreen идёт первым. Замер дал 16 минут медианы на статью,
    // то есть порция из 40 улучшений тянется около 11 часов — стоя в конце, новые
    // страницы появлялись раз в полсуток, а при рестарте конвейера не появлялись
    // вовсе (за 13.08 их было ноль). Рост охвата не должен ждать очередь починки.
    let evergreenFilled = 0;
    let evergreenCount = Math.max(0, config.evergreenPerNight ?? 0);
    // 🚨 22.08.2026: заводили больше статей, чем квота картинок способна наполнить —
    // за сутки 10 черновиков, все из-за исчерпанной квоты, и для каждого впустую
    // написан текст. Спрашиваем остаток у моста и заводим ровно столько, сколько он
    // вытянет. Не хватает даже на одну — проход не простаивает: вся ёмкость уходит
    // на улучшение существующих статей, которому квота не нужна (картинки берутся
    // из медиатеки по слагу).
    if (evergreenCount > 0) {
      const room = await flowQuotaRoom();
      if (room === null) {
        console.log('[Evergreen] остаток квоты Flow неизвестен — не ограничиваю');
      } else {
        const imagesPerArticle = imagesPerNewArticle();
        const affordable = Math.floor(room / imagesPerArticle);
        if (affordable < evergreenCount) {
          console.log(
            `[Evergreen] квота Flow: остаток ${room} картинок при ${imagesPerArticle} на статью ` +
            `→ хватит на ${affordable}, планировали ${evergreenCount}` +
            (affordable === 0 ? ' — новые не завожу, весь проход на улучшения' : ''),
          );
          evergreenCount = affordable;
        }
      }
    }
    if (evergreenCount > 0) {
      try {
        const { publishEvergreenBatch } = await import('./evergreenPlanner');
        evergreenFilled = await publishEvergreenBatch(config.userId, evergreenCount);
      } catch (err) {
        console.error('[Evergreen] batch error:', err);
      }
    }

    const { runBatchRewrite } = await import('./routers/articles');

    // Collect recently-improved URLs to skip
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.skipImprovedDays);
    const history = await articlesDb.getUserAnalysisHistory(config.userId, 5000);
    const recentUrls = new Set(
      history
        .filter(h => new Date(h.createdAt) >= cutoff)
        .map(h => h.url),
    );

    // Приоритет: проблемные статьи из смыслового аудита (data/needs-improve.txt,
    // пишет scripts/map-audit.ts) — тонкие, без картинок, с обрывами. Берём их
    // первыми, обработанные вычёркиваем из файла после батча.
    const needsFile = path.join(process.cwd(), 'data', 'needs-improve.txt');
    const priority: string[] = [];
    try {
      const lines = fs.readFileSync(needsFile, 'utf8').trim().split('\n').filter(Boolean);
      const queued: string[] = [];
      for (const line of lines) {
        const [url] = line.split('\t');
        // Не отбрасываем URL только потому, что он недавно анализировался:
        // анализ сохраняется до публикации, а упавшая публикация должна попасть
        // в следующий retry-батч.
        if (!url) continue;
        if (url.includes('/novosti/')) continue; // новости короткие by design
        queued.push(url);
      }
      // 🚨 Денежные берём по ВСЕЙ очереди, а не по первым строкам файла: иначе страница
      // про выписку ЕГРН ждёт, пока проскроллятся сотни информационных, и не улучшается никогда.
      priority.push(
        ...queued.filter(u => MONEY_SLUG_RE.test(u)),
        ...queued.filter(u => !MONEY_SLUG_RE.test(u)),
      );
      priority.length = Math.min(priority.length, config.articlesPerNight);
      if (priority.length) console.log(`[ArticleScheduler] приоритет из needs-improve: ${priority.length} статей`);
    } catch {}

    // Scan catalog pages until we collect enough unimproved URLs.
    // Берём 2× запас — часть кандидатов отсеет GSC-гейт ниже.
    const candidates: string[] = [...priority];
    const wanted = config.articlesPerNight * 2;
    let page = 1;
    while (candidates.length < wanted && page <= 100) {
      let result;
      try {
        result = await scanCatalog(config.catalogUrl, 1, page);
      } catch (e: any) {
        // scanCatalog-таймаут НЕ должен ронять весь батч — работаем с priority-кандидатами
        console.warn(`[ArticleScheduler] scanCatalog page ${page} ошибка (${(e?.message || '').slice(0, 50)}) — продолжаем с ${candidates.length} кандидатами`);
        break;
      }
      for (const a of result.articles) {
        if (!recentUrls.has(a.url)) candidates.push(a.url);
        if (candidates.length >= wanted) break;
      }
      if (result.articles.length === 0 || page >= result.totalPages) break;
      page++;
    }

    // GSC-гейт: статьи уже в топ-3 с реальными показами не трогаем — improve там
    // скорее навредит (Google доволен текущей версией). Fail-open: без GSC-данных
    // работаем как раньше.
    const { fetchGscAllPagePositions } = await import('./_core/gscClient');
    const posMap = await fetchGscAllPagePositions(14).catch(() => new Map());
    const normPath = (u: string) => { try { return new URL(u).pathname.replace(/\/$/, '') + '/'; } catch { return u; } };
    const isTop = (u: string) => {
      const s = posMap.get(normPath(u));
      return !!s && s.position <= 3 && s.impressions >= 50;
    };
    const skippedTop = candidates.filter(isTop);
    // 🎯 Механизм повышения качества (rank-feedback): near-miss статьи (позиция 4-20
    // с реальными показами) уже ранжируются, но не в топе — лучший ROI дожать их в топ-3.
    // Приоритизируем перед остальными, сортируем по близости к топу.
    const nearMiss = (u: string) => {
      const st = posMap.get(normPath(u));
      return !!st && st.position > 3 && st.position <= 20 && st.impressions >= 10;
    };
    const eligible = candidates.filter(u => !isTop(u));
    const nm = eligible.filter(nearMiss)
      .sort((a, b) => (posMap.get(normPath(a))?.position ?? 99) - (posMap.get(normPath(b))?.position ?? 99));
    const rest = eligible.filter(u => !nearMiss(u));
    // 🚨 Деньги вперёд: страницы про ЕГРН/выписки/справки/проверки ведут на платные
    // услуги /spravki/, остальное — информационный трафик. Внутри групп near-miss и
    // остальных денежные идут первыми, иначе они годами ждут очереди в хвосте каталога.
    const isMoney = (u: string) => MONEY_SLUG_RE.test(u);
    const moneyFirst = (list: string[]) => [...list.filter(isMoney), ...list.filter(u => !isMoney(u))];
    const feedbackEnabled = process.env.SEO_POSITION_FEEDBACK_ENABLED === '1';
    const rankedUrls = [...moneyFirst(nm), ...moneyFirst(rest)];
    const toProcess = feedbackEnabled
      ? selectPositionFeedbackBatch(rankedUrls, priority).urls
      : rankedUrls.slice(0, config.articlesPerNight);
    console.log(`[ArticleScheduler] денежных в батче: ${toProcess.filter(isMoney).length}/${toProcess.length}`);
    if (nm.length) {
      console.log(`[ArticleScheduler] 🎯 rank-feedback: ${nm.length} near-miss статей (поз.4-20) в приоритет — дожимаем в топ`);
    }
    if (skippedTop.length) {
      console.log(`[ArticleScheduler] GSC-гейт: пропущено ${skippedTop.length} статей уже в топ-3 (${skippedTop.slice(0, 3).map(normPath).join(', ')}…)`);
    }

    if (toProcess.length === 0) {
      console.log('[ArticleScheduler] Нет статей для обработки (все недавно улучшены)');
      setLastRunDate();
      return;
    }

    console.log(`[ArticleScheduler] Обрабатываем ${toProcess.length} статей...`);
    const feedbackCycleIds = new Map<string, number>();
    if (feedbackEnabled) {
      const [{ fetchGscPageSnapshot }, { seoPositionFeedbackRepository }, { normalizeGscSnapshot, segmentForUrl }, { chooseHypothesis }] = await Promise.all([
        import('./_core/gscClient'),
        import('./seoPositionFeedback.db'),
        import('./seoPositionFeedback'),
        import('./seoImprovementScorer'),
      ]);
      for (const url of toProcess) {
        try {
          const signal = await fetchGscPageSnapshot(url);
          const normalized = signal.ok && signal.snapshot ? normalizeGscSnapshot({ url, ...signal.snapshot }) : null;
          const snapshot = normalized
            ? await seoPositionFeedbackRepository.saveSnapshot({ ...normalized.snapshot, source: 'google' })
            : null;
          if (snapshot && normalized) await seoPositionFeedbackRepository.saveQueries(snapshot.id, normalized.queries);
          const cycle = await seoPositionFeedbackRepository.createCycle({
            url,
            segment: segmentForUrl(url),
            snapshotBeforeId: snapshot?.id ?? null,
            hypothesis: chooseHypothesis({
              badQuality: normalized?.snapshot.indexStatus === 'bad_quality',
              crawledNotIndexed: normalized?.snapshot.indexStatus === 'crawled_not_indexed',
              lowCtr: (normalized?.snapshot.ctr ?? 0) < 0.02,
            }),
          });
          feedbackCycleIds.set(url, cycle.id);
        } catch (error: any) {
          console.warn(`[SEO feedback] не удалось поставить цикл ${url}:`, error?.message);
        }
      }
    }
    const startedAt = new Date().toISOString();
    const { failed, published } = await runBatchRewrite(config.userId, toProcess.slice(0, config.articlesPerNight));
    if (feedbackCycleIds.size) {
      const { seoPositionFeedbackRepository } = await import('./seoPositionFeedback.db');
      const { applyPublishResults } = await import('./seoPositionFeedbackCycle');
      await applyPublishResults(seoPositionFeedbackRepository, published.flatMap((result) => {
        const cycleId = feedbackCycleIds.get(result.url);
        return cycleId == null ? [] : [{ cycleId, ...result, published: true }];
      })).catch((error: any) => console.warn('[SEO feedback] не удалось отметить публикации:', error?.message));
    }
    const { underTargetUrls } = await import('./routers/articles');

    // Вычеркнуть обработанные из needs-improve.txt.
    // 🚨 Упавшие НЕ вычёркиваем: map-audit их обратно не вернёт (doneIds пропускает
    // уже размеченные посты), и страница выпадала из плана навсегда. Так за 30.07–02.08
    // молча потерялись 35 статей, 32 из них — денежные (ЕГРН/выписки/справки).
    if (failed.length) console.warn(`[ArticleScheduler] оставляю в очереди упавшие: ${failed.length}`);
    try {
      // Недобравшие объём до цели по конкурентам остаются в очереди: мелкие
      // статьи Яндекс бракует как малоценные (LOW_DEMAND), их надо добить.
      if (underTargetUrls.size) console.warn(`[ArticleScheduler] оставляю в очереди недобравшие объём: ${underTargetUrls.size}`);
      const done = new Set(toProcess.filter(u => !failed.includes(u) && !underTargetUrls.has(u)));
      const rest = fs.readFileSync(needsFile, 'utf8').trim().split('\n')
        .filter(l => l && !done.has(l.split('\t')[0]));
      fs.writeFileSync(needsFile, rest.join('\n') + (rest.length ? '\n' : ''));
    } catch {}

    // Новости ~20% от объёма статей — свежие инфоповоды из Google News → /novosti/
    const newsCount = Math.max(0, Math.round(config.articlesPerNight * (config.newsShare ?? 0.2)));
    if (newsCount > 0) {
      try {
        const { publishNewsBatch } = await import('./newsWriter');
        await publishNewsBatch(config.userId, newsCount);
      } catch (err) {
        console.error('[News] batch error:', err);
      }
    }

    // 🚨 Статус батча пишется в файл, а не только в docker logs: логи живут внутри
    // контейнера и исчезают при пересоздании, а по последним строкам лога нельзя понять,
    // сегодняшний это прогон или позавчерашний. Отсюда читает scripts/check-nightly.sh.
    try {
      writeBatchStatus({
        startedAt,
        finishedAt: new Date().toISOString(),
        processed: toProcess.length,
        failed: failed.length,
        failedUrls: failed.slice(0, 10),
        money: toProcess.filter(isMoney).length,
        // Сколько денежных страниц вообще было доступно к обработке. Ноль из нуля —
        // норма (все улучшены недавно), ноль из двадцати — повод разбираться.
        moneyEligible: eligible.filter(isMoney).length,
        evergreen: evergreenFilled,
      });
    } catch (err: any) { console.warn('[ArticleScheduler] статус не записался:', err?.message); }

    setLastRunDate();
    console.log('[ArticleScheduler] Батч завершён');
  } catch (err: any) {
    console.error('[ArticleScheduler] Ошибка:', err);
    // Молчаливое падение ночного батча раньше замечали только по отсутствию
    // статей на сайте — теперь оно приходит в Telegram.
    await alertPublishFailure(
      'Ночной батч статей упал с ошибкой',
      String(err?.message ?? err).slice(0, 800),
    ).catch(() => {});
  } finally {
    running = false;
  }
}

// До какого момента конвейер стоит из-за исчерпанной квоты картинок.
// Решение владельца: без картинок статьи не выпускаем, поэтому ждём сброса суток.
let quotaStopUntil = 0;

// 🚨 07.09.2026: непрерывный режим (см. ниже) в связке с pro-тиром LLM (осознанный выбор
// качества, флеш не годится — см. память) сжигал недельную pro-квоту Code Assist
// (Gemini + оба резерва Claude/GPT-oss) за 1-2 суток, дальше конвейер простаивал до сброса.
// Вместо статичного дневного лимита меряем ФАКТИЧЕСКИЙ темп расхода remainingFraction
// между тиками и сверяем его с временем до resetTime — если жжём быстрее, чем успеваем
// дожить до сброса, пропускаем тик. Fail-open на любой ошибке/нехватке данных: не хотим
// остановить конвейер зря, если ручка моста недоступна.
const QUOTA_PACE_FILE = path.join(process.cwd(), 'data', 'codeassist-quota-pace.json');

interface QuotaPacePoint { ts: number; remainingFraction: number; resetTime: string; }

function readQuotaPacePoint(): QuotaPacePoint | null {
  try { return JSON.parse(fs.readFileSync(QUOTA_PACE_FILE, 'utf8')); } catch { return null; }
}

function writeQuotaPacePoint(p: QuotaPacePoint): void {
  try { fs.writeFileSync(QUOTA_PACE_FILE, JSON.stringify(p)); } catch {}
}

async function proQuotaAllowsBatch(): Promise<boolean> {
  try {
    const base = (process.env.GEMINI_BRIDGE_URL || 'http://viralcraft:3000')
      .replace(/\/genai\/?$/, '').replace(/\/$/, '');
    const r = await fetch(`${base}/api/quota/codeassist`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return true;
    const j: any = await r.json();
    const cur = j?.primary;
    if (!cur || typeof cur.remainingFraction !== 'number' || !cur.resetTime) return true;

    const now = Date.now();
    const resetMs = new Date(cur.resetTime).getTime();
    const hoursToReset = Math.max((resetMs - now) / 3600000, 0.1);

    const prev = readQuotaPacePoint();
    writeQuotaPacePoint({ ts: now, remainingFraction: cur.remainingFraction, resetTime: cur.resetTime });

    // Нет предыдущей точки, сменился resetTime (новая неделя началась) или квота
    // выросла (сброс/докупили) — судить о темпе не по чему, пропускаем не блокируя.
    if (!prev || prev.resetTime !== cur.resetTime || cur.remainingFraction >= prev.remainingFraction) return true;

    const elapsedH = (now - prev.ts) / 3600000;
    if (elapsedH < 0.05) return true; // предыдущий замер слишком свежий — шум

    const burnedPerHour = (prev.remainingFraction - cur.remainingFraction) / elapsedH;
    if (burnedPerHour <= 0) return true;

    const hoursToExhaust = cur.remainingFraction / burnedPerHour;
    if (hoursToExhaust < hoursToReset) {
      console.warn(
        `[ArticleScheduler] pro-квота Gemini жжётся быстрее сброса ` +
        `(иссякнет через ${hoursToExhaust.toFixed(1)}ч, сброс через ${hoursToReset.toFixed(1)}ч) — тик пропущен`,
      );
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function pauseForQuota(reason: string): void {
  // 🚨 14.08.2026: сначала ждали полуночи UTC, но Flow считает сутки по своему
  // времени — наш счётчик уже обнулился (2/100), а Flow всё ещё отвечал
  // daily-limit. Поэтому не гадаем о моменте сброса, а пробуем раз в час:
  // конвейер возобновится сразу, как только Flow снова начнёт отдавать картинки.
  const minutes = Number(process.env.QUOTA_RETRY_MIN ?? 60);
  quotaStopUntil = Date.now() + minutes * 60 * 1000;
  console.warn(`[ArticleScheduler] пауза на ${minutes} мин — ${reason}`);
}

function tick(): void {
  const config = getSchedulerConfig();
  if (!config.enabled || running) return;

  // 🚨 13.08.2026: конвейер работает круглосуточно, а не одним ночным прогоном.
  // Очередь коротких статей — сотни адресов, по одному прогону в сутки её
  // разбирать слишком долго. Нагрузку держим низким приоритетом процесса,
  // а не редкими запусками. Вернуть ночной режим: CONTINUOUS_ARTICLES=0.
  if (Date.now() < quotaStopUntil) return;   // квота картинок выбрана — ждём новых суток
  const continuous = process.env.CONTINUOUS_ARTICLES !== '0';
  const now = new Date();
  if (continuous || (now.getHours() === config.hour && getLastRunDate() !== todayStr())) {
    proQuotaAllowsBatch().then((ok) => { if (ok) runScheduledBatch(config); });
    return;
  }

  // 🚨 Страховка от застрявших заглушек: unpublishStubs отрабатывает только в конце
  // батча и только по своим URL, поэтому оборванный прогон оставлял пустую страницу
  // в выдаче навсегда. Проверяем независимо, не чаще раза в STUB_SWEEP_MS.
  if (Date.now() - lastStubSweep >= STUB_SWEEP_MS) {
    lastStubSweep = Date.now();
    import('./evergreenPlanner')
      .then(m => m.sweepStrandedStubs(config.userId))
      .then(n => { if (n > 0) console.warn(`[StubSweep] снято с публикации заглушек: ${n}`); })
      .catch((e: any) => console.warn('[StubSweep] сбой:', e?.message));
  }
}

export function initArticleScheduler(): void {
  if (tickTimer) return;
  const config = getSchedulerConfig();
  const next = nextRunIso(config);
  console.log(
    `[ArticleScheduler] Init — enabled=${config.enabled}, ` +
    `${config.articlesPerNight} статей/ночь в ${String(config.hour).padStart(2, '0')}:00, ` +
    `skipImprovedDays=${config.skipImprovedDays}, lastRun=${getLastRunDate() ?? 'никогда'}, ` +
    `nextRun=${next ?? 'отключён'} (tick каждые ${TICK_MS / 60000} мин)`,
  );
  tickTimer = setInterval(tick, TICK_MS);
  tick();
}

export function getSchedulerStatus() {
  const config = getSchedulerConfig();
  return {
    running,
    lastRun: getLastRunDate(),
    nextRun: nextRunIso(config),
  };
}
