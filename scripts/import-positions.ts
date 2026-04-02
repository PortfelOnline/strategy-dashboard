/**
 * Parse raw Keys.so position table (paste from browser) → positions.json
 *
 * Usage: npx tsx scripts/import-positions.ts < paste.txt
 *    or: npx tsx scripts/import-positions.ts "paste content here"
 *
 * Expected row format (tab/space separated):
 *   <query>   <freq|—>   <Y28> [dY28] <Y27> [dY27] <Y26> [dY26] <Y25> [dY25]
 *                        <G28> [dG28] <G27> [dG27] <G26> [dG26] <G25> [dG25]
 *
 * Where:
 *   — means null (not in top-100)
 *   Numbers immediately after position are deltas (signed ints)
 *   freq can be — (null)
 */
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

const POSITIONS_FILE = path.join(import.meta.dirname, 'positions.json');

// Tokens to skip — UI navigation elements that appear in the pasted text
const SKIP_TOKENS = new Set([
  'на главную', 'результатов не найдено', 'избранное',
  'список запросов страниц', 'мониторинг позиций',
  'мои проекты', 'сайты', 'ссылки', 'запросы',
  'база запросов', 'дополняющие фразы', 'расширение ключевых слов',
  'подсветка топов', 'история выдачи serp', 'массовая проверка запросов',
  'сравнение списков', 'комбинатор ключевых фраз', 'чистка неявных дублей',
  'выделение уникальных слов', 'сбор поисковых подсказок',
  'онлайн парсер вордстат', 'онлайн парсер выдачи',
  'кластеризатор', 'реклама', 'трекер ии', 'все отчёты и инструменты',
  'настройка боковой панели',
  'kad обр', 'kadastrmap.info', 'упоминания в ии-ответах',
  'позиции', 'сниппеты', 'регион', 'яндекс', 'google', 'москва',
]);

// Header marker — after this token list, actual data rows begin
const HEADER_MARKERS = ['01.04.2026', '31.03.2026', '30.03.2026', '29.03.2026'];

