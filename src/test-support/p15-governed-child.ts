/**
 * P15 (ADR 0049) multi-process test child: exercises the governed mission
 * loop's coordination behavior across REAL process boundaries. Modes:
 *
 *   resume     — attempt loop.run() resume of a seeded non-terminal mission;
 *                reports "resumed" | "ownership-conflict" | "error".
 *   hold-lease — acquire the mission lease with a short TTL and pause,
 *                letting the parent SIGKILL mid-lease (crash fixture).
 *   run-crash  — run a REAL governed mission (stub model proposes one tool
 *                step, then done) and die at a named crash boundary via
 *                process.exit before/after the boundary's durable write.
 *                Reports the boundary reached, then exits.
 *   verify     — load durable records (run store + journal + approvals)
 *                and report their states (read-only inspection).
 *
 * The child builds a minimal governed loop (denied model runtime is fine:
 * resume paths reconcile durable records before any model dispatch) wired
 * to the SHARED dataDir and coordination DB, exactly like the production
 * composition (swe-system) wires them.
 */
import { join } from "node:path";
import { EventBus } from "../events/event-bus.js";
import { AllowListPermissionPolicy } from "../security/permissions.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { ToolRegistry, EchoTool } from "../tools/tool.js";
import { ActionProviderRegistry, ActionRuntime } from "../actions/runtime.js";
import { InMemoryActionExecutionLedger } from "../actions/ledger.js";
import { GovernedMissionLoop } from "../runtime/mission-lifecycle/governed-mission-loop.js";
import { JsonFileMissionRunStore } from "../runtime/mission-lifecycle/mission-run-store.js";
import { JsonFileStepAttemptJournal } from "../runtime/mission-lifecycle/step-attempt-journal.js";
import { JsonFileMissionCheckpointStore } from "../runtime/mission-lifecycle/mission-recovery.js";
import { JsonFileApprovalStore, DurableApprovalRunner } from "../runtime/mission-lifecycle/approval-store.js";
import { DenyApprovalRunnerCallback, ApprovalRunner } from "../runtime/mission-lifecycle/approval-contract.js";
import { MissionOwnershipGuard } from "../runtime/ownership.js";
import { SqliteConnection } from "../storage/sqlite.js";
import { createLoopRun } from "../runtime/mission-lifecycle/executive-loop.js";
import { stepAttemptKey } from "../runtime/mission-lifecycle/step-attempt-journal.js";
import type { Permission } from "../security/permissions.js";
import type { JsonObject } from "../core/types.js";
import type { ModelRequest, ModelResponse } from "../models/runtime.js";
import type { QuackResult } from "../core/types.js";

class QuietEchoTool extends EchoTool {
  describe(): import("../tools/tool.js").ToolMetadata {
    return { id: this.id, name: "Quiet Echo", description: "echo", permissions: ["workspace.read"] };
  }
}

/** Destructive fixture provider: parks inside the approval callback. */
function destructiveDescriptorProvider() {
  const descriptor = {
    contractVersion: "1.0.0", id: "fixture.destructive", providerId: "fixture",
    name: "Destructive", description: "destructive fixture",
    inputSchema: { type: "object" }, riskClass: "DESTRUCTIVE", sideEffect: "destructive",
    externalCommunication: false, financialImpact: false, authenticationScopes: [],
    requiredPermissions: ["workspace.write"], idempotent: false, supportsDryRun: false,
    supportsCompensation: false, timeoutMs: 10_000, dataClassification: "public",
    networkRequirements: [], approval: "NEVER",
  };
  return {
    metadata: () => ({ contractVersion: "1.0.0", providerId: "fixture", displayName: "Fixture", transport: "local", boundary: "local" }),
    health: async () => ({ status: "HEALTHY", checkedAt: new Date().toISOString() }),
    discoverActions: async () => [descriptor],
    execute: async () => ({ executionId: "e", providerId: "fixture", actionId: "fixture.destructive", status: "SUCCEEDED", output: { destroyed: true }, evidenceIds: [] }),
  };
}

