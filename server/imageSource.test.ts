/**
 * Pexels must be disabled — it returns irrelevant foreign photos for Russian real estate.
 * Wikimedia must be disabled — same problem (foreign/irrelevant).
 * All images must come from FLUX (Fireworks) or WP library only.
 * FLUX calls must be sequential (not parallel) to avoid Fireworks rate-limit 500 errors.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  invokeLLM: vi.fn().mockResolvedValue('[]'),
}));

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

    // Track call timing to verify sequential execution
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

    // Must return an object with html and featuredMediaId fields
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('featuredMediaId');

    // Fetch must NOT be called for Pexels (no pexels.com requests)
    const fetchCalls = mockFetch.mock.calls.map((c: any[]) => String(c[0]));
    const pexelsCalls = fetchCalls.filter((u: string) => u.includes('pexels.com') || u.includes('api.pexels'));
    expect(pexelsCalls).toHaveLength(0);

    // Fetch must NOT be called for Wikimedia
    const wikimediaCalls = fetchCalls.filter((u: string) => u.includes('wikimedia.org') || u.includes('wikipedia.org'));
    expect(wikimediaCalls).toHaveLength(0);
  });
});
