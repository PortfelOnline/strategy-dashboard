import { describe, expect, it, vi } from 'vitest';

vi.mock('./llm', () => ({
  invokeLLM: vi.fn(),
}));
import * as llmModule from './llm';
import { extractClaims } from './crag';

const mockLLM = llmModule.invokeLLM as ReturnType<typeof vi.fn>;

describe('extractClaims', () => {
  it('парсит JSON-список проверяемых утверждений из HTML', async () => {
    mockLLM.mockResolvedValueOnce({
      choices: [{ message: { content: '[{"claim":"госпошлина за выписку ЕГРН","value":"350 рублей","type":"fee","snippet":"госпошлина составляет 350 рублей"}]' } }],
    });
    const claims = await extractClaims('<p>госпошлина составляет 350 рублей</p>', 'выписка ЕГРН', 'test-model');
    expect(claims).toHaveLength(1);
    expect(claims[0].value).toBe('350 рублей');
    expect(claims[0].type).toBe('fee');
  });

  it('возвращает [] при невалидном JSON (не роняется)', async () => {
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: 'не json' } }] });
    const claims = await extractClaims('<p>текст</p>', 'ключ', 'test-model');
    expect(claims).toEqual([]);
  });

  it('каппит число утверждений до 8', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ claim: `c${i}`, value: `${i}`, type: 'stat', snippet: `s${i}` }));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(many) } }] });
    const claims = await extractClaims('<p>x</p>', 'ключ', 'test-model');
    expect(claims).toHaveLength(8);
  });
});
