import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * Timezone bug explanation:
 * Drizzle's mapFromDriverValue does: new Date(value + "+0000")
 * If mysql2 returns a Date object (default), value.toString() gives
 * the IST local string "Fri Apr 03 2026 20:00:00 GMT+0530", then
 * appending "+0000" parses as UTC 20:00 instead of UTC 14:30.
 *
 * Fix: use dateStrings:true so mysql2 returns raw strings, AND
 * SET time_zone='+00:00' on each connection so MySQL returns UTC strings.
 * Then Drizzle gets "2026-04-03 14:30:00" + "+0000" = 14:30Z correctly.
 */
describe("getDb timezone configuration", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("creates mysql2 pool with dateStrings:true to prevent Drizzle double-offset bug", async () => {
    const mockPool = { on: vi.fn(), query: vi.fn(), end: vi.fn() };
    const createPoolSpy = vi.fn().mockReturnValue(mockPool);
    vi.doMock("mysql2/promise", () => ({ default: { createPool: createPoolSpy } }));

    process.env.DATABASE_URL = "mysql://root@localhost:3306/strategy_dashboard";

    const { getDb } = await import("./db");
    await getDb();

    expect(createPoolSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dateStrings: true })
    );
  });

  it("registers connection event to SET time_zone=+00:00 on each new connection", async () => {
    const mockPool = { on: vi.fn(), query: vi.fn(), end: vi.fn() };
    const createPoolSpy = vi.fn().mockReturnValue(mockPool);
    vi.doMock("mysql2/promise", () => ({ default: { createPool: createPoolSpy } }));

    process.env.DATABASE_URL = "mysql://root@localhost:3306/strategy_dashboard";

    const { getDb } = await import("./db");
    await getDb();

    // Pool must register a 'connection' event listener to set server timezone
    expect(mockPool.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  it("passes DATABASE_URL uri to mysql2 pool", async () => {
    const mockPool = { on: vi.fn(), query: vi.fn(), end: vi.fn() };
    const createPoolSpy = vi.fn().mockReturnValue(mockPool);
    vi.doMock("mysql2/promise", () => ({ default: { createPool: createPoolSpy } }));

    process.env.DATABASE_URL = "mysql://root@localhost:3306/strategy_dashboard";

    const { getDb } = await import("./db");
    await getDb();

    expect(createPoolSpy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: "mysql://root@localhost:3306/strategy_dashboard" })
    );
  });
});
