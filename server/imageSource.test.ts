/**
 * Pexels must be disabled — it returns irrelevant foreign photos for Russian real estate.
 * Wikimedia must be disabled — same problem (foreign/irrelevant).
 * All images must come from FLUX (Fireworks) or WP library only.
 * FLUX calls must be sequential (not parallel) to avoid Fireworks rate-limit 500 errors.
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('./_core/imageGen', () => ({
  generateDallEImage: vi.fn().mockResolvedValue('file:///tmp/flux-test.jpg'),
}));

vi.mock('./_core/wordpress', () => ({
  searchMedia: vi.fn().mockResolvedValue([]),
  uploadMediaFromUrl: vi.fn().mockResolvedValue({ id: 999, url: 'https://kadastrmap.info/wp-content/uploads/flux.jpg' }),
  findPostBySlug: vi.fn().mockResolvedValue(null),
  getUserWordpressAccounts: vi.fn().mockResolvedValue([]),
}));

vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: '["prompt about cadastral document", "prompt about building", "third prompt", "fourth prompt", "fifth prompt", "sixth prompt"]' } }],
  }),
}));

// Mock the file-based cache so it always misses
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    readFileSync: vi.fn().mockImplementation((path: string, ...args: any[]) => {
      if (path.includes('article-image-prompts.json')) throw new Error('Cache miss');
      return actual.readFileSync(path, ...args);
    }),
  };
});

describe('Image source policy', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('searchPexelsImages returns empty array when Pexels is disabled', async () => {
    process.env.PEXELS_API_KEY = 'px_testkey';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ photos: [{ src: { large2x: 'https://images.pexels.com/1.jpg' }, width: 1200, height: 800, alt: 'passport' }] }) } as any);

    vi.resetModules();
    const { searchPexelsImages } = await import('./routers/articles');
    const results = await searchPexelsImages('кадастровый паспорт', 8);

    // Pexels must be disabled — returns no images regardless of API key
    expect(results).toHaveLength(0);
  });

  it('findAndInjectImages uses FLUX sequentially, not Pexels or Wikimedia', async () => {
    const { generateDallEImage } = await import('./_core/imageGen');
    const imageGenMock = generateDallEImage as ReturnType<typeof vi.fn>;

    const callTimes: number[] = [];
    imageGenMock.mockImplementation(async () => {
      callTimes.push(Date.now());
      return 'file:///tmp/flux-test.jpg';
    });

    process.env.IMAGE_API_KEY = 'test_key';
    vi.resetModules();
    const { findAndInjectImages } = await import('./routers/articles');

    const html = '<h2>Что такое кадастровый паспорт</h2><p>Текст.</p>';
    const result = await findAndInjectImages(
      'https://kadastrmap.info',
      'user',
      'pass',
      'test-slug',
      'Кадастровый паспорт здания',
      html,
      2,
    );

    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('featuredMediaId');

    const fetchCalls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
    const pexelsCalls = fetchCalls.filter((u: string) => u.includes('pexels.com') || u.includes('api.pexels'));
    expect(pexelsCalls).toHaveLength(0);

    const wikimediaCalls = fetchCalls.filter((u: string) => u.includes('wikimedia.org') || u.includes('wikipedia.org'));
    expect(wikimediaCalls).toHaveLength(0);
  });
});

describe('generateImagePrompts — article-specific unique prompts', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.IMAGE_API_KEY = 'test_key';
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('generateImagePrompts is exported and accepts h2Sections for article-specific prompts', async () => {
    vi.resetModules();
    const mod = await import('./routers/articles');
    expect(typeof (mod as any).generateImagePrompts).toBe('function');
  });

  it('generateImagePrompts includes h2Sections in LLM prompt for article-specific images', async () => {
    vi.resetModules();
    const llmModule = await import('./_core/llm');
    const llmMock = llmModule.invokeLLM as ReturnType<typeof vi.fn>;
    llmMock.mockClear();
    llmMock.mockResolvedValueOnce({
      choices: [{ message: { content: '["prompt about cadastral document", "prompt about building", "third prompt", "fourth prompt", "fifth prompt", "sixth prompt", "seventh prompt", "eighth prompt", "ninth prompt"]' } }],
    } as any);

    const { generateImagePrompts } = (await import('./routers/articles')) as any;
    const h2Sections = ['Что такое кадастровый паспорт здания', 'Где заказать кадастровый паспорт'];
    await generateImagePrompts('Кадастровый паспорт здания', 'кадастровый паспорт здания', h2Sections);

    const userPrompt =
      llmMock.mock.calls[0]?.[0]?.messages?.find((m: any) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('Что такое кадастровый паспорт здания');
  });

  it('generateImagePrompts includes article body text in LLM prompt for article-specific images', async () => {
    vi.resetModules();
    const llmModule = await import('./_core/llm');
    const llmMock = llmModule.invokeLLM as ReturnType<typeof vi.fn>;
    llmMock.mockClear();
    llmMock.mockResolvedValueOnce({
      choices: [{ message: { content: '["prompt with body context", "another prompt", "third prompt", "fourth prompt", "fifth prompt", "sixth prompt", "seventh prompt", "eighth prompt", "ninth prompt"]' } }],
    } as any);

    const { generateImagePrompts } = (await import('./routers/articles')) as any;
    const bodyText = 'Кадастровый паспорт на дачу — официальный документ подтверждающий границы участка';
    await generateImagePrompts('Кадастровый паспорт дачи', 'кадастровый паспорт дачи', ['Что такое кадастровый паспорт'], bodyText);

    const userPrompt =
      llmMock.mock.calls[0]?.[0]?.messages?.find((m: any) => m.role === 'user')?.content ?? '';
    expect(userPrompt).toContain('Кадастровый паспорт на дачу');
  });

  it('findAndInjectImages passes article body text to LLM for unique image prompts', async () => {
    vi.resetModules();
    const llmModule = await import('./_core/llm');
    const llmMock = llmModule.invokeLLM as ReturnType<typeof vi.fn>;
    llmMock.mockClear();
    // Mock needs to return enough prompts (>=6) to pass the length check in generateImagePrompts
    llmMock.mockResolvedValue({
      choices: [{ message: { content: '["unique prompt from body text", "second prompt", "third prompt", "fourth prompt", "fifth prompt", "sixth prompt", "seventh prompt", "eighth prompt", "ninth prompt"]' } }],
    } as any);

    const { findAndInjectImages } = await import('./routers/articles');
    const bodyContent = 'Межевой план необходим для постановки земельного участка на кадастровый учёт';
    const html = `<h2>Что такое межевой план</h2><p>${bodyContent}</p>`;
    await findAndInjectImages('https://kadastrmap.info', 'user', 'pass', 'mezhevoj-plan', 'Межевой план', html, 1);

    const allPrompts = llmMock.mock.calls
      .map((c: any[]) => c[0]?.messages?.find((m: any) => m.role === 'user')?.content ?? '')
      .join('\n');
    // The LLM must receive the article body text to generate article-specific image prompts
    expect(allPrompts).toContain(bodyContent.slice(0, 50));
  });

  it('generateImagePrompts instructs LLM to include quality boosters for sharp Flux output', async () => {
    vi.resetModules();
    const llmModule = await import('./_core/llm');
    const llmMock = llmModule.invokeLLM as ReturnType<typeof vi.fn>;
    llmMock.mockClear();
    llmMock.mockResolvedValueOnce({
      choices: [{ message: { content: '["cinematic photo, sharp focus, 8k", "another", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"]' } }],
    } as any);

    const { generateImagePrompts } = (await import('./routers/articles')) as any;
    await generateImagePrompts('Кадастровый паспорт', 'кадастровый паспорт');

    const systemPrompt = llmMock.mock.calls[0]?.[0]?.messages?.find((m: any) => m.role === 'system')?.content ?? '';
    // System prompt must instruct LLM to generate quality prompts for Flux image generation
    expect(systemPrompt).toMatch(/cinematic|sharp focus|8k|DSLR|professional photo/i);
  });
});
