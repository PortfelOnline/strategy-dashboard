import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { desc, eq } from "drizzle-orm";
import { resolve } from "path";

const TRADING_DB_PATH = process.env.TRADING_DB_PATH
  ?? resolve(process.env.HOME ?? "", "dev/aitrading/trading.db");

let _db: ReturnType<typeof drizzle> | null = null;

const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  marketType: text("market_type").notNull(),
  qty: real("qty").notNull(),
  price: real("price").notNull(),
  usdtValue: real("usdt_value").notNull(),
  leverage: integer("leverage").notNull().default(1),
  binanceOrderId: text("binance_order_id"),
  pnlUsdt: real("pnl_usdt"),
  pnlPct: real("pnl_pct"),
  status: text("status").notNull().default("OPEN"),
  openedAt: integer("opened_at").notNull(),
  closedAt: integer("closed_at"),
});

export type Trade = typeof trades.$inferSelect;

function getDb() {
  if (!_db) {
    try {
      const sqlite = new Database(TRADING_DB_PATH, { readonly: true, fileMustExist: true });
      _db = drizzle(sqlite, { schema: { trades } });
    } catch {
      return null;
    }
  }
  return _db;
}

export function isTradingDbAvailable(): boolean {
  return getDb() !== null;
}

export function getTrades(limit = 200): Trade[] {
  const db = getDb();
  if (!db) return [];
  return db.select().from(trades).orderBy(desc(trades.openedAt)).limit(limit).all();
}

export function getOpenTrades(): Trade[] {
  const db = getDb();
  if (!db) return [];
  return db.select().from(trades).where(eq(trades.status, "OPEN")).orderBy(desc(trades.openedAt)).all();
}

export function getTradeStats() {
  const db = getDb();
  if (!db) return null;

  const all = db.select().from(trades).all();
  const closed = all.filter(t => t.status === "CLOSED");
  const open   = all.filter(t => t.status === "OPEN");
  const totalPnl = closed.reduce((s, t) => s + (t.pnlUsdt ?? 0), 0);
  const wins = closed.filter(t => (t.pnlUsdt ?? 0) > 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const bestTrade = closed.reduce<Trade | null>((b, t) =>
    !b || (t.pnlUsdt ?? -Infinity) > (b.pnlUsdt ?? -Infinity) ? t : b, null);

  const pnlByDay: Record<string, number> = {};
  for (const t of closed) {
    const day = new Date(t.openedAt).toISOString().slice(0, 10);
    pnlByDay[day] = (pnlByDay[day] ?? 0) + (t.pnlUsdt ?? 0);
  }
  let cumulative = 0;
  const pnlChart = Object.entries(pnlByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => { cumulative += pnl; return { date, pnl, cumulative }; });

  return {
    totalPnl, winRate, totalTrades: all.length, openCount: open.length,
    closedCount: closed.length, winsCount: wins.length, bestTrade, pnlChart,
  };
}
