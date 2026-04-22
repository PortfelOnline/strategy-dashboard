import cron from "node-cron";
import { publishNext } from "./publishers/pub-index";

let initialized = false;

export function initBacklinkScheduler(): void {
  if (initialized) return;
  initialized = true;

  cron.schedule("0 10 * * *", async () => {
    console.log("[BacklinkScheduler] publishNext dzen");
    await publishNext("dzen").catch(err => console.error("[BacklinkScheduler] dzen:", err));
  }, { timezone: "Europe/Moscow" });

  cron.schedule("0 11 * * 1,3,5", async () => {
    console.log("[BacklinkScheduler] publishNext spark");
    await publishNext("spark").catch(err => console.error("[BacklinkScheduler] spark:", err));
  }, { timezone: "Europe/Moscow" });

  cron.schedule("0 12 * * 1,4", async () => {
    console.log("[BacklinkScheduler] publishNext kw");
    await publishNext("kw").catch(err => console.error("[BacklinkScheduler] kw:", err));
  }, { timezone: "Europe/Moscow" });

  console.log("[BacklinkScheduler] Initialized — Дзен daily 10:00 MSK, Spark MWF 11:00, Q Mon/Thu 12:00");
}
