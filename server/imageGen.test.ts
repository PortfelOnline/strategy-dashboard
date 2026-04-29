import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Re-import after env setup
const setupEnv = (overrides: Record<string, string> = {}) => {
  process.env.IMAGE_API_URL = overrides.IMAGE_API_URL ?? "https://api.fireworks.ai/inference";
  process.env.IMAGE_API_KEY = overrides.IMAGE_API_KEY ?? "fw_testkey";
  process.env.IMAGE_MODEL = overrides.IMAGE_MODEL ?? "accounts/fireworks/models/flux-1-schnell-fp8";
};

describe("generateDallEImage (Fireworks)", () => {
  beforeEach(() => {
    setupEnv();
    mockFetch.mockReset();
  });

  it("calls /v1/workflows/{model}/text_to_image endpoint for Fireworks", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG magic bytes
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => fakeJpeg.buffer,
    } as any);

    const { generateDallEImage } = await import("./_core/imageGen");
    await generateDallEImage("a red apple");

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/workflows/");
    expect(url).toContain("/text_to_image");
    expect(url).not.toContain("/image_generation/");
    expect((options.headers as Record<string, string>)["Accept"]).toBe("image/jpeg");
  });

  it("sends prompt and aspect_ratio in request body", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => fakeJpeg.buffer,
    } as any);

    const { generateDallEImage } = await import("./_core/imageGen");
    await generateDallEImage("Mumbai skyline at sunset");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.prompt).toBe("Mumbai skyline at sunset");
    expect(body.aspect_ratio).toBeDefined();
  });

  it("uses 16:9 landscape aspect ratio for article images", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => fakeJpeg.buffer,
    } as any);

    vi.resetModules();
    setupEnv();
    const { generateDallEImage } = await import("./_core/imageGen");
    await generateDallEImage("Russian apartment building exterior");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    // Article images must be landscape 16:9, not square 1:1
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("uses guidance_scale 3.5 for distilled FLUX models (not schnell)", async () => {
    const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => fakeJpeg.buffer,
    } as any);

    vi.resetModules();
    setupEnv({ IMAGE_MODEL: "accounts/fireworks/models/flux-1-pro-fp8" });
    const { generateDallEImage } = await import("./_core/imageGen");
    await generateDallEImage("person reviewing cadastral document");

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    // FLUX distilled models work best at guidance_scale 3.5 (not 7+)
    expect(body.guidance_scale).toBe(3.5);
  });

  it("throws if IMAGE_API_KEY is not configured", async () => {
    process.env.IMAGE_API_KEY = "";
    // Need fresh import since module caches env at load time
    vi.resetModules();
    process.env.IMAGE_API_KEY = "";
    const { generateDallEImage } = await import("./_core/imageGen");
    await expect(generateDallEImage("test")).rejects.toThrow("IMAGE_API_KEY not configured");
  });
});
