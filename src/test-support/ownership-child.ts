/**
 * Forked child for Phase 5 multi-process recovery tests. argv:
 *   <dataDir> run-mission <crashPoint>
 *   <dataDir> resume-mission <crashPoint> {"taskId":...}
 *   <dataDir> attack-forged {"taskId":...}
 *
 * Boundary → durable-state position at crash:
 *   before-ownership          task record only (no lease, no checkpoint)
 *   after-ownership           lease held, no checkpoint yet (planning pause)
 *   during-heartbeat          lease live mid-execution (verifying pause)
 *   tool-entered             journal STARTED, side effect logged, no ack
 *   after-receipt-before-complete  receipt built, memory-write phase (finalizing)
 *
 * Messages: {type:"boundary", taskId, stage} at the crash boundary;
 * {type:"resumed", status, receiptVerified} on resume completion;
 * {type:"ownership-conflict"|"resume-rejected", code} for governed rejections.
 */
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createId, now, ok } from "../core/types.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import { JsonFileTaskStore } from "../storage/task-store.js";
import { SessionRuntime } from "../engine/session-runtime.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { SqliteConnection } from "../storage/sqlite.js";
import type { CrashPoint } from "./multi-process-recovery-types.js";

const rawArgs = process.argv.slice(2);
const dataDir = rawArgs[0];
const mode = rawArgs[1];
if (!dataDir || !mode) {
  console.error("ownership-child: bad argv");
  process.exit(2);
}
// argv: <dataDir> <mode> [crashPoint] {extra-json} — the extra JSON is
// always the LAST argument so crashPoint stays optional per mode.
const extraRaw = rawArgs[rawArgs.length - 1];
const extra = extraRaw?.startsWith("{") ? JSON.parse(extraRaw) as { taskId?: string } : {};
const crashPoint = rawArgs[2]?.startsWith("{") ? undefined : rawArgs[2] as CrashPoint | undefined;
const send = (message: object) => { process.send?.(message); };

/** Map test-facing crash points onto fixture pause stages. */
const STAGE_FOR: Record<string, string> = {
  "before-ownership": "before-ownership",
  "after-ownership": "planning",
  "during-heartbeat": "verifying",
  "tool-entered": "tool-entered",
  "after-tool-before-persist": "tool-entered",
  "after-receipt-before-complete": "finalizing",
};

