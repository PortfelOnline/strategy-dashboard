import type { BacklinkPost } from "../../drizzle/schema";

const TG_TOKEN   = process.env.TG_BOT_TOKEN ?? "";
const TG_CHANNEL = process.env.TG_CHANNEL   ?? ""; // e.g. @kadastrmap_news

function extractText(raw: string | null): string {
  if (!raw) return "";
  try {
    const j = JSON.parse(raw);
    if (j?.article) return j.article;
  } catch {}
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
    if (ch === '"') break;
    result += ch;
    i++;
  }
  return result || raw;
}

function buildCaption(post: BacklinkPost): string {
  const title   = post.title ?? "";
  const text    = extractText(post.article).substring(0, 3500);
  const link    = post.publishedUrl ?? `https://kadastrmap.info${post.targetUrl}`;
  return `*${title}*\n\n${text}\n\n🔗 ${link}`;
}

export async function publishToTelegram(post: BacklinkPost): Promise<void> {
  if (!TG_TOKEN || !TG_CHANNEL) {
    throw new Error("TG_BOT_TOKEN or TG_CHANNEL not set in env");
  }
  const caption = buildCaption(post);
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:    TG_CHANNEL,
      text:       caption,
      parse_mode: "Markdown",
    }),
  });
  const json = await res.json() as any;
  if (!json.ok) throw new Error(`Telegram API error: ${json.description}`);
  console.log(`[Backlinks] Telegram posted → message_id=${json.result.message_id}`);
}
