import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

interface Props {
  data: { date: string; cumulative: number }[];
}

export function PnlChart({ data }: Props) {
  if (data.length === 0) return (
    <Card className="mb-6">
      <CardHeader><CardTitle>P&L по времени</CardTitle></CardHeader>
      <CardContent><p className="text-slate-500 text-sm">Нет закрытых сделок для графика.</p></CardContent>
    </Card>
  );

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>Кумулятивный P&L ($)</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${Number(v).toFixed(0)}`} />
            <Tooltip
              formatter={(v: number) => [`$${v.toFixed(2)}`, "Cumulative P&L"]}
              labelFormatter={l => `Дата: ${l}`}
            />
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="cumulative" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
