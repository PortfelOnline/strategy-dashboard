import type { SerpResult } from './_core/serpParser';

export interface SeoBrief {
  intent: 'informational' | 'transactional' | 'how-to' | 'local' | 'comparison';
  topResults: Array<{ position: number; title: string; domain: string; snippet: string }>;
  questions: string[];
  lsi: string[];
  contentGaps: string[];
}

const STOP = new Set(['что', 'как', 'для', 'это', 'или', 'при', 'можно', 'нужно', 'где', 'когда', 'также']);

function detectIntent(keyword: string): SeoBrief['intent'] {
  const k = keyword.toLocaleLowerCase('ru-RU');
  if (/(москв|петербург|спб|екатеринбург|новосибирск|казан|сочи|краснодар)/i.test(k)) return 'local';
  if (/(сравн|отлич|лучше|или)/i.test(k)) return 'comparison';
  if (/^как\s|\sкак\s+(заказать|получить|оформить|проверить)/i.test(k)) return 'how-to';
  if (/(заказать|купить|оформить|цена|стоимость)/i.test(k)) return 'transactional';
  return 'informational';
}

/** Build a compact, reproducible brief from live SERP evidence. */
export function buildSeoBrief(keyword: string, results: SerpResult[], contentGaps: string[] = []): SeoBrief {
  const topResults = results.filter((r) => r.url).slice(0, 10).map((r) => ({
    position: r.position,
    title: r.title,
    domain: r.domain,
    snippet: r.snippet.slice(0, 240),
  }));
  const lsiFreq = new Map<string, number>();
  for (const result of topResults) {
    for (const word of `${result.title} ${result.snippet}`.toLocaleLowerCase('ru-RU').match(/[а-яёa-z]{5,}/g) || []) {
      if (!STOP.has(word)) lsiFreq.set(word, (lsiFreq.get(word) || 0) + 1);
    }
  }
  const lsi = [...lsiFreq.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([word]) => word);
  const questions = topResults.flatMap((r) => r.title.match(/[^.!?]{0,100}\?/g) || []).map((q) => q.trim()).filter(Boolean).slice(0, 8);
  return { intent: detectIntent(keyword), topResults, questions, lsi, contentGaps: [...new Set(contentGaps)].slice(0, 12) };
}

export function formatSeoBrief(brief: SeoBrief): string {
  return [
    'SEO-БРИФ (только наблюдаемые данные SERP, не догадки):',
    `Интент: ${brief.intent}`,
    `ТОП-10: ${brief.topResults.map((r) => `${r.position}. ${r.title} — ${r.domain}`).join(' | ') || 'данные недоступны'}`,
    `LSI: ${brief.lsi.join(', ') || 'нет устойчивых терминов'}`,
    `Вопросы из SERP: ${brief.questions.join(' | ') || 'не извлечены'}`,
    `Пробелы контента: ${brief.contentGaps.join(' | ') || 'не определены'}`,
    'Правило: закрывай интент и пробелы фактами; не добавляй объём, отзывы, гарантии или цены без источника.',
  ].join('\n');
}