function deniedModel() {
  return {
    async generate(_request: ModelRequest): Promise<QuackResult<ModelResponse>> {
      return { ok: false, error: { code: "model.unavailable", message: "child fixture: no model", category: "provider", recoverable: true } };
    },
  };
}

/** Scripted model: propose one echo-tool step, then declare done. */
function scriptedModel(scripts: readonly string[]) {
  let call = 0;
  return {
    async generate(_request: ModelRequest): Promise<QuackResult<ModelResponse>> {
      const text = scripts[Math.min(call, scripts.length - 1)] ?? "";
      call += 1;
      return { ok: true, data: { id: `resp_${call}`, providerId: "stub", model: "stub-model", text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 1, fallbackUsed: false } };
    },
  };
}

const PROPOSAL_STEP0 = JSON.stringify({
  capability: "core.echo",
  arguments: { message: "p15-crash-matrix" },
  intent: "echo once",
});
const PROPOSAL_DONE = JSON.stringify({ done: true, finalMessage: "matrix complete" });

/**
 * Crash boundaries in the REAL dispatch order. The child signals "boundary"
 * to the parent right BEFORE performing the named durable action, then
 * dies on the parent's SIGKILL.
 */
type CrashBoundary =
  | "before-proposal-persist"   // before the run record exists at all (fresh mission, nothing written)
  | "after-proposal-persist"    // run record saved with 0 iterations (admission complete)
  | "after-reservation"         // journal DISPATCHING written, execution not started
  | "after-execution";          // harness returned, journal not yet settled

function buildLoop(
  dataDir: string,
  leaseMs: number,
  model: ReturnType<typeof deniedModel> | ReturnType<typeof scriptedModel>,
  options: { approvalStore?: boolean } = {},
) {
  const events = new EventBus();
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"] as readonly Permission[]), grants);
  const tools = new ToolRegistry();
  tools.register(new QuietEchoTool());
  const actionProviders = new ActionProviderRegistry();
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: new InMemoryActionExecutionLedger(),
    validateExecutionContext: () => ({ allowed: true, reason: "test" }),
    decidePermission: async () => ({ allowed: true, reason: "test policy" }),
  });
  const approvalStore = options.approvalStore ? new JsonFileApprovalStore(dataDir) : undefined;
  const approvalRunner = approvalStore
    ? new DurableApprovalRunner(approvalStore, new DenyApprovalRunnerCallback(), { events })
    : new ApprovalRunner(new DenyApprovalRunnerCallback());
  const loop = new GovernedMissionLoop({
    broker,
    actionRuntime,
    actionProviders,
    tools,
    modelRuntime: model as never,
    events,
    executeTool: async (toolId, input) => {
      const tool = tools.get(toolId);
      if (!tool.ok) return tool as QuackResult<JsonObject>;
      const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
      return { ok: true, data: result.output as JsonObject };
    },
    runStore: new JsonFileMissionRunStore(dataDir),
    stepJournal: new JsonFileStepAttemptJournal(dataDir),
    checkpointStore: new JsonFileMissionCheckpointStore(dataDir),
    coordinationDbPath: join(dataDir, "coordination.sqlite"),
    ownershipLeaseMs: leaseMs,
    ...(approvalStore ? { approvalStore } : {}),
    ...(approvalRunner ? { approvalRunner } : {}),
  });
  return { loop, events, grants };
}

