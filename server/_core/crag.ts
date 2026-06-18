import { invokeLLM } from './llm';

export type ClaimType = 'fee' | 'stat' | 'term' | 'law' | 'other';

export interface Claim {
  claim: string;   // что утверждается
  value: string;   // конкретное значение (число/срок/статья)
  type: ClaimType;
  snippet: string; // фрагмент HTML где встречается (для замены)
}

const MAX_CLAIMS = 8;

function stripJson(raw: string): string {
  return raw.trim()
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function extractClaims(html: string, keyword: string, model: string): Promise<Claim[]> {
  try {
    const resp = await invokeLLM({
      model,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: 'Ты фактчекер статей по недвижимости РФ. Находишь проверяемые конкретные утверждения. Отвечай ТОЛЬКО валидным JSON-массивом без markdown.' },
        { role: 'user', content: `Из статьи про "${keyword}" вытащи проверяемые утверждения: размеры госпошлин, проценты, сроки, цифры статистики, ссылки на статьи законов. Игнорируй цены kadastrmap.info и общие фразы.\n\nФормат: [{"claim":"<что>","value":"<конкретное значение>","type":"fee|stat|term|law|other","snippet":"<точный фрагмент текста где это написано>"}]\n\nСТАТЬЯ (первые 8000 символов):\n${html.slice(0, 8000)}\n\nВерни ТОЛЬКО JSON-массив.` },
      ],
    });
    const content = resp.choices[0]?.message.content;
    const raw = typeof content === 'string' ? stripJson(content) : '[]';
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c: any) => c && typeof c.claim === 'string' && typeof c.value === 'string' && typeof c.snippet === 'string')
      .map((c: any) => ({ claim: c.claim, value: c.value, type: (c.type ?? 'other') as ClaimType, snippet: c.snippet }))
      .slice(0, MAX_CLAIMS);
  } catch (e: any) {
    console.warn('[CRAG] extractClaims failed:', e?.message ?? e);
    return [];
  }
}
