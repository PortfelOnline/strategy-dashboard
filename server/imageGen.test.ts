import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExecFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync: mockExecFileSync }));

describe('Flow/Gemini image provider', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecFileSync.mockReset();
    delete process.env.GEMINI_API_KEY;
    mockExecFileSync.mockReturnValue('![image](/tmp/flow-image.png)');
  });

  it('uses the Flow bridge and returns its local image path', async () => {
    const { generateImageWithFallback } = await import('./_core/imageGen');
    await expect(generateImageWithFallback('cadastral map')).resolves.toBe('file:///tmp/flow-image.png');
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it('does not call a legacy image API when Flow fails', async () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('Flow quota exhausted'); });
    const { generateImageWithFallback } = await import('./_core/imageGen');
    await expect(generateImageWithFallback('cadastral map')).rejects.toThrow(/No Flow\/Gemini/);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });
});
