import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionRuntime } from "../engine/session-runtime.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { canonicalFixture } from "./canonical-runtime.js";
import type { RetrySafety } from "../engine/execution-recovery.js";
import { now, ok } from "../core/types.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import { JsonFileTaskStore } from "../storage/task-store.js";

export type CrashBoundary = "planning" | "planned" | "node-started" | "tool-entered" | "acknowledged" | "verifying" | "finalizing";

export function recoveryFixture(dataDir: string, options: {
  safety?: RetrySafety;
  boundary?: CrashBoundary;
  pause?: (taskId: string) => Promise<void>;
  failAttempts?: number;
  maxRetries?: number;
  omitRuntimeDataDir?: boolean;
} = {}) {
  let taskId = "";
  let paused = false;
  let attempts = 0;
  const pause = async (boundary: CrashBoundary) => {
    if (!paused && options.boundary === boundary && options.pause) {
      paused = true;
      await options.pause(taskId);
    }
  };
  const sessions = SessionRuntime.create({ storageDir: dataDir,
    maxActiveSessions: 10, snapshotRetentionCount: 1, autoSnapshotIntervalMs: 0,
    schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 60000, queuePollIntervalMs: 1 },
    defaultRetryPolicy: { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 }, checkpointInterval: 0,
    onTransition: async state => { taskId = state.planId; if (state.runningNodes.length) await pause("node-started"); },
  });
  const initialize = sessions.initializeExecution.bind(sessions);
  sessions.initializeExecution = async (...args) => {
    const checkpoint = await initialize(...args);
    taskId = checkpoint.planId;
    await pause("planned");
    return checkpoint;
  };
  const update = sessions.updateExecution.bind(sessions);
  sessions.updateExecution = async (...args) => {
    const checkpoint = await update(...args);
    taskId = checkpoint.planId;
    if (checkpoint.recovery?.invocations.some(record => record.status === "COMPLETED")) await pause("acknowledged");
    return checkpoint;
  };
  const graph = new TaskGraphBuilder({ description: "Persist one observed operation" }).addNode("operation", {
    description: "Observe once", tools: ["fixture.measure"],
    toolInvocations: [{ toolId: "fixture.measure", input: { path: "allowed/operation", value: 7 } }],
    timeoutMs: 60000, retryPolicy: { maxRetries: options.maxRetries ?? 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 },
  }).build();
  const memory = new InMemoryMemoryStore();
  const write = memory.write.bind(memory);
  memory.write = async record => { await pause("finalizing"); return write(record); };
  const fixture = canonicalFixture({ graph,
    execute: async (input, context) => {
      taskId = context.taskId;
      await appendFile(join(dataDir, "calls.log"), JSON.stringify({ taskId, attemptId: context.attemptId, idempotencyKey: context.idempotencyKey }) + "\n");
      await pause("tool-entered");
      attempts++;
      if (attempts <= (options.failAttempts ?? 0)) throw new Error("transient fixture failure");
      return { ...input, observed: true };
    },
    overrides: { sessionRuntime: sessions, memory,
      // Single-process recovery suite: multi-process ownership is a
      // separate Phase 5 layer with its own multi-process test suite.
      disableOwnership: true,
      ...(options.omitRuntimeDataDir ? { taskStore: new JsonFileTaskStore(join(dataDir, "tasks.json")) } : { dataDir }),
      planGraph: async () => {
        await pause("planning");
        return ok({ id: graph.id, goal: graph.description, strategy: "Recovery fixture", taskGraph: graph,
          requiresPermissions: ["workspace.read"], riskEstimate: { level: "low", factors: [], mitigation: [] },
          costEstimate: { estimatedCostUsd: 0, estimatedDurationMs: 0, estimatedTokens: 0, confidence: 1 },
          contextSummary: "", createdAt: now() });
      },
      verifyExecution: async (task, state, context) => {
        taskId = task.id;
        await appendFile(join(dataDir, "verification.log"), task.id + "\n");
        await pause("verifying");
        const success = state.nodeResults.operation?.success === true;
        const evidence = context.recoveryEvidence;
        return { success, reason: "The operation has durable successful evidence.", ...(evidence ? { record: {
          contractVersion: QUACK_CONTRACT_VERSION, id: `verification-${task.id}`, missionId: evidence.missionId,
          executionId: evidence.executionId, verifier: "fixture.validator", status: success ? "PASSED" as const : "FAILED" as const,
          checkedAt: now(), evidenceIds: [evidence.id], message: "The operation has durable successful evidence.",
        } } : {}) };
      },
    },
  });
  const registered = fixture.tools.get("fixture.measure");
  if (!registered.ok) throw new Error("Missing fixture tool");
  const describe = registered.data.describe.bind(registered.data);
  registered.data.describe = () => ({ ...describe(), retrySafety: options.safety ?? "READ_ONLY" });
  fixture.events.on("task.created", event => { taskId = event.taskId ?? ""; });
  return { ...fixture, sessions };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , dataDir, boundary, safety] = process.argv;
  const fixture = recoveryFixture(dataDir, { boundary: boundary as CrashBoundary, safety: safety as RetrySafety,
    pause: async taskId => {
      process.send?.({ type: "boundary", taskId });
      await new Promise<void>(() => { setInterval(() => {}, 1000); });
    },
  });
  fixture.runtime.submitGoal(fixture.graph.description, "observer").then(
    result => { process.send?.({ type: "unexpected-completion", ok: result.ok }); process.exitCode = 1; process.disconnect?.(); },
    error => { process.send?.({ type: "fixture-error", message: String(error) }); process.exitCode = 1; process.disconnect?.(); },
  );
}