function parseNum(s: string): number | null {
  if (!s || s === '—' || s === '-') return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function isFreq(s: string): boolean {
  if (s === '—') return true;
  const n = parseInt(s, 10);
  return !isNaN(n) && n >= 0;
}

interface ParsedQuery {
  query: string;
  freq: number | null;
  yandex: [number|null, number|null, number|null, number|null];
  google: [number|null, number|null, number|null, number|null];
  googleDelta: [number|null, number|null, number|null, number|null];
  yandexDelta: [number|null, number|null, number|null, number|null];
}

/**
 * Parse a sequence of tokens after the query+freq into 4 position+delta pairs.
 * Positions are non-negative integers; deltas are signed integers (may be negative).
 * "—" represents null (not ranked).
 *
 * Returns [positions[4], deltas[4]]
 */
function parsePosGroup(tokens: string[]): [[number|null,number|null,number|null,number|null], [number|null,number|null,number|null,number|null]] {
  const positions: (number|null)[] = [];
  const deltas: (number|null)[] = [];

  let i = 0;
  while (positions.length < 4 && i < tokens.length) {
    const t = tokens[i];
    if (t === '—' || t === '-') {
      positions.push(null);
      deltas.push(null);
      i++;
    } else {
      const n = parseInt(t, 10);
      if (!isNaN(n) && n > 0) {
        positions.push(n);
        // Check if next token is a delta (signed int, may start with -)
        const next = tokens[i + 1];
        if (next !== undefined) {
          const nd = parseInt(next, 10);
          if (!isNaN(nd) && (next.startsWith('-') || (nd >= -200 && nd <= 200 && nd !== n))) {
            // Looks like a delta
            deltas.push(nd);
            i += 2;
          } else {
            deltas.push(null);
            i++;
          }
        } else {
          deltas.push(null);
          i++;
        }
      } else {
        i++;
      }
    }
  }

  while (positions.length < 4) { positions.push(null); deltas.push(null); }

  return [
    positions.slice(0, 4) as [number|null,number|null,number|null,number|null],
    deltas.slice(0, 4) as [number|null,number|null,number|null,number|null],
  ];
}

export function parsePositionsPaste(text: string): ParsedQuery[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Find where actual data starts (after header dates)
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (HEADER_MARKERS.every(m => lines.slice(i, i + 8).some(l => l.includes(m)))) {
      dataStart = i + 8;
      break;
    }
  }

  const results: ParsedQuery[] = [];

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip navigation lines
    if (SKIP_TOKENS.has(line.toLowerCase())) continue;
    if (line.match(/^\d{2}\.\d{2}\.\d{4}$/)) continue; // date header
    if (line.match(/^[©+]/) || line.startsWith('logo')) continue;
    if (line.startsWith('sk') || line.startsWith('vk') || line.startsWith('max')) continue;

    // Split tokens
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) continue;

    // Find where the query ends and numbers begin
    // Query is all text tokens up to the first freq token
    let freqIdx = -1;
    for (let j = tokens.length - 1; j >= 0; j--) {
      const t = tokens[j];
      if (isFreq(t)) {
        // Check if subsequent tokens are all numbers/dashes (position data)
        const afterFreq = tokens.slice(j + 1);
        const allNumeric = afterFreq.every(t2 => t2 === '—' || t2 === '-' || !isNaN(parseInt(t2, 10)));
        if (allNumeric || afterFreq.length === 0) {
          freqIdx = j;
          break;
        }
      }
    }

    if (freqIdx < 0) continue;

    const queryParts = tokens.slice(0, freqIdx);
    if (queryParts.length === 0) continue;

    const query = queryParts.join(' ').toLowerCase().trim();

    // Skip navigation artifacts
    if (SKIP_TOKENS.has(query)) continue;
    if (query.length < 5) continue;
    // Skip obvious UI elements
    if (['очередей', 'без очередей'].includes(query)) continue;

    const freqToken = tokens[freqIdx];
    const freq = freqToken === '—' ? null : parseInt(freqToken, 10);

    const posTokens = tokens.slice(freqIdx + 1);

    // First 8 tokens: yandex (4 days), google (4 days)
    // But tokens may include deltas interleaved
    const [yandexPos, yandexDelta] = parsePosGroup(posTokens.slice(0, posTokens.length));
    // Heuristic: yandex takes the first group of 4, google the next 4
    // Since all Yandex are null, posTokens starts with 4 nulls (—), then Google data
    // Count leading nulls for yandex (expecting 4)
    let gStart = 0;
    {
      let nullCount = 0;
      for (let k = 0; k < posTokens.length; k++) {
        if (posTokens[k] === '—') { nullCount++; if (nullCount === 4) { gStart = k + 1; break; } }
        else break;
      }
    }

    const yandex: [number|null,number|null,number|null,number|null] = [null, null, null, null];
    const yDelta: [number|null,number|null,number|null,number|null] = [null, null, null, null];

    const [gPos, gDelta] = parsePosGroup(posTokens.slice(gStart));

    results.push({
      query,
      freq: isNaN(freq as number) ? null : freq,
      yandex,
      google: gPos,
      googleDelta: gDelta,
      yandexDelta: yDelta,
    });
  }

  return results;
}

// CLI mode
if (process.argv[1].endsWith('import-positions.ts') || process.argv[1].endsWith('import-positions.js')) {
  let input = '';
  if (process.argv[2]) {
    // Argument passed directly
    input = process.argv.slice(2).join(' ');
  } else {
    // Read from stdin
    input = readFileSync('/dev/stdin', 'utf8');
  }

  if (!input.trim()) {
    console.error('No input. Pipe paste text or pass as argument.');
    process.exit(1);
  }

  const parsed = parsePositionsPaste(input);
  console.log(`Parsed ${parsed.length} queries from input`);

  // Load existing positions.json
  const existing = JSON.parse(readFileSync(POSITIONS_FILE, 'utf8'));
  const existingMap = new Map<string, any>(existing.queries.map((q: any) => [q.query.toLowerCase(), q]));

  let updated = 0;
  let added = 0;

  for (const p of parsed) {
    if (existingMap.has(p.query)) {
      const entry = existingMap.get(p.query)!;
      entry.yandex = p.yandex;
      entry.google = p.google;
      entry.googleDelta = p.googleDelta;
      if (p.freq !== null) entry.freq = p.freq;
      updated++;
    } else {
      const entry: any = { query: p.query, freq: p.freq, yandex: p.yandex, google: p.google };
      if (p.googleDelta.some(d => d !== null)) entry.googleDelta = p.googleDelta;
      existingMap.set(p.query, entry);
      existing.queries.push(entry);
      added++;
    }
  }

  existing.updated = new Date().toISOString().slice(0, 10);
  existing._comment = existing._comment.replace(/Updated.*/, `Updated ${existing.updated} with import`);

  writeFileSync(POSITIONS_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  console.log(`Updated ${updated}, added ${added} queries → ${POSITIONS_FILE}`);
}
