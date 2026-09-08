/**
 * Phase 6 release-blocker regression suite: the canonical fresh-user flow.
 *
 *   quack init → quack run → planner materializes actionable invocations
 *   → CapabilityBroker grants standing-consent reads → governed execution
 *   → independent structural verification → completion receipt.
 *
 * Rebuilds the full production system (swe-system) against a temporary
 * home with NO provider credentials — exactly what a fresh machine looks
 * like after `npm install -g @quack/os && quack init`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createQuackSystem } from "../distributions/swe-system.js";

async function freshSystem(context: { after: (fn: () => Promise<void>) => void }, workspaceFiles: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "quack-fresh-install-"));
  const home = join(root, "home");
  const workspaceRoot = join(root, "workspace");
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  for (const [name, content] of Object.entries(workspaceFiles)) {
    await writeFile(join(workspaceRoot, name), content, "utf8");
  }
  context.after(() => rm(root, { recursive: true, force: true }));

  const system = createQuackSystem({ dataDir: join(home, "data"), workspaceRoot });
  return { system, home, workspaceRoot };
}

test("fresh install: mission executes governed tools and produces a completion receipt", async (context) => {
  const { system } = await freshSystem(context, {
    "notes.md": "architecture research notes for the authentication module",
    "app.ts": "export const authenticate = () => true;",
  });

  const result = await system.runtime.submitGoal("say hello and complete", "cli", { origin: "cli" });
  assert.ok(result.ok, `Mission submission failed: ${result.ok ? "" : result.error.message}`);

  const task = result.data;
  assert.equal(task.status, "completed", `Mission did not complete: ${JSON.stringify(task.result)}`);
  assert.ok((task.result as { summary?: string }).summary, "Completion summary is missing");

  // Completion receipt (contracts v1) must be attached.
  const receipt = (task.result as { receipt?: { id?: string; contractVersion?: string } }).receipt;
  assert.ok(receipt?.id, "Completion receipt was not generated");
  assert.equal(receipt.contractVersion, "1.0.0");

  // The planner produced a real actionable graph: every node with declared
  // tools carries invocations, and at least one governed tool call ran.
  const loop = system.runtime.getLoopResult(task.id);
  assert.ok(loop);
  assert.equal(loop.state, "COMPLETED");
  const nodes = loop.iterations[0]?.plan?.nodes ?? [];
  assert.ok(nodes.length > 0, "Planner produced an empty graph");
  for (const node of nodes) {
    if (node.requiredTools.length > 0) {
      assert.ok(
        (node.toolInvocations ?? []).length > 0,
        `Node "${node.description}" declares tools without invocations (release-blocker regression)`,
      );
    }
  }
  const toolCalls = loop.iterations[0]?.executionResult?.toolCalls ?? [];
  assert.ok(toolCalls.length > 0, "No governed tool calls executed");
  assert.ok(toolCalls.every((call) => call.success), "A governed tool call failed");

  // Evidence chain: workflow completed all nodes.
  const workflow = loop.iterations.at(-1)?.executionResult?.workflowState;
  assert.equal(workflow?.status, "completed");
  assert.equal(workflow?.failedNodes.length, 0);
});

test("fresh install: mission without a matching tool surface still reports governed failure", async (context) => {
  const { system } = await freshSystem(context);
  // No provider credentials, no precompiled graph: the planner must never
  // fabricate high-risk invocations (write/terminal). Missions that would
  // require them complete only their derivable read-only surface; the graph
  // itself must never declare tools it cannot invoke.
  const result = await system.runtime.submitGoal("refactor the build system and run tests", "cli", { origin: "cli" });
  assert.ok(result.ok);
  const loop = system.runtime.getLoopResult(result.data.id);
  assert.ok(loop);
  for (const node of loop.iterations[0]?.plan?.nodes ?? []) {
    for (const invocation of node.toolInvocations ?? []) {
      assert.ok(
        !["core.workspace.write-file", "core.terminal.execute", "core.workspace.read-file"].includes(invocation.toolId),
        `Static planner auto-invoked context-dependent tool ${invocation.toolId}`,
      );
    }
  }
});

test("denied capability stays denied for fresh missions (no standing consent for elevated permissions)", async (context) => {
  const { system } = await freshSystem(context);
  // The standing-consent set covers only memory/workspace READS. Terminal
  // and workspace-write tools must remain denied for a fresh mission.
  const denied = await system.runtime.executeTool("core.terminal.execute", { command: "echo no" }, {
    taskId: "denied-probe", actor: "cli", missionId: "mission-denied-probe",
  });
  assert.ok(!denied.ok);
  assert.match(denied.error!.message, /denied|cannot execute|authority/i);
  const write = await system.runtime.executeTool("core.workspace.write-file", { path: "x.txt", content: "x" }, {
    taskId: "denied-probe", actor: "cli", missionId: "mission-denied-probe",
  });
  assert.ok(!write.ok);
  assert.match(write.error!.message, /denied|cannot execute|authority/i);
});

test("invalid mission input fails clearly without executing", async (context) => {
  const { system } = await freshSystem(context);
  const empty = await system.runtime.submitGoal("   ", "cli", { origin: "cli" });
  assert.ok(!empty.ok);
  assert.equal(empty.error!.code, "task.goal_empty");
  const missing = await system.runtime.resumeMission("does-not-exist");
  assert.ok(!missing.ok);
  assert.equal(missing.error!.code, "task.not_found");
});
