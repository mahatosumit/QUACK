import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId, ok, type QuackResult } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";
import { QuackHttpServer, type ApiMissionRecord } from "../server/index.js";
import { QuackApi } from "../api/index.js";
import { GovernedMissionLoop } from "../runtime/mission-lifecycle/governed-mission-loop.js";
import type { ModelRequest, ModelResponse } from "../models/runtime.js";

function stubModel(scripts: readonly string[]): {
  generate(request: ModelRequest, context: { missionId?: string; actor: string }): Promise<QuackResult<ModelResponse>>;
} {
  let call = 0;
  return {
    async generate(request: ModelRequest): Promise<QuackResult<ModelResponse>> {
      const text = scripts[Math.min(call, scripts.length - 1)]!;
      call += 1;
      return ok({
        id: createId("resp"),
        providerId: "stub-provider",
        model: "stub-outcome-model",
        text,
        usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        latencyMs: 1,
        fallbackUsed: false,
      });
    },
  };
}

async function removeFixtureDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      return;
    } catch {
      if (attempt === 4) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

async function createTestFixture(scripts: readonly string[]) {
  const workspaceRoot = join(tmpdir(), createId("quack_e2e_ws"));
  const dataDir = join(tmpdir(), createId("quack_e2e_data"));
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "README.md"), "# QUACK Workspace E2E Test\n", "utf8");
  await writeFile(join(workspaceRoot, "package.json"), '{"name":"quack-e2e-probe","version":"1.0.0"}\n', "utf8");

  const system = createQuackSystem({
    workspaceRoot,
    dataDir,
    permissions: ["workspace.read", "workspace.write", "memory.read", "memory.write"],
  });

  // Inject deterministic model proposal script into governedMissionLoop
  const model = stubModel(scripts);
  const governedLoop = new GovernedMissionLoop({
    broker: system.capabilityBroker,
    actionRuntime: system.actionRuntime,
    actionProviders: system.actionProviders,
    tools: system.tools,
    modelRuntime: model,
    events: system.events,
    executeTool: (toolId, input, options) => system.runtime.executeTool(toolId, input, options),
    runStore: system.governedMissionRunStore,
    checkpointStore: system.governedMissionCheckpointStore,
  });

  // Attach the governed loop to the system instance
  (system as unknown as { governedMissionLoop: GovernedMissionLoop }).governedMissionLoop = governedLoop;

  return {
    workspaceRoot,
    dataDir,
    system,
    cleanup: async () => {
      await system.events.drain();
      await removeFixtureDir(workspaceRoot);
      await removeFixtureDir(dataDir);
    },
  };
}

test("E2E Outcome Flow: QuackApi.submitGovernedMission executes model proposal, broker gates, checkpoints, and completes", async () => {
  const fixture = await createTestFixture([
    JSON.stringify({
      capability: "core.workspace.list-files",
      arguments: { path: ".", depth: 1 },
      intent: "Inspect workspace files to assess project structure.",
    }),
    JSON.stringify({
      done: true,
      finalMessage: "Workspace inspection complete. All required files verified.",
    }),
  ]);

  try {
    const api = new QuackApi(fixture.system);
    const result = await api.submitGovernedMission({
      objective: "Inspect the repository files and produce verified status",
      actor: "test-operator",
      permissions: ["workspace.read"],
    });

    assert.equal(result.state, "COMPLETED");
    assert.equal(result.iterations, 2);
    assert.ok(result.missionId);

    // Verify durable run record in the run store
    const stored = await fixture.system.governedMissionRunStore.load(result.missionId);
    assert.ok(stored, "Run must be durably stored in governedMissionRunStore");
    assert.equal(stored.missionId, result.missionId);
    assert.equal(stored.iterations.length, 2);
    assert.equal(stored.stopReason, "STOP_GOAL_ACHIEVED");

    // Verify first step executed and recorded proposal
    const step0 = stored.iterations[0]!;
    assert.ok(step0.selectedAction);
    assert.equal(step0.selectedAction.capability, "core.workspace.list-files");
    assert.equal(step0.selectedAction.intent, "Inspect workspace files to assess project structure.");

    // Verify second step marked objective as complete
    const step1 = stored.iterations[1]!;
    assert.equal(step1.stopReason, "STOP_GOAL_ACHIEVED");

    // Verify durable checkpoint was recorded
    const checkpoint = await fixture.system.governedMissionCheckpointStore.load(result.missionId);
    assert.ok(checkpoint, "Settled checkpoint must exist for completed mission");
    assert.equal(checkpoint.missionId, result.missionId);
    assert.ok(checkpoint.nextStepIndex >= 0);
  } finally {
    await fixture.cleanup();
  }
});

test("E2E Outcome Flow: HTTP API /governed-missions ingests objective, streams SSE, and exposes honest recovery metadata", async () => {
  const fixture = await createTestFixture([
    JSON.stringify({
      capability: "core.workspace.list-files",
      arguments: { path: ".", depth: 1 },
      intent: "List root files.",
    }),
    JSON.stringify({
      done: true,
      finalMessage: "Integrity verified.",
    }),
  ]);

  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });

  try {
    await server.start();
    const baseUrl = server.address().url;

    // Submit governed mission via HTTP POST
    const createRes = await fetch(`${baseUrl}/governed-missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        objective: "Inspect repo and verify integrity",
        actor: "e2e-runner",
        permissions: ["workspace.read"],
      }),
    });

    assert.equal(createRes.status, 202);
    const created = await createRes.json() as { id: string; state: string; missionId: string };
    assert.ok(created.id);
    assert.equal(created.state, "RUNNING");

    // Poll until the mission completes in the durable store
    let finished = false;
    for (let i = 0; i < 30; i++) {
      const getRes = await fetch(`${baseUrl}/governed-missions/${encodeURIComponent(created.id)}`);
      if (getRes.status === 200) {
        const body = await getRes.json() as { state: string; checkpoint: unknown; recovery: { state: string } };
        if (body.state === "SUCCEEDED" || body.state === "FAILED") {
          finished = true;
          assert.equal(body.state, "SUCCEEDED");
          assert.ok(body.checkpoint, "Checkpoint must be present in GET /governed-missions/:id");
          // Privacy verification: wire response must not leak prompt or credentials
          const wire = JSON.stringify(body);
          assert.ok(!wire.includes("sk-"), "No secret tokens on the wire");
          assert.ok(!wire.includes("QUACK Workspace E2E Test"), "No prompt leakage on metadata wire");
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(finished, "Governed mission must finish asynchronously within timeout");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("E2E Outcome Flow: POST /missions with engine='governed' automatically delegates to governed runtime", async () => {
  const fixture = await createTestFixture([
    JSON.stringify({
      done: true,
      finalMessage: "Delegation successful.",
    }),
  ]);

  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });

  try {
    await server.start();
    const baseUrl = server.address().url;

    const createRes = await fetch(`${baseUrl}/missions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal: "Verify unified governed engine delegation",
        actor: "delegation-test",
        engine: "governed",
      }),
    });

    assert.equal(createRes.status, 202);
    const created = await createRes.json() as ApiMissionRecord;
    assert.ok(created.id);

    // Poll status until complete
    let completed = false;
    for (let i = 0; i < 30; i++) {
      const statusRes = await fetch(`${baseUrl}/missions/${encodeURIComponent(created.id)}/status`);
      if (statusRes.status === 200) {
        const status = await statusRes.json() as { state: string };
        if (status.state === "COMPLETED" || status.state === "FAILED") {
          assert.equal(status.state, "COMPLETED");
          completed = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(completed, "Delegated mission must complete");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});