/** Durable mission fixture shared by run/resume modes. */
async function fixture(boundary: string | undefined) {
  const pauseStage = boundary ? STAGE_FOR[boundary] : undefined;
  const sessions = SessionRuntime.create({ storageDir: dataDir,
    maxActiveSessions: 10, snapshotRetentionCount: 1, autoSnapshotIntervalMs: 0,
    schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 60000, queuePollIntervalMs: 1 },
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0,
  });
  const graph = new TaskGraphBuilder({ description: "Multi-process recovery fixture" }).addNode("operation", {
    description: "Observe once", tools: ["fixture.measure"],
    toolInvocations: [{ toolId: "fixture.measure", input: { path: "allowed/operation", value: 11 } }],
    timeoutMs: 60000, retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
  }).build();
  const memory = new InMemoryMemoryStore();
  const write = memory.write.bind(memory);
  memory.write = async record => { await pauseAt("finalizing"); return write(record); };

  const { QuackRuntime } = await import("../runtime/runtime.js");
  const { EventBus } = await import("../events/event-bus.js");
  const { ProviderRegistry } = await import("../providers/provider.js");
  const { ToolRegistry } = await import("../tools/tool.js");
  const { AllowListPermissionPolicy } = await import("../security/permissions.js");
  const { PermissionBackedCapabilityBroker, InMemoryCapabilityGrantRegistry } = await import("../security/capability-broker.js");

  const events = new EventBus();
  const tools = new ToolRegistry();
  const grants = new InMemoryCapabilityGrantRegistry();
  const policy = new AllowListPermissionPolicy(["workspace.read"]);
  grants.ensureGrant({ missionId: "measurement", agentId: "observer",
    capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["allowed"], toolIds: ["fixture.measure", "tool.dogfood-measure"] },
    approval: { approvedBy: "fixture", reason: "recovery test", approvedAt: now() } });

  let taskId = "";
  events.on("task.created", event => { taskId = event.taskId ?? ""; });
  let paused = false;
  const pauseAt = async (stage: string) => {
    if (pauseStage === stage && !paused) {
      paused = true;
      send({ type: "boundary", taskId, stage });
      await new Promise<void>(() => { setInterval(() => {}, 1000); }); // parent SIGKILLs us
    }
  };

  tools.register({ id: "fixture.measure", describe: () => ({ id: "fixture.measure", name: "Measure", description: "recovery fixture", permissions: ["workspace.read"], retrySafety: "READ_ONLY" }),
    execute: async (input, context) => {
      taskId = context.taskId;
      await appendFile(join(dataDir, "calls.log"), JSON.stringify({ taskId: context.taskId, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey }) + "\n");
      await pauseAt("tool-entered");
      return { output: { ...(input as object), observed: true } };
    } });
  // The dogfood mission's compiled skill uses this tool id; resume missions
  // need it registered with the SAME retrySafety so replay is retry-safe.
  tools.register({ id: "tool.dogfood-measure", describe: () => ({ id: "tool.dogfood-measure", name: "Measure", description: "dogfood fixture", permissions: ["workspace.read"], retrySafety: "READ_ONLY" }),
    execute: async (input, context) => {
      taskId = context.taskId;
      await appendFile(join(dataDir, "calls.log"), JSON.stringify({ taskId: context.taskId, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey }) + "\n");
      await pauseAt("tool-entered");
      return { output: { ...(input as object), observed: true } };
    } });

  const runtime = new QuackRuntime({ eventBus: events, memory, tools, providers: new ProviderRegistry(), permissions: policy,
    capabilityBroker: new PermissionBackedCapabilityBroker(policy, grants), missionId: "measurement", agentId: "observer",
    dataDir, ownershipLeaseMs: 600,
    sessionRuntime: sessions,
    taskStore: new JsonFileTaskStore(join(dataDir, "tasks.json")),
    planGraph: async () => {
      await pauseAt("planning");
      return ok({ id: graph.id, goal: graph.description, strategy: "fixture", taskGraph: graph,
        requiresPermissions: ["workspace.read"], riskEstimate: { level: "low", factors: [], mitigation: [] },
        costEstimate: { estimatedCostUsd: 0, estimatedDurationMs: 0, estimatedTokens: 0, confidence: 1 }, contextSummary: "", createdAt: now() }) as never;
    },
    verifyExecution: async (task, state, context) => {
      taskId = task.id;
      await appendFile(join(dataDir, "verification.log"), task.id + "\n");
      const success = Object.values(state.nodeResults).some(result => result?.success === true);
      const evidence = (context as { recoveryEvidence?: { missionId: string; executionId: string; id: string } }).recoveryEvidence;
      await pauseAt("verifying");
      return { success, reason: "The operation has durable successful evidence.",
        ...(evidence ? { record: { contractVersion: QUACK_CONTRACT_VERSION, id: `verification-${task.id}`, missionId: evidence.missionId,
          executionId: evidence.executionId, verifier: "fixture.validator", status: success ? "PASSED" as const : "FAILED" as const,
          checkedAt: now(), evidenceIds: [evidence.id], message: "The operation has durable successful evidence." } } : {}) };
    },
  });
  return { runtime, graph, sessions };
}

