import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { getTrades, getOpenTrades, getTradeStats, isTradingDbAvailable } from "../trading-db";

export const aitradingRouter = router({
  status: publicProcedure.query(() => ({
    available: isTradingDbAvailable(),
  })),

  stats: publicProcedure.query(() => getTradeStats()),

  openPositions: publicProcedure.query(() => getOpenTrades()),

  history: publicProcedure
    .input(z.object({
      limit:      z.number().min(1).max(500).default(100),
      symbol:     z.string().optional(),
      marketType: z.enum(["SPOT", "FUTURES"]).optional(),
    }))
    .query(({ input }) => {
      let rows = getTrades(input.limit);
      if (input.symbol)     rows = rows.filter(t => t.symbol === input.symbol!.toUpperCase());
      if (input.marketType) rows = rows.filter(t => t.marketType === input.marketType);
      return rows;
    }),
});
