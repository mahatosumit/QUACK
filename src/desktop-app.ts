#!/usr/bin/env node
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createQuackSystem } from "./distributions/swe-system.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const goal = process.argv.slice(2).join(" ").trim() || "start QUACK desktop";
const system = createQuackSystem();
system.companyRuntime.reconcileInterrupted();

const { DesktopServer } = await import("./desktop/server.js");
const server = new DesktopServer({
  workspaceRoot: system.config.workspaceRoot,
  dataDir: system.config.dataDir,
  port: 3157,
  adaptive: system.adaptive,
});

const port = await server.start();
console.log(`QUACK Desktop server started on http://localhost:${port}`);

system.events.onAny((event) => {
  console.log(`[${event.timestamp}] ${event.type} ${event.taskId ?? ""}`.trim());
});

const result = await system.runtime.submitGoal(goal, "desktop", { origin: "desktop" });
if (!result.ok) {
  console.error(result.error.message);
  process.exitCode = 1;
} else if (result.data.status !== "completed") {
  console.error(result.data.error?.message ?? "Mission did not complete.");
  process.exitCode = 1;
}

process.on("SIGINT", async () => {
  await system.runtime.shutdown();
  await server.stop();
  process.exit(0);
});
