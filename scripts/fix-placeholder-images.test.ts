import { describe, it, expect, vi } from 'vitest';
import { removePlaceholders } from './fix-placeholder-images';

// Source has top-level await getAllPosts() at line 37 — must return empty data to load
vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [],
      headers: { 'x-wp-totalpages': '1' },
    }),
  },
}));

describe('removePlaceholders', () => {
  it('removes bare img tags with imageN.jpg src', () => {
    const html = '<p>text</p><img src="image1.jpg" alt="test"><p>more</p>';
    expect(removePlaceholders(html)).toBe('<p>text</p><p>more</p>');
  });

  it('removes multiple placeholders', () => {
    const html = '<img src="image1.jpg"><p>hi</p><img src="image16.jpg">';
    const result = removePlaceholders(html);
    expect(result).not.toMatch(/image\d+\.jpg/);
    expect(result).toContain('<p>hi</p>');
  });

  it('does not remove real image srcs', () => {
    const html = '<img src="https://kadastrmap.info/wp-content/uploads/photo.jpg">';
    expect(removePlaceholders(html)).toBe(html);
  });

  it('handles single quotes in src', () => {
    const html = "<img src='image5.jpg' alt='x'>";
    expect(removePlaceholders(html)).not.toContain('image5.jpg');
  });

  it('removes figure wrappers containing only placeholder img', () => {
    const html = '<p>text</p><figure><img src="image3.jpg"/></figure><p>after</p>';
    const result = removePlaceholders(html);
    expect(result).not.toContain('image3.jpg');
    expect(result).toContain('<p>text</p>');
    expect(result).toContain('<p>after</p>');
  });
});