switch (mode) {
  case "run-mission": {
    if (crashPoint === "before-ownership") {
      // Crash position: task record persisted, ownership never acquired.
      // Create exactly that durable state, then hang for the parent kill.
      const taskStore = new JsonFileTaskStore(join(dataDir, "tasks.json"));
      const taskId = createId("task");
      const sessionId = createId("session");
      await taskStore.save({ id: taskId, goal: "Multi-process recovery fixture", status: "created",
        createdAt: now(), updatedAt: now(), plan: [], origin: "user",
        execution: { missionId: "measurement", executionId: taskId, taskId, sessionId,
          workflowId: createId("wf"), actor: "observer", agentId: "observer" } });
      send({ type: "boundary", taskId, stage: "before-ownership" });
      await new Promise<void>(() => { setInterval(() => {}, 1000); });
    }
    const { runtime, graph } = await fixture(crashPoint);
    const result = await runtime.submitGoal(graph.description, "observer");
    // Without a crash point the mission completes — the parent treats this
    // as an error for crash scenarios only.
    send({ type: "unexpected-completion", ok: result.ok });
    process.exitCode = 1;
    process.disconnect?.();
    break;
  }
  case "resume-mission": {
    const taskId = extra.taskId!;
    const { runtime } = await fixture(crashPoint);
    const result = await runtime.resumeMission(taskId);
    if (!result.ok) {
      send({ type: result.error?.code === "recovery.ownership_conflict" ? "ownership-conflict" : "resume-rejected", code: result.error?.code });
      process.disconnect?.();
      break;
    }
    const task = result.data;
    send({ type: "resumed", status: task.status, receiptVerified: Boolean((task.result as { receipt?: object } | undefined)?.receipt) });
    await runtime.shutdown().catch(() => undefined);
    process.disconnect?.();
    break;
  }
  case "attack-forged": {
    // A foreign process must not write mission state with a forged owner
    // id or a guessed epoch — the coordination store must fence it out.
    const taskId = extra.taskId!;
    const taskStore = new JsonFileTaskStore(join(dataDir, "tasks.json"));
    const task = await taskStore.get(taskId);
    if (!task?.execution) { send({ type: "attack-rejected", reason: "no execution identity" }); process.exit(0); }
    const missionId = task.execution!.missionId;
    const conn = new SqliteConnection(join(dataDir, "coordination.sqlite"));
    const { SqliteCoordinationStore } = await import("../storage/coordination.js");
    const store = new SqliteCoordinationStore(conn, { leaseMs: 600 });
    const leaseId = `mission:${missionId}`;
    try {
      // Wrong-epoch write under a forged owner name: must never be WRITTEN.
      const current = store.current(leaseId);
      for (const guessed of [(current?.version ?? 1) + 5, 1, 2, 999]) {
        const write = store.writeFenced(leaseId, "forged-owner", guessed, { evil: true });
        if (write.kind === "WRITTEN") throw new Error(`FORGED WRITE ACCEPTED at epoch ${guessed}`);
      }
      // Even a correct-epoch write under a foreign owner is rejected while
      // the real owner (or tombstone/expired lease) holds the resource.
      if (current && current.owner !== "forged-owner") {
        const write = store.writeFenced(leaseId, "forged-owner", current.version, { evil: true });
        if (write.kind === "WRITTEN") throw new Error("FOREIGN-OWNER WRITE ACCEPTED");
      }
      send({ type: "attack-rejected", reason: "fenced" });
    } catch (error) {
      send({ type: "attack-accepted", error: String(error) });
      process.exitCode = 1;
    }
    process.disconnect?.();
    break;
  }
  case "dogfood-skill": {
    // 5K end-to-end dogfood: compile a real SKILL.md into a governed
    // task graph, run it durably under ownership, crash at the tool, and
    // let the parent resume it in a second process.
    const { SafeSkillCompiler } = await import("../skills/compiler.js");
    const { QuackRuntime } = await import("../runtime/runtime.js");
    const { EventBus } = await import("../events/event-bus.js");
    const { ProviderRegistry } = await import("../providers/provider.js");
    const { ToolRegistry } = await import("../tools/tool.js");
    const { AllowListPermissionPolicy } = await import("../security/permissions.js");
    const { PermissionBackedCapabilityBroker, InMemoryCapabilityGrantRegistry } = await import("../security/capability-broker.js");

    const events = new EventBus();
    const tools = new ToolRegistry();
    const grants = new InMemoryCapabilityGrantRegistry();
    const policy = new AllowListPermissionPolicy(["workspace.read"]);
    const broker = new PermissionBackedCapabilityBroker(policy, grants);
    grants.ensureGrant({ missionId: "measurement", agentId: "observer",
      capabilities: ["permission.workspace.read"], scope: { workspacePaths: ["allowed"], toolIds: ["tool.dogfood-measure"] },
      approval: { approvedBy: "fixture", reason: "dogfood", approvedAt: now() } });

    let taskId = "";
    events.on("task.created", event => { taskId = event.taskId ?? ""; });
    let paused = false;
    const pauseAt = async (stage: string) => {
      if (stage === "tool-entered" && !paused) {
        paused = true;
        send({ type: "boundary", taskId, stage });
        await new Promise<void>(() => { setInterval(() => {}, 1000); });
      }
    };

    // Register the dogfood tool with identical retrySafety in BOTH the
    // dogfood registry and the shared fixture (resume-mission uses the
    // fixture registry; retry-safe replay requires same-id+same-safety).
    tools.register({ id: "tool.dogfood-measure", describe: () => ({ id: "tool.dogfood-measure", name: "Measure", description: "dogfood fixture", permissions: ["workspace.read"], retrySafety: "READ_ONLY" }),
      execute: async (input, context) => {
        taskId = context.taskId;
        await appendFile(join(dataDir, "calls.log"), JSON.stringify({ taskId: context.taskId, attemptId: context.attemptId }) + "\n");
        await pauseAt("tool-entered");
        return { output: { ...(input as object), observed: true } };
      } });

    const compiler = new SafeSkillCompiler(tools);
    const compiled = await compiler.compileSkillMarkdown(`
# Recovery dogfood skill
## Description
Observe one durable measurement across a process crash.
## Tools
- tool.dogfood-measure
## Steps
1. observe: use tool.dogfood-measure path=allowed/dogfood value=42
`, { skillId: "recovery.dogfood", version: "1.0.0", sourceId: "skills/dogfood/SKILL.md", allowedPermissions: ["workspace.read"] });
    if (!compiled.definition || !compiled.plan) {
      send({ type: "error", error: "compile failed: " + JSON.stringify(compiled.diagnostics) });
      process.exit(1);
    }
    send({ type: "compiled", skillId: compiled.plan.skillId, steps: compiled.plan.steps.length });

    // Governed graph materialized from the compiled plan IR: every node
    // is the skill's step with its resolved tool invocation.
    const graphBuilder = new TaskGraphBuilder({ description: compiled.plan.name });
    for (const step of compiled.plan.steps) {
      graphBuilder.addNode(step.id, {
        description: step.intent, tools: [step.resolvedTool?.id ?? step.candidateTool ?? "tool.dogfood-measure"],
        toolInvocations: step.resolvedTool || step.candidateTool
          ? [{ toolId: step.resolvedTool?.id ?? step.candidateTool!, input: structuredClone(step.inputs) as import("../core/types.js").JsonObject }]
          : [],
        dependencies: [...step.dependencies],
        timeoutMs: step.timeoutRequestMs ?? 60000,
        retryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
      });
    }
    const skillGraph = graphBuilder.build();

    const sessions = SessionRuntime.create({ storageDir: dataDir,
      maxActiveSessions: 10, snapshotRetentionCount: 1, autoSnapshotIntervalMs: 0,
      schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 60000, queuePollIntervalMs: 1 },
      defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0,
    });
    const runtime = new QuackRuntime({ eventBus: events, memory: new InMemoryMemoryStore(), tools,
      providers: new ProviderRegistry(), permissions: policy, capabilityBroker: broker,
      missionId: "measurement", agentId: "observer", dataDir, ownershipLeaseMs: 600,
      sessionRuntime: sessions, taskStore: new JsonFileTaskStore(join(dataDir, "tasks.json")),
      planGraph: async () => ok({ id: skillGraph.id, goal: skillGraph.description, strategy: "compiled-skill", taskGraph: skillGraph,
        requiresPermissions: ["workspace.read"], riskEstimate: { level: "low", factors: [], mitigation: [] },
        costEstimate: { estimatedCostUsd: 0, estimatedDurationMs: 0, estimatedTokens: 0, confidence: 1 },
        contextSummary: "Compiled from skills/dogfood/SKILL.md", createdAt: now() }) as never,
      verifyExecution: async (task, state, context) => {
        const success = state.nodeResults.observe?.success === true;
        const evidence = (context as { recoveryEvidence?: { missionId: string; executionId: string; id: string } }).recoveryEvidence;
        return { success, reason: "Durable dogfood observation verified.",
          ...(evidence ? { record: { contractVersion: QUACK_CONTRACT_VERSION, id: `verification-${task.id}`, missionId: evidence.missionId,
            executionId: evidence.executionId, verifier: "dogfood.validator", status: success ? "PASSED" as const : "FAILED" as const,
            checkedAt: now(), evidenceIds: [evidence.id], message: "Durable dogfood observation verified." } } : {}) };
      },
    });
    const result = await runtime.submitGoal(compiled.plan.description, "observer");
    send({ type: "unexpected-completion", ok: result.ok });
    process.exitCode = 1;
    process.disconnect?.();
    break;
  }
  default:
    send({ type: "error", error: `unknown mode ${mode}` });
    process.exit(2);
}

void fileURLToPath;
