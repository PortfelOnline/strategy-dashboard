import type { BacklinkPost } from "../../drizzle/schema";

function escXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function extractArticleText(raw: string | null): string {
  if (!raw) return "";
  // Try standard JSON parse
  try {
    const j = JSON.parse(raw);
    if (j && typeof j.article === "string") return j.article;
  } catch { /* literal control chars inside JSON strings */ }
  // Char-by-char extraction of "article":"..." value (handles unescaped newlines from LLM)
  const marker = '"article":"';
  const start  = raw.indexOf(marker);
  if (start === -1) return raw;
  let result = "";
  let i = start + marker.length;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === '"')  { result += '"';  i += 2; continue; }
      if (next === "n")  { result += "\n"; i += 2; continue; }
      if (next === "t")  { result += "\t"; i += 2; continue; }
      if (next === "\\") { result += "\\"; i += 2; continue; }
    }
    if (ch === '"') break; // end of JSON string value
    result += ch;
    i++;
  }
  return result || raw;
}

export function buildRssFeed(posts: BacklinkPost[]): string {
  const items = posts
    .filter(p => p.article && p.title)
    .map(p => {
      const articleText = extractArticleText(p.article);
      const link    = p.publishedUrl ?? `https://kadastrmap.info${p.targetUrl}`;
      const guid    = p.publishedUrl ?? `kadastrmap-backlink-${p.id}`;
      const pubDate = (p.publishedAt ?? p.createdAt).toUTCString();
      return `    <item>
      <title>${escXml(p.title ?? "")}</title>
      <link>${escXml(link)}</link>
      <description>${escXml(articleText.substring(0, 500))}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${escXml(guid)}</guid>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>kadastrmap.info — Кадастр и недвижимость</title>
    <link>https://kadastrmap.info</link>
    <description>Полезные статьи о кадастре и недвижимости</description>
    <language>ru</language>
${items}
  </channel>
</rss>`;
}
