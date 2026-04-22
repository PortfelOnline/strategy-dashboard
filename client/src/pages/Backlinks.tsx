import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Platform = "dzen" | "spark" | "kw";
const PL_LABEL: Record<Platform, string> = { dzen: "Дзен", spark: "Spark", kw: "Кью" };
const STATUS_CLS: Record<string, string> = {
  pending:    "bg-yellow-100 text-yellow-800",
  publishing: "bg-blue-100 text-blue-800",
  published:  "bg-green-100 text-green-800",
  failed:     "bg-red-100 text-red-800",
};

export default function Backlinks() {
  const [filterPl, setFilterPl]   = useState<string>("all");
  const [genPl, setGenPl]         = useState<Platform>("dzen");
  const [busy, setBusy]           = useState(false);

  const { data: queue, refetch } = trpc.backlinks.getQueue.useQuery();
  const { data: stats }          = trpc.backlinks.getStats.useQuery();

  const genMut    = trpc.backlinks.generate.useMutation();
  const pubMut    = trpc.backlinks.publish.useMutation();
  const retryMut  = trpc.backlinks.retry.useMutation();
  const delMut    = trpc.backlinks.delete.useMutation();
  const pubNext   = trpc.backlinks.publishNext.useMutation();

  const wrap = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast.success(msg); refetch(); }
    catch (e: any) { toast.error(e.message ?? "Ошибка"); }
    finally { setBusy(false); }
  };

  const filtered = (queue ?? []).filter((p: any) => filterPl === "all" || p.platform === filterPl);
  const rssUrl   = `${window.location.origin}/rss/dzen`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-4">
        <h1 className="text-2xl font-bold">Backlinks — kadastrmap.info</h1>
      </header>

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {(["dzen","spark","kw"] as Platform[]).map(p => (
            <div key={p} className="bg-white rounded-lg border p-4 text-center">
              <div className="text-2xl font-bold">{(stats as any)?.[p] ?? 0}</div>
              <div className="text-sm text-gray-500">{PL_LABEL[p]} опубл.</div>
            </div>
          ))}
          <div className="bg-white rounded-lg border p-4 text-center">
            <div className="text-2xl font-bold">{(stats as any)?.thisWeek ?? 0}</div>
            <div className="text-sm text-gray-500">Эта неделя</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex gap-3 flex-wrap items-center">
          <Select value={filterPl} onValueChange={setFilterPl}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              {(["dzen","spark","kw"] as Platform[]).map(p => <SelectItem key={p} value={p}>{PL_LABEL[p]}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={genPl} onValueChange={v => setGenPl(v as Platform)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["dzen","spark","kw"] as Platform[]).map(p => <SelectItem key={p} value={p}>{PL_LABEL[p]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={busy} onClick={() => wrap(() => genMut.mutateAsync({ platform: genPl }), "Сгенерировано")}>
            + Генерировать
          </Button>

          <div className="ml-auto flex gap-2">
            {(["dzen","spark","kw"] as Platform[]).map(p => (
              <Button key={p} size="sm" variant="outline" disabled={busy}
                onClick={() => wrap(() => pubNext.mutateAsync({ platform: p }), `${PL_LABEL[p]} опубликован`)}>
                ▶ {PL_LABEL[p]}
              </Button>
            ))}
          </div>
        </div>

        {/* Queue table */}
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left">
                {["#","Платформа","Целевая страница","Заголовок","Статус","Создан","Действия"].map(h => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((post: any) => (
                <tr key={post.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{post.id}</td>
                  <td className="px-4 py-3 font-medium">{PL_LABEL[post.platform as Platform]}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-[160px] truncate" title={post.targetUrl}>{post.targetUrl}</td>
                  <td className="px-4 py-3 max-w-[200px] truncate" title={post.title ?? ""}>{post.title ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLS[post.status] ?? ""}`} title={post.errorMsg ?? ""}>
                      {post.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(post.createdAt).toLocaleDateString("ru-RU")}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {(post.status === "pending" || post.status === "failed") && (
                        <Button size="sm" variant="outline" onClick={() => wrap(() => pubMut.mutateAsync({ id: post.id }), "Опубликовано")}>
                          Publish
                        </Button>
                      )}
                      {post.publishedUrl && (
                        <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs leading-9 px-1">→ URL</a>
                      )}
                      {post.status === "failed" && (
                        <Button size="sm" variant="ghost" onClick={() => wrap(() => retryMut.mutateAsync({ id: post.id }), "Сброшено")}>Retry</Button>
                      )}
                      <Button size="sm" variant="ghost" className="text-red-400"
                        onClick={() => wrap(() => delMut.mutateAsync({ id: post.id }), "Удалено")}>✕</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Нет постов</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* RSS link */}
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>RSS для Дзен:</span>
          <code className="bg-gray-100 px-2 py-1 rounded text-xs">{rssUrl}</code>
          <Button size="sm" variant="ghost"
            onClick={() => { navigator.clipboard.writeText(rssUrl); toast.success("Скопировано"); }}>
            Копировать
          </Button>
        </div>
      </div>
    </div>
  );
}
