import "dotenv/config";
import express from "express";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { botsRouter } from "./router.js";
import { initOrchestrator } from "./orchestrator.js";

declare const __dirname: string;

const PORT = parseInt(process.env.PORT || "4000");
// In the bundled CJS output, __dirname = release/ directory
const STATIC = path.join(__dirname, "public");

const app = express();
app.use(express.json());

app.use("/api/trpc", createExpressMiddleware({
  router: botsRouter,
  createContext: () => ({}),
}));

app.use(express.static(STATIC));
app.use("*", (_req, res) => res.sendFile(path.join(STATIC, "index.html")));

app.listen(PORT, () => {
  console.log(`\n✅  Bot Dashboard: http://localhost:${PORT}\n`);
  initOrchestrator();
});
