import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createQuackSystem } from "./distributions/swe-system.js";
import { now } from "./core/types.js";
import { TaskGraphBuilder } from "./engine/task-graph.js";

async function runBenchmarks(): Promise<void> {
  console.log("QUACK local microchecks: one observation per operation, not production certification.\n");
  const originalDirectory = process.cwd();
  const benchmarkDir = join(originalDirectory, "benchmarks");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "quack-microcheck-"));
  const workspaceRoot = join(temporaryRoot, "workspace");
  const metrics: Record<string, number | null> = {};

  try {
    await mkdir(workspaceRoot);
    process.chdir(workspaceRoot);

    const t0 = performance.now();
    const system = createQuackSystem({ workspaceRoot, dataDir: join(temporaryRoot, "first-state") });
    metrics.firstInitializationMs = performance.now() - t0;

    const t1 = performance.now();
    createQuackSystem({ workspaceRoot, dataDir: join(temporaryRoot, "repeat-state") });
    metrics.repeatedInitializationMs = performance.now() - t1;

    const t2 = performance.now();
    const workspace = system.workspaces.create("microcheck-workspace", workspaceRoot);
    if (!workspace.ok) throw new Error("Temporary workspace registration failed.");
    metrics.workspaceRegistrationMs = performance.now() - t2;

    const t3 = performance.now();
    const routing = await system.airm.routeRequest({
      taskType: "reasoning",
      requiredCapabilities: ["reasoning"],
      constraints: {},
      context: { taskDescription: "Local routing availability check", contextLength: 100 },
    });
    metrics.intelligenceRoutingMs = routing ? performance.now() - t3 : null;
    const routingStatus = routing ? "available" : "unsupported: no eligible model registered";

    const t4 = performance.now();
    await system.memory.search({ text: "microcheck-absent-record" });
    metrics.emptyMemoryRetrievalMs = performance.now() - t4;

    const t5 = performance.now();
    const builder = new TaskGraphBuilder({ description: "Microcheck DAG" });
    builder.addNode("A", { description: "Task A" });
    builder.addNode("B", { description: "Task B", dependencies: ["A"] });
    builder.addNode("C", { description: "Task C", dependencies: ["A"] });
    builder.addNode("D", { description: "Task D", dependencies: ["B", "C"] });
    builder.build();
    metrics.dagConstructionMs = performance.now() - t5;

    const reportData = {
      timestamp: now(),
      os: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      sampleCountPerOperation: 1,
      workspace: "isolated temporary fixture",
      routingStatus,
      limitations: [
        "Single-process local observations, not production certification or a comparative baseline.",
        "No model inference, workspace indexing, or workflow scheduling was measured.",
        "Unavailable routing is reported as null rather than a successful latency measurement.",
      ],
      metrics,
    };
    const rows: readonly (readonly [string, string])[] = [
      ["System construction (first)", "firstInitializationMs"],
      ["System construction (repeat)", "repeatedInitializationMs"],
      ["In-memory workspace registration", "workspaceRegistrationMs"],
      ["Model routing selection", "intelligenceRoutingMs"],
      ["Empty fixture memory retrieval", "emptyMemoryRetrievalMs"],
      ["Four-node DAG construction", "dagConstructionMs"],
    ];
    const formatted = rows.map(([label, key]) => {
      const value = metrics[key];
      return [label, typeof value === "number" ? value.toFixed(2) : "Not measured (unsupported)"] as const;
    });
    for (const [label, value] of formatted) console.log(`${label}: ${value}${value.startsWith("Not") ? "" : " ms"}`);
    console.log(`Routing: ${routingStatus}`);

    await mkdir(benchmarkDir, { recursive: true });
    await writeFile(join(benchmarkDir, "benchmark-latest.json"), JSON.stringify(reportData, null, 2), "utf8");
    const report = `# QUACK Local Microcheck Report

**Date:** ${reportData.timestamp}
**Environment:** Node ${process.version} on ${process.platform} (${process.arch})
**Samples:** One observation per operation, using isolated temporary state.
**Routing:** ${routingStatus}

| Operation | Observed duration (ms) |
|---|---|
${formatted.map(([label, value]) => `| ${label} | ${value} |`).join("\n")}

${reportData.limitations.map((limitation) => `- ${limitation}`).join("\n")}
`;
    await writeFile(join(benchmarkDir, "benchmark-report.md"), report, "utf8");
    console.log("\nLocal microcheck reports saved to benchmarks/.");
  } finally {
    process.chdir(originalDirectory);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

runBenchmarks().catch((error: unknown) => {
  console.error("Local microchecks failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
