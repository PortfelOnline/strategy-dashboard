import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatsCards } from "@/components/aitrading/StatsCards";
import { PnlChart } from "@/components/aitrading/PnlChart";
import { OpenPositions } from "@/components/aitrading/OpenPositions";
import { TradeHistory } from "@/components/aitrading/TradeHistory";

export default function AiTrading() {
  const { data: status } = trpc.aitrading.status.useQuery();
  const dbOk = status?.available ?? false;

  const { data: stats, isLoading } = trpc.aitrading.stats.useQuery(
    undefined,
    { refetchInterval: 30_000, enabled: dbOk }
  );
  const { data: positions } = trpc.aitrading.openPositions.useQuery(
    undefined,
    { refetchInterval: 30_000, enabled: dbOk }
  );
  const { data: history } = trpc.aitrading.history.useQuery(
    { limit: 200 },
    { enabled: dbOk }
  );

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">AiTrading</h1>
          <p className="text-slate-600">Персональная аналитика Binance через Telegram бота</p>
        </div>

        {!dbOk && (
          <Alert className="mb-6">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              База данных бота недоступна. Запусти бота и убедись что{" "}
              <code className="bg-slate-100 px-1 rounded text-xs">TRADING_DB_PATH</code>{" "}
              указан в .env этого дашборда.
            </AlertDescription>
          </Alert>
        )}

        {isLoading && dbOk && (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}

        {stats && (
          <>
            <StatsCards
              totalPnl={stats.totalPnl}
              winRate={stats.winRate}
              totalTrades={stats.totalTrades}
              openCount={stats.openCount}
            />
            <PnlChart data={stats.pnlChart} />
          </>
        )}

        <OpenPositions trades={positions ?? []} />
        <TradeHistory trades={history ?? []} />
      </div>
    </DashboardLayout>
  );
}