async function main(): Promise<void> {
  const [dataDir, mode, extraRaw] = process.argv.slice(2) as [string, string, string | undefined];
  const extra = (extraRaw ? JSON.parse(extraRaw) : {}) as { missionId?: string; leaseMs?: string; boundary?: string };
  const missionId = extra.missionId ?? "m-child";
  const leaseMs = Number(extra.leaseMs ?? 30_000);
  const boundary = extra.boundary as CrashBoundary | undefined;

  if (mode === "hold-lease") {
    // Acquire the exact lease the loop would take, with the given TTL, and
    // pause holding it (no heartbeat) — the parent SIGKILLs this process.
    const guard = new MissionOwnershipGuard(new SqliteConnection(join(dataDir, "coordination.sqlite")), { leaseMs });
    const outcome = guard.acquire(`governed:${missionId}`);
    if (outcome.kind !== "ACQUIRED") {
      process.send?.({ type: "lease-conflict" });
      return;
    }
    process.send?.({ type: "lease-held", missionId });
    // Hold until killed; the unref'd timer keeps nothing alive.
    await new Promise(() => {});
    return;
  }

  if (mode === "verify") {
    // Read-only durable-record inspection for the parent's assertions.
    const runStore = new JsonFileMissionRunStore(dataDir);
    const journal = new JsonFileStepAttemptJournal(dataDir);
    const run = await runStore.load(missionId).catch(() => undefined);
    const attempts = await journal.listByMission(missionId).catch(() => []);
    process.send?.({
      type: "verified",
      runExists: run !== undefined,
      stopReason: run?.stopReason ?? null,
      currentState: run?.currentState ?? null,
      iterations: run?.iterations.length ?? 0,
      attempts: attempts.map((a) => ({ key: a.attemptKey, state: a.state })),
    });
    return;
  }

  if (mode === "run-crash") {
    // Deterministic crash windows over the REAL loop, driven by durable
    // artifacts the parent verifies after restart. The parent SIGKILLs this
    // process right after receiving the "boundary" message, so each
    // boundary is a real pre-kill durable state:
    //   before-proposal-persist — nothing written yet.
    //   after-proposal-persist  — admission + run record written; the model
    //                             parks forever before any step executes.
    //   after-reservation       — signal on mission.action.proposed; the
    //                             kill lands between reservation and
    //                             settlement (DISPATCHING on disk).
    //   after-execution         — signal on mission.action.completed; the
    //                             kill lands in the post-harness window
    //                             (before/during journal settlement).
    if (boundary === "before-proposal-persist") {
      process.send?.({ type: "boundary", boundary, missionId });
      await new Promise(() => {});
      return;
    }
    if (boundary === "after-proposal-persist") {
      const parking = {
        async generate(): Promise<QuackResult<ModelResponse>> {
          process.send?.({ type: "boundary", boundary, missionId });
          await new Promise(() => {});
          return { ok: false, error: { code: "x", message: "x", category: "provider", recoverable: false } };
        },
      };
      const { loop: parkingLoop, grants: g2 } = buildLoop(dataDir, leaseMs, parking as never);
      g2.ensureGrant({
        missionId,
        capabilities: ["permission.workspace.read"],
        approval: { approvedBy: "test-standing-consent", reason: "child fixture grant", approvedAt: new Date().toISOString() },
      });
      void parkingLoop.run({ missionId, objective: "crash after proposal persistence" }).catch(() => undefined);
      await new Promise(() => {});
      return;
    }
    if (boundary === "after-reservation" || boundary === "after-execution") {
      const base = buildLoop(dataDir, leaseMs, scriptedModel([PROPOSAL_STEP0, PROPOSAL_DONE]), {});
      // Deterministic boundary: wrap the journal so the signal fires at the
      // EXACT durable write under test (after reserve / after settle attempt),
      // never racing an in-process statement.
      const inner: import("../runtime/mission-lifecycle/step-attempt-journal.js").StepAttemptJournal = base.loop["stepJournal"];
      const wrapped: import("../runtime/mission-lifecycle/step-attempt-journal.js").StepAttemptJournal = {
        reserve: async (attempt) => {
          const reserved = await inner.reserve(attempt);
          if (reserved) process.send?.({ type: "boundary", boundary: "after-reservation", missionId });
          return reserved;
        },
        settle: async (key, settlement) => {
          if (boundary === "after-execution") process.send?.({ type: "boundary", boundary: "after-execution", missionId });
          return inner.settle(key, settlement);
        },
        release: (key, provenance) => inner.release(key, provenance),
        resolveAmbiguous: (key, resolution) => inner.resolveAmbiguous(key, resolution),
        load: (key) => inner.load(key),
        listByMission: (missionId) => inner.listByMission(missionId),
        reconcileOrphans: (missionId) => inner.reconcileOrphans(missionId),
      };
      (base.loop as unknown as { stepJournal: unknown })["stepJournal"] = wrapped;
      const instrumented = base;
      instrumented.events.onAny((event) => {
        if (boundary === "after-execution" && (event.type === "mission.action.completed" || event.type === "mission.action.failed")) {
          process.send?.({ type: "boundary", boundary, missionId });
        }
      });
      instrumented.grants.ensureGrant({
        missionId,
        capabilities: ["permission.workspace.read"],
        approval: { approvedBy: "test-standing-consent", reason: "child fixture grant", approvedAt: new Date().toISOString() },
      });
      void instrumented.loop.run({ missionId, objective: `crash ${boundary}` }).catch(() => undefined);
      await new Promise(() => {});
      return;
    }
    // No boundary: run to completion (parent uses for clean-restart cases).
    const { loop, grants } = buildLoop(dataDir, leaseMs, scriptedModel([PROPOSAL_STEP0, PROPOSAL_DONE]));
    grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "test-standing-consent", reason: "child fixture grant", approvedAt: new Date().toISOString() },
    });
    const result = await loop.run({ missionId, objective: "complete" });
    process.send?.({ type: result.ok ? "resumed" : "failed", status: result.ok ? result.data.finalState : result.error?.code });
    return;
  }

  if (mode === "wait-approval") {
    // Crash boundary 13 (during WAITING_APPROVAL): the destructive
    // approval gate is a HARNESS seam (the loop's model-proposal channel
    // cannot carry destructive risk in v1 — the parser derives risk from
    // the trusted descriptor and the harness fails closed without a
    // verification strategy). This mirrors the P14.R18b fixture shape:
    // journal.reserve → harness.execute → approval gate → HANG inside the
    // durable callback. Durable state at kill: PENDING approval request +
    // DISPATCHING journal reservation.
    const { createProposal } = await import("../runtime/mission-lifecycle/action-contract.js");
    const { DefaultExecutionHarness } = await import("../runtime/mission-lifecycle/harness.js");
    const parkingCallback = {
      async requestDecision(): Promise<import("../runtime/mission-lifecycle/approval-contract.js").ApprovalCallbackDecision> {
        process.send?.({ type: "boundary", boundary: "waiting-approval", missionId });
        await new Promise(() => {});
        return { approved: false, approver: "never-reached", reason: "hung" };
      },
    };
    const events = new EventBus();
    const grants = new InMemoryCapabilityGrantRegistry();
    const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy((["workspace.read", "workspace.write"]) as readonly Permission[]), grants);
    const tools = new ToolRegistry();
    tools.register(new QuietEchoTool());
    const actionProviders = new ActionProviderRegistry();
    actionProviders.register(destructiveDescriptorProvider() as never);
    const actionRuntime = new ActionRuntime(actionProviders, {
      ledger: new InMemoryActionExecutionLedger(),
      validateExecutionContext: () => ({ allowed: true, reason: "test" }),
      decidePermission: async () => ({ allowed: true, reason: "test policy" }),
    });
    const approvalStore = new JsonFileApprovalStore(dataDir);
    const approvalRunner = new DurableApprovalRunner(approvalStore, parkingCallback, { events });
    const harness = new DefaultExecutionHarness(actionRuntime, broker, actionProviders, tools, events, {
      defaultTimeoutMs: 10_000, requireVerificationForIrreversible: true, approvalRunner,
      executeTool: async (toolId, input) => {
        const tool = tools.get(toolId);
        if (!tool.ok) return tool as QuackResult<JsonObject>;
        const result = await tool.data.execute(input as never, { taskId: "t", actor: "test" });
        return { ok: true, data: result.output as JsonObject };
      },
    });
    grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read", "permission.workspace.write"],
      approval: { approvedBy: "test-standing-consent", reason: "child fixture grant", approvedAt: new Date().toISOString() },
    });
    const journal = new JsonFileStepAttemptJournal(dataDir);
    await journal.reserve({ attemptKey: stepAttemptKey(missionId, 0, "fixture.destructive"), missionId, stepIndex: 0, capability: "fixture.destructive", executionId: "exec-wa" });
    const proposal = createProposal({
      missionId, capability: "fixture.destructive", arguments: { target: "p15-dataset" },
      intent: "destroy the fixture dataset under approval", riskLevel: "DESTRUCTIVE",
      sandbox: "IN_PROCESS_TRUSTED", idempotencyKey: "p15-destructive", timeoutMs: 5_000,
      selectionReason: "child fixture", proposedBy: "p15-child",
      verificationStrategy: { kind: "trust_executed", reason: "fixture: no probe runner in the child" },
    });
    void harness.execute(proposal, { missionId, runId: "run-wa", iterationId: "it-wa", actor: "p15-child", stepIndex: 0, signal: new AbortController().signal }).catch(() => undefined);
    await new Promise(() => {});
    return;
  }

  if (mode === "recover-ambiguous") {
    // Crash boundary 14/15 (during RECOVERING / AMBIGUOUS handling): a REAL
    // resume over a seeded AMBIGUOUS journal record. The parent SIGKILLs
    // while this process holds the recovery lease and is mid-reconciliation
    // (the trusted probe path is absent in the child, so the attempt stays
    // AMBIGUOUS — exactly the parked semantics under test). Signals the
    // boundary once the resume path is entered.
    const runStore = new JsonFileMissionRunStore(dataDir);
    const journal = new JsonFileStepAttemptJournal(dataDir);
    if (!(await runStore.load(missionId).catch(() => undefined))) {
      const seeded: import("../runtime/mission-lifecycle/executive-loop.js").LoopRun = {
        ...createLoopRun({ missionId, goal: "ambiguous recovery", actor: "test", budget: { maxIterations: 8 } }),
        currentState: "RUNNING",
      } as never;
      await runStore.save(seeded as never);
      await journal.reserve({ attemptKey: stepAttemptKey(missionId, 0, "capAmb"), missionId, stepIndex: 0, capability: "capAmb", executionId: "exec-amb" });
      await journal.settle(stepAttemptKey(missionId, 0, "capAmb"), { state: "AMBIGUOUS", executionState: "EXECUTION_AMBIGUOUS" });
    }
    const { loop } = buildLoop(dataDir, leaseMs, deniedModel());
    // Deterministic boundary: signal right before run() enters the resume
    // path (the seeded AMBIGUOUS record forces the recovery branch).
    process.send?.({ type: "boundary", boundary: "recovering", missionId });
    const result = await (loop as { run(input: { missionId: string; objective: string }): Promise<{ ok: boolean }> }).run({ missionId, objective: "recover ambiguous" });
    process.send?.({ type: result.ok ? "resumed" : "failed", status: String(result.ok) });
    return;
  }

  if (mode === "settle") {
    // Crash boundary 11/12 helper: run to completion, then report final
    // durable state — the parent kills mid-settlement via "after-execution".
    const { loop, grants } = buildLoop(dataDir, leaseMs, scriptedModel([PROPOSAL_STEP0, PROPOSAL_DONE]));
    grants.ensureGrant({
      missionId,
      capabilities: ["permission.workspace.read"],
      approval: { approvedBy: "test-standing-consent", reason: "child fixture grant", approvedAt: new Date().toISOString() },
    });
    const result = await loop.run({ missionId, objective: "settle" });
    process.send?.({ type: result.ok ? "resumed" : "failed", status: result.ok ? result.data.finalState : result.error?.code });
    return;
  }

  if (mode === "resume") {
    const { loop } = buildLoop(dataDir, leaseMs, deniedModel());
    try {
      const result = await loop.run({ missionId, objective: "resume objective" });
      if (result.ok) {
        process.send?.({ type: "resumed", status: result.data.finalState });
      } else if (result.error?.code === "mission.ownership_busy") {
        process.send?.({ type: "ownership-conflict", code: result.error.code, message: result.error.message });
      } else {
        process.send?.({ type: "resumed-other", code: result.error?.code, message: result.error?.message });
      }
    } catch (error) {
      process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  process.send?.({ type: "unknown-mode", mode });
}

main().catch((error) => {
  process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
