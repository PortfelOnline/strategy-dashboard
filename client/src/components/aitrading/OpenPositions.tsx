import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Trade {
  id: number;
  symbol: string;
  side: string;
  marketType: string;
  qty: number;
  price: number;
  usdtValue: number;
  openedAt: number;
}

export function OpenPositions({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return (
    <Card className="mb-6">
      <CardHeader><CardTitle>Открытые позиции</CardTitle></CardHeader>
      <CardContent><p className="text-slate-500 text-sm">Нет открытых позиций.</p></CardContent>
    </Card>
  );

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>Открытые позиции ({trades.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-slate-500 text-left">
                {["Монета", "Рынок", "Сторона", "Кол-во", "Цена входа", "Объём", "Дата"].map(h => (
                  <th key={h} className="pb-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="py-2 pr-4 font-medium">{t.symbol}</td>
                  <td className="py-2 pr-4"><Badge variant="outline">{t.marketType}</Badge></td>
                  <td className="py-2 pr-4">
                    <Badge className={t.side === "BUY" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}>
                      {t.side === "BUY" ? "LONG" : "SHORT"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4 font-mono">{t.qty.toFixed(6)}</td>
                  <td className="py-2 pr-4 font-mono">${t.price.toFixed(4)}</td>
                  <td className="py-2 pr-4 font-mono">${t.usdtValue.toFixed(2)}</td>
                  <td className="py-2 text-slate-500 text-xs">{new Date(t.openedAt).toLocaleDateString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
