import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Activity, Target } from "lucide-react";

interface Props {
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  openCount: number;
}

export function StatsCards({ totalPnl, winRate, totalTrades, openCount }: Props) {
  const isPositive = totalPnl >= 0;
  const PnlIcon = isPositive ? TrendingUp : TrendingDown;
  const pnlColor = isPositive ? "text-green-600" : "text-red-600";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">Total P&L</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold flex items-center gap-2 ${pnlColor}`}>
            <PnlIcon className="w-5 h-5" />
            {isPositive ? "+" : ""}${totalPnl.toFixed(2)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">Win Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            {winRate.toFixed(1)}%
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">Всего сделок</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-500" />
            {totalTrades}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">Открытых</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-slate-900">{openCount}</div>
        </CardContent>
      </Card>
    </div>
  );
}
