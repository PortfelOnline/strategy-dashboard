import { describe, expect, it } from 'vitest';

// Helper: build the IndexNow payload for a list of URLs
function buildIndexNowPayload(apiKey: string, urls: string[]) {
  return {
    host: 'get-my-agent.com',
    key: apiKey,
    keyLocation: `https://get-my-agent.com/${apiKey}.txt`,
    urlList: urls,
  };
}

// Helper: build a Flux image prompt from an article title
function buildFluxPrompt(title: string): string {
  return `Professional blog cover image for an article titled "${title}". Modern, clean design, real estate agent with clients, warm lighting, photorealistic. 16:9 aspect ratio.`;
}

// Helper: parse meta description from LLM output
function parseMeta(llmOutput: string): string {
  const match = llmOutput.match(/META_DESCRIPTION:\s*(.+)/);
  return match ? match[1].trim() : '';
}

describe('gma-blog helpers', () => {
  it('buildIndexNowPayload returns correct host and key', () => {
    const payload = buildIndexNowPayload('abc123', ['https://get-my-agent.com/en/blog/post-1/']);
    expect(payload.host).toBe('get-my-agent.com');
    expect(payload.key).toBe('abc123');
  });

  it('buildIndexNowPayload includes keyLocation derived from key', () => {
    const payload = buildIndexNowPayload('mykey', []);
    expect(payload.keyLocation).toBe('https://get-my-agent.com/mykey.txt');
  });

  it('buildFluxPrompt includes the article title', () => {
    const prompt = buildFluxPrompt('How to Buy a Home in 2025');
    expect(prompt).toContain('How to Buy a Home in 2025');
  });

  it('parseMeta extracts meta description from LLM output', () => {
    const output = 'Some content\nMETA_DESCRIPTION: Learn how AI helps real estate agents\nMore content';
    expect(parseMeta(output)).toBe('Learn how AI helps real estate agents');
  });

  it('parseMeta returns empty string when no META_DESCRIPTION marker', () => {
    expect(parseMeta('Just plain article content without any meta tag')).toBe('');
  });
});

