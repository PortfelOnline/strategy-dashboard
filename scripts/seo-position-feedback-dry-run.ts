import * as fs from "fs";
import * as path from "path";
import { fetchGscAllPagePositions } from "../server/_core/gscClient";
import { segmentForUrl } from "../server/seoPositionFeedback";
import { scoreCandidate } from "../server/seoImprovementScorer";

async function main() {
  const queueFile = path.join(process.cwd(), "data", "needs-improve.txt");
  const queue = fs.existsSync(queueFile)
    ? fs.readFileSync(queueFile, "utf8").split("\n").map((line) => line.split("\t")[0]).filter(Boolean)
    : [];
  console.log("dry-run: queue loaded");
  const gsc = await Promise.race([
    fetchGscAllPagePositions(14).then((positions) => ({ available: true, positions })).catch(() => ({ available: false, positions: new Map() })),
    new Promise<{ available: false; positions: Map<string, never> }>((resolve) => setTimeout(() => resolve({ available: false, positions: new Map() }), 15_000)),
  ]);
  const positions = gsc.positions;
  const normalize = (url: string) => { try { return new URL(url).pathname.replace(/\/$/, "") + "/"; } catch { return url; } };
  const candidates = [...new Set(queue)].slice(0, 100).map((url) => {
    const position = positions.get(normalize(url));
    return {
      url, segment: segmentForUrl(url), impressions: position?.impressions ?? 0, clicks: position?.clicks ?? 0,
      ctr: position?.impressions ? position.clicks / position.impressions : 0, position: position?.position ?? null,
      indexStatus: null, queued: true, lastImprovedAt: null, lostHypotheses: [],
    };
  });
  const selected = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
    .filter(({ score }) => score.eligible)
    .sort((left, right) => right.score.score - left.score.score || left.candidate.url.localeCompare(right.candidate.url))
    .slice(0, 3)
    .map(({ candidate }) => candidate.url);
  const reestr = selected.filter((url) => url.includes("/reestr/"));
  console.log(JSON.stringify({
    dryRun: true, gscAvailable: gsc.available, gscPositions: positions.size, queueCandidates: candidates.length, selected,
    selectedCount: selected.length, reestrCount: reestr.length, maxThree: selected.length <= 3,
  }, null, 2));
  if (!gsc.available || reestr.length || selected.length > 3) process.exitCode = 1;
  process.exit();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
