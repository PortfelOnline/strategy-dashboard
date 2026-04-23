import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  marketType: string;
  qty: number;
  price: number;
  usdtValue: number;
  pnlUsdt: number | null;
  status: string;
  openedAt: number;
}

export function TradeHistory({ trades }: { trades: Trade[] }) {
  const [sym, setSym] = useState("");
  const [mkt, setMkt] = useState("all");

  const rows = trades.filter(t =>
    (!sym || t.symbol.includes(sym.toUpperCase())) &&
    (mkt === "all" || t.marketType === mkt)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>История сделок</CardTitle>
        <div className="flex gap-2 mt-2">
          <Input
            placeholder="Монета (BTC...)"
            value={sym}
            onChange={e => setSym(e.target.value)}
            className="max-w-[180px]"
          />
          <Select value={mkt} onValueChange={setMkt}>
            <SelectTrigger className="max-w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все рынки</SelectItem>
              <SelectItem value="SPOT">Спот</SelectItem>
              <SelectItem value="FUTURES">Фьючерс</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0
          ? <p className="text-slate-500 text-sm">Нет сделок.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-slate-500 text-left">
                    {["Монета", "Рынок", "Сторона", "Цена", "Объём", "P&L", "Статус", "Дата"].map(h => (
                      <th key={h} className="pb-2 pr-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(t => {
                    const pnlColor = (t.pnlUsdt ?? 0) >= 0 ? "text-green-600" : "text-red-600";
                    return (
                      <tr key={t.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2 pr-3 font-medium">{t.symbol}</td>
                        <td className="py-2 pr-3"><Badge variant="outline" className="text-xs">{t.marketType}</Badge></td>
                        <td className="py-2 pr-3">
                          <Badge className={`text-xs ${t.side === "BUY" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                            {t.side}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 font-mono">${t.price.toFixed(4)}</td>
                        <td className="py-2 pr-3 font-mono">${t.usdtValue.toFixed(2)}</td>
                        <td className={`py-2 pr-3 font-mono ${pnlColor}`}>
                          {t.pnlUsdt != null ? `${t.pnlUsdt >= 0 ? "+" : ""}$${t.pnlUsdt.toFixed(2)}` : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge className={`text-xs ${t.status === "OPEN" ? "bg-yellow-100 text-yellow-700" : "bg-slate-100 text-slate-600"}`}>
                            {t.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-slate-500 text-xs">{new Date(t.openedAt).toLocaleDateString("ru-RU")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}
