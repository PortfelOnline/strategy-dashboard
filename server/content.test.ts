import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };

  return { ctx };
}

describe("content.generatePost", () => {
  it("generates content with valid pillar type and platform", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.generatePost({
      pillarType: "desi_business_owner",
      platform: "instagram",
      language: "hinglish",
    });

    expect(result).toBeDefined();
    expect(result.content).toBeTruthy();
    expect(result.hashtags).toBeTruthy();
    expect(result.platform).toBe("instagram");
    expect(result.language).toBe("hinglish");
  });

  it("generates content for five_minute_transformation pillar", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.generatePost({
      pillarType: "five_minute_transformation",
      platform: "facebook",
      language: "english",
    });

    expect(result).toBeDefined();
    expect(result.content).toBeTruthy();
    expect(result.pillarType).toBe("five_minute_transformation");
  });

  it("generates content for roi_calculator pillar", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.generatePost({
      pillarType: "roi_calculator",
      platform: "whatsapp",
      language: "hindi",
    });

    expect(result).toBeDefined();
    expect(result.content).toBeTruthy();
    expect(result.pillarType).toBe("roi_calculator");
  });

  it("accepts custom prompt", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const customPrompt = "Create a funny post about AI taking over customer service";
    const result = await caller.content.generatePost({
      pillarType: "desi_business_owner",
      platform: "instagram",
      language: "hinglish",
      customPrompt,
    });

    expect(result).toBeDefined();
    expect(result.content).toBeTruthy();
  });
});

describe("content.savePost", () => {
  it("saves a post as draft", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.savePost({
      title: "Test Post",
      content: "This is a test post content",
      platform: "instagram",
      language: "hinglish",
      hashtags: "#GetMyAgent #AI",
      status: "draft",
    });

    expect(result).toBeDefined();
  });

  it("saves a post with scheduled date", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const scheduledDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await caller.content.savePost({
      title: "Scheduled Post",
      content: "This post will be scheduled",
      platform: "facebook",
      language: "english",
      status: "scheduled",
      scheduledAt: scheduledDate,
    });

    expect(result).toBeDefined();
  });
});

describe("content.listPosts", () => {
  it("lists posts for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.listPosts({});

    expect(Array.isArray(result)).toBe(true);
  });

  it("filters posts by status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.listPosts({
      status: "draft",
    });

    expect(Array.isArray(result)).toBe(true);
  });
});

describe("content.listTemplates", () => {
  it("lists templates for authenticated user", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.listTemplates();

    expect(Array.isArray(result)).toBe(true);
  });
});

describe("content.saveTemplate", () => {
  it("saves a new content template", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.content.saveTemplate({
      title: "Test Template",
      pillarType: "desi_business_owner",
      platform: "instagram",
      language: "hinglish",
      prompt: "Create funny content about customer service",
      description: "A test template",
    });

    expect(result).toBeDefined();
  });
});
