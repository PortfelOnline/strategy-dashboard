/**
 * Generates RSS XML for Дзен and deploys it to kadastrmap.info.
 * Run after generating new articles: npx tsx scripts/push-rss-to-kad.ts
 *
 * Дзен Studio setup (one-time):
 *   Мой канал → Источники → RSS → https://kadastrmap.info/rss-dzen.xml
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";

async function main() {
  // Load env
  const raw = [".env.local", ".env"].flatMap(f => {
    try { return readFileSync(resolve(process.cwd(), f), "utf-8").split("\n"); } catch { return []; }
  });
  const env: Record<string, string> = {};
  for (const line of raw) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? env["DATABASE_URL"];

  const { getLastNPublished } = await import("../server/backlinks.db");
  const { buildRssFeed } = await import("../server/publishers/rss");

  const posts = await getLastNPublished("dzen", 20);
  console.log(`Found ${posts.length} dzen posts (pending + published)`);

  if (!posts.length) {
    console.log("No posts to publish. Generate articles first.");
    process.exit(0);
  }

  const xml = buildRssFeed(posts);
  const tmpFile = "/tmp/rss-dzen.xml";
  writeFileSync(tmpFile, xml, "utf-8");
  console.log(`RSS XML written: ${tmpFile} (${xml.length} bytes)`);
  console.log("Preview:");
  console.log(xml.substring(0, 600));

  // Deploy to kadastrmap.info
  const kadHost = "kad";
  const remoteDir = "/application/";  // Nginx root = /application (kadastrmap.info)
  const remoteFile = `${remoteDir}rss-dzen.xml`;

  console.log(`\nDeploying to ${kadHost}:${remoteFile}...`);
  execFileSync("scp", ["-i", `${process.env.HOME}/.ssh/id_ed25519`, tmpFile, `root@${kadHost}:${remoteFile}`], {
    stdio: "inherit",
  });

  // Set correct permissions
  execFileSync("ssh", [
    "-i", `${process.env.HOME}/.ssh/id_ed25519`,
    `root@${kadHost}`,
    `chmod 644 ${remoteFile} && echo "Deployed OK → https://kadastrmap.info/rss-dzen.xml"`,
  ], { stdio: "inherit" });

  console.log("\n✅ Done! Next steps:");
  console.log("  1. Open Дзен Studio: https://dzen.ru/my/channel");
  console.log("  2. Источники → RSS → Добавить");
  console.log("  3. URL: https://kadastrmap.info/rss-dzen.xml");
  console.log("  4. Дзен will auto-import new articles every few hours");
}

main().catch(console.error);
