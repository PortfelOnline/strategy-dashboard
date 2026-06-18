import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./llm', () => ({
  invokeLLM: vi.fn(),
}));
import * as llmModule from './llm';
import { applyCorrection, extractClaims, gradeClaim, verifyAndCorrectClaims } from './crag';
import type { SerpData } from './serpParser';

const mockLLM = llmModule.invokeLLM as ReturnType<typeof vi.fn>;

const fakeSerp = (snippets: string[]): SerpData => ({
  results: snippets.map((s, i) => ({ url: `https://rosreestr.gov.ru/${i}`, domain: 'rosreestr.gov.ru', title: 't', snippet: s })),
  error: '',
} as SerpData);

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

describe('gradeClaim', () => {
  beforeEach(() => {
    mockLLM.mockClear();
  });

  it('помечает correct когда значение совпадает с tier-1', async () => {
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['госпошлина за выписку ЕГРН — 350 рублей для физлиц']));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"correct"}' } }] });
    const g = await gradeClaim({ claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'госпошлина 350 рублей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('correct');
    expect(searchFn).toHaveBeenCalledOnce();
  });

  it('помечает wrong и возвращает верное значение + источник', async () => {
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['актуальная госпошлина 2000 рублей']));
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"wrong","correctValue":"2000 рублей","source":"https://rosreestr.gov.ru/0"}' } }] });
    const g = await gradeClaim({ claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'госпошлина 350 рублей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('wrong');
    expect(g.correctValue).toBe('2000 рублей');
    expect(g.source).toContain('rosreestr.gov.ru');
  });

  it('помечает unverified когда поиск пуст', async () => {
    const searchFn = vi.fn().mockResolvedValue({ results: [], error: '' } as SerpData);
    const g = await gradeClaim({ claim: 'выдумка', value: '99%', type: 'stat', snippet: '99% людей' }, searchFn, 'test-model');
    expect(g.verdict).toBe('unverified');
    expect(mockLLM).not.toHaveBeenCalled();
  });
});

describe('applyCorrection', () => {
  it('wrong → подменяет значение в snippet и добавляет упоминание источника', () => {
    const html = '<p>Госпошлина составляет 350 рублей за услугу.</p>';
    const out = applyCorrection(html,
      { claim: 'госпошлина', value: '350 рублей', type: 'fee', snippet: 'Госпошлина составляет 350 рублей' },
      { verdict: 'wrong', correctValue: '2000 рублей', source: 'https://rosreestr.gov.ru/x' });
    expect(out).toContain('2000 рублей');
    expect(out).not.toContain('350 рублей');
    expect(out.toLowerCase()).toContain('rosreestr.gov.ru');
  });

  it('unverified → убирает конкретное значение из snippet', () => {
    const html = '<p>По статистике 99% россиян заказывают выписку онлайн.</p>';
    const out = applyCorrection(html,
      { claim: 'доля', value: '99%', type: 'stat', snippet: '99% россиян' },
      { verdict: 'unverified' });
    expect(out).not.toContain('99%');
  });

  it('correct → не меняет html', () => {
    const html = '<p>Срок регистрации 7 рабочих дней.</p>';
    const out = applyCorrection(html,
      { claim: 'срок', value: '7 рабочих дней', type: 'term', snippet: '7 рабочих дней' },
      { verdict: 'correct' });
    expect(out).toBe(html);
  });
});

describe('verifyAndCorrectClaims', () => {
  it('прогоняет extract→grade→correct и возвращает статистику', async () => {
    mockLLM.mockReset();
    // extractClaims
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '[{"claim":"госпошлина","value":"350 рублей","type":"fee","snippet":"Госпошлина 350 рублей"}]' } }] });
    // gradeClaim
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '{"verdict":"wrong","correctValue":"2000 рублей","source":"https://rosreestr.gov.ru/x"}' } }] });
    const searchFn = vi.fn().mockResolvedValue(fakeSerp(['госпошлина 2000 рублей']));
    const res = await verifyAndCorrectClaims('<p>Госпошлина 350 рублей.</p>', 'выписка', 'test-model', searchFn);
    expect(res.html).toContain('2000 рублей');
    expect(res.stats).toEqual({ total: 1, ok: 0, corrected: 1, stripped: 0 });
  });

  it('нет утверждений → html без изменений', async () => {
    mockLLM.mockReset();
    mockLLM.mockResolvedValueOnce({ choices: [{ message: { content: '[]' } }] });
    const searchFn = vi.fn();
    const html = '<p>Текст без фактов.</p>';
    const res = await verifyAndCorrectClaims(html, 'ключ', 'test-model', searchFn);
    expect(res.html).toBe(html);
    expect(searchFn).not.toHaveBeenCalled();
  });
});
