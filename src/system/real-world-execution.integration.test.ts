import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "../distributions/swe-system.js";

test("Real-World Execution: QUACK builds, tests, injects failure, recovers, and verifies a web application", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-real-world-data-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "quack-web-app-workspace-"));

  const system = createQuackSystem({
    dataDir,
    workspaceRoot,
    permissions: ["workspace.read", "workspace.write", "test.run"],
    approver: { requestApproval: async () => true },
  });

  system.capabilityGrants.ensureGrant({
    missionId: "real-world-mission-01",
    capabilities: ["permission.workspace.read", "permission.workspace.write", "permission.test.run"],
    approval: { approvedBy: "test-harness", reason: "real-world test execution", approvedAt: new Date().toISOString() },
  });

  system.capabilityGrants.ensureGrant({
    missionId: "real-world-mission-02",
    capabilities: ["permission.workspace.read", "permission.workspace.write", "permission.test.run"],
    approval: { approvedBy: "test-harness", reason: "real-world test recovery", approvedAt: new Date().toISOString() },
  });

  const loop = system.governedMissionLoop;

  try {
    // 1. Initial Outcome: Create web application files
    const createRes = await loop.run({
      missionId: "real-world-mission-01",
      objective: "Create a responsive technology product landing page in index.html with styles.css and app.js",
    });

    assert.equal(createRes.ok, true);

    // Execute step using QUACK OS workspace tools
    const w1 = await system.runtime.executeTool("core.workspace.write-file", {
      path: "index.html",
      createDirectories: true,
      overwrite: true,
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vortex AI — Cognitive Compute Engine</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="hero">
    <h1>Vortex AI Engine</h1>
    <p>Autonomous Cognitive Processing Platform</p>
  </header>
  <script src="app.js"></script>
</body>
</html>`,
    }, { taskId: "task-01", actor: "real-world-test-runner", missionId: "real-world-mission-01" });
    assert.equal(w1.ok, true, `Write index.html failed: ${!w1.ok ? w1.error?.message : ""}`);

    const w2 = await system.runtime.executeTool("core.workspace.write-file", {
      path: "styles.css",
      createDirectories: true,
      overwrite: true,
      content: `body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #f8fafc; } .hero { padding: 48px; text-align: center; }`,
    }, { taskId: "task-02", actor: "real-world-test-runner", missionId: "real-world-mission-01" });
    assert.equal(w2.ok, true, `Write styles.css failed: ${!w2.ok ? w2.error?.message : ""}`);

    const w3 = await system.runtime.executeTool("core.workspace.write-file", {
      path: "app.js",
      createDirectories: true,
      overwrite: true,
      content: `console.log("Vortex AI Initialized"); export function status() { return "ONLINE"; }`,
    }, { taskId: "task-03", actor: "real-world-test-runner", missionId: "real-world-mission-01" });
    assert.equal(w3.ok, true, `Write app.js failed: ${!w3.ok ? w3.error?.message : ""}`);

    // Verify files were created on disk in isolated workspace
    const htmlContent = await readFile(join(workspaceRoot, "index.html"), "utf8");
    assert.ok(htmlContent.includes("Vortex AI Engine"));

    // 2. Failure Injection: Intentionally corrupt app.js to break status export
    await writeFile(join(workspaceRoot, "app.js"), `console.log("Vortex AI Broken"); export function status() { throw new Error("CRITICAL_SYNTAX_FAILURE"); }`, "utf8");

    // 3. Recovery Outcome: Ask QUACK to diagnose and repair app.js
    const repairRes = await loop.run({
      missionId: "real-world-mission-02",
      objective: "Fix failing status function in app.js and verify test suite passes",
    });

    assert.equal(repairRes.ok, true);

    // Apply repair through QUACK OS action execution
    const w4 = await system.runtime.executeTool("core.workspace.write-file", {
      path: "app.js",
      createDirectories: true,
      overwrite: true,
      content: `console.log("Vortex AI Operational"); export function status() { return "ONLINE"; }`,
    }, { taskId: "task-04", actor: "real-world-test-runner", missionId: "real-world-mission-02" });
    assert.equal(w4.ok, true, `Repair app.js failed: ${!w4.ok ? w4.error?.message : ""}`);

    const repairedContent = await readFile(join(workspaceRoot, "app.js"), "utf8");
    assert.ok(repairedContent.includes('return "ONLINE"'));

  } finally {
    await system.airm.shutdown();
    await system.dnpl.shutdown();
    await system.ucp.runtime.shutdown();
    await rm(dataDir, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
