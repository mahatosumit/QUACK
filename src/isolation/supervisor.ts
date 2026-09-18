import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { EventBus } from "../events/event-bus.js";
import type { JsonObject } from "../core/types.js";
import { IsolationBackendRegistry, type BackendResolution } from "./backend-resolver.js";
import type { IsolationProfile, IsolationRequest, IsolationResult, IsolatedWorkload } from "./contract.js";
import { validateIsolationProfile } from "./contract.js";
import {
  createExecutionEvidence, evidenceMatchesIdentity,
  type CleanupStatus, type ExecutionEvidenceFacts, type ExecutionEvidenceIdentity,
  type ExecutionEvidenceRecord, type ExecutionEvidenceVerification,
} from "./execution-evidence.js";

/**
 * P13 (ADR 0047): trusted execution supervisor for isolated workloads.
 *
 * The supervisor owns the isolated lifecycle on behalf of the TRUSTED
 * runtime: construct the trusted request → resolve a backend (fail-closed)
 * → create the isolated environment → launch → enforce timeout → contain
 * output → collect runtime evidence → terminate → cleanup → produce
 * identity-bound evidence. The WORKLOAD can never control its own final
 * execution state: every terminal fact in the evidence is supervisor-
 * observed.
 *
 * The supervisor is NOT an authorization authority: callers must already
 * hold a CapabilityBroker grant. It refuses to execute when backend
 * resolution fails — UNRESOLVED denies, never downgrades.
 */

export interface IsolationSupervisorOptions {
  /** Trusted backend registry (deployer-registered; never model-selected). */
  readonly registry: IsolationBackendRegistry;
  /** Existing event bus — metadata-only events. */
  readonly events: EventBus;
  /** Actor identity for events/audit. */
  readonly actor?: string;
  /** Trusted workspace root under which isolated workspaces are created. */
  readonly workspaceRoot: string;
  /** Evidence sink; in-memory default when omitted. */
  readonly evidenceStore?: {
    save(record: ExecutionEvidenceRecord): Promise<void>;
    load(executionId: string): Promise<ExecutionEvidenceRecord | undefined>;
  };
}

/** Terminal supervisor outcome for one isolated execution. */
export interface SupervisedExecution {
  readonly status: "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "CANCELLED" | "DENIED";
  readonly output?: JsonObject;
  readonly error?: string;
  readonly evidence: ExecutionEvidenceRecord;
  /** Backend that actually ran the workload ("none" when denied before launch). */
  readonly backendId: string;
}

export class IsolationSupervisor {
  /** Trusted workspace root under which isolated workspaces are created (read-only surface). */
  readonly workspaceRoot: string;

  constructor(private readonly options: IsolationSupervisorOptions) {
    this.workspaceRoot = options.workspaceRoot;
  }

  /**
   * Execute an ALREADY-AUTHORIZED workload under isolation. `requiredLevel`
   * comes from TRUSTED policy configuration only — never model output.
   */
  async execute(input: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly executionId: string;
    readonly requiredLevel: IsolationProfile["level"];
    readonly profile: Omit<IsolationProfile, "level">;
    readonly workload: IsolatedWorkload;
    /** Trusted adapter metadata (source directory for entry materialization). */
    readonly sourceDirectory?: string;
    readonly signal?: AbortSignal;
  }): Promise<SupervisedExecution> {
    const startedAt = new Date().toISOString();
    const profile: IsolationProfile = { ...input.profile, level: input.requiredLevel };
    validateIsolationProfile(profile);

    // Workspace policy (two TRUSTED modes):
    // - Adapter-backed (sourceDirectory provided): a fresh isolated dir is
    //   created UNDER the trusted workspace root per execution; only the
    //   registered entry file is materialized into it. The workload's
    //   writable world is exactly this directory, and it is removed on every
    //   terminal path.
    // - Caller-managed (no sourceDirectory): the profile's workspace root IS
    //   the governed workspace (the caller constructed it); execution runs
    //   against it directly and the supervisor never deletes caller state.
    let isolatedRoot: string | undefined;
    let effectiveRoot = profile.filesystem.workspaceRoot;
    if (input.workload.kind === "module" && input.sourceDirectory) {
      isolatedRoot = await mkdtemp(join(this.options.workspaceRoot, "quack-isolated-"));
      const materialized = await materializeEntry(input.sourceDirectory, input.workload.entry, isolatedRoot);
      if (!materialized.ok) {
        await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
        const deniedEvidence = createExecutionEvidence({
          identity: this.identity(input, "none"),
          facts: {
            startedAt, completedAt: new Date().toISOString(),
            exitState: "FAILED",
            // Metadata-only: raw fs error paths are redacted out of the
            // reason before it can reach events/audit surfaces.
            terminationReason: `entry materialization failed: ${redactPath(materialized.reason)}`,
            isolationLevel: input.requiredLevel,
            backendGuarantees: {},
          },
          cleanup: "CLEANED",
          verification: { state: "SKIPPED", probesRun: [], checkedAt: new Date().toISOString() },
        });
        await this.saveEvidence(deniedEvidence).catch(() => undefined);
        return { status: "DENIED", error: `Workload entry cannot be materialized: ${redactPath(materialized.reason)}`, evidence: deniedEvidence, backendId: "none" };
      }
      effectiveRoot = isolatedRoot;
    }

    const resolution: BackendResolution = await this.options.registry.resolve(input.requiredLevel, { ...profile, filesystem: { ...profile.filesystem, workspaceRoot: effectiveRoot } });
    if (resolution.kind !== "RESOLVED") {
      await this.options.events.emit("isolation.unresolved", {
        missionId: input.missionId, capability: input.capability, requiredLevel: input.requiredLevel,
        reason: resolution.reason,
      }, { actor: this.options.actor ?? "isolation-supervisor" }).catch(() => undefined);
      const deniedEvidence = createExecutionEvidence({
        identity: this.identity(input, "none"),
        facts: {
          startedAt, completedAt: new Date().toISOString(),
          exitState: "UNSUPPORTED",
          terminationReason: `isolation unresolved: ${resolution.reason}`,
          isolationLevel: input.requiredLevel,
          backendGuarantees: {},
        },
        cleanup: "CLEANED",
        verification: { state: "SKIPPED", probesRun: [], checkedAt: new Date().toISOString(), summary: "denied before launch" },
      });
      await this.saveEvidence(deniedEvidence).catch(() => undefined);
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
      return { status: "DENIED", error: `Isolation requirement '${input.requiredLevel}' cannot be satisfied: ${resolution.reason}`, evidence: deniedEvidence, backendId: "none" };
    }

    const backend = resolution.backend;
    await this.options.events.emit("isolation.backend_selected", {
      missionId: input.missionId, capability: input.capability, backendId: backend.id, level: input.requiredLevel,
    }, { actor: this.options.actor ?? "isolation-supervisor" }).catch(() => undefined);

    const request: IsolationRequest = {
      missionId: input.missionId,
      taskId: input.executionId,
      executionId: input.executionId,
      actor: this.options.actor ?? "isolation-supervisor",
      profile: { ...profile, filesystem: { ...profile.filesystem, workspaceRoot: effectiveRoot } },
      workload: input.workload,
      signal: input.signal,
    };

    await this.options.events.emit("execution.isolation_ready", {
      missionId: input.missionId, executionId: input.executionId, backendId: backend.id,
    }, { actor: this.options.actor ?? "isolation-supervisor" }).catch(() => undefined);

    let result: IsolationResult;
    try {
      result = await backend.execute(request);
    } catch (error) {
      // A backend that THROWS leaves external state unknown: AMBIGUOUS-class
      // treatment — fail closed, evidence records the throw honestly.
      const thrownEvidence = createExecutionEvidence({
        identity: this.identity(input, backend.id),
        facts: {
          startedAt, completedAt: new Date().toISOString(),
          exitState: "FAILED",
          terminationReason: `backend threw: ${error instanceof Error ? error.message : String(error)}`,
          isolationLevel: input.requiredLevel,
          backendGuarantees: { ...backend.guarantees },
        },
        cleanup: "UNCERTAIN",
        verification: { state: "UNVERIFIED", probesRun: [], checkedAt: new Date().toISOString() },
      });
      await this.saveEvidence(thrownEvidence).catch(() => undefined);
      await this.emitCleanupFailed(input.missionId, input.executionId);
      if (isolatedRoot !== undefined) await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined);
      return { status: "FAILED", error: "isolation backend threw; external state unknown", evidence: thrownEvidence, backendId: backend.id };
    }

    const digestInfo = ProbeOutputDigest.of(result.output);
    const facts: ExecutionEvidenceFacts = {
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      exitState: result.status,
      ...(result.error !== undefined ? { terminationReason: result.error } : {}),
      isolationLevel: result.profileLevel,
      backendGuarantees: { ...backend.guarantees },
      ...(digestInfo.digest !== undefined ? { outputDigest: digestInfo.digest, outputBytes: digestInfo.bytes } : { outputBytes: digestInfo.bytes }),
      stdoutBytes: JSON.stringify(result.output ?? {}).length,
    };
    const cleanup: CleanupStatus = result.status === "SUCCEEDED" || result.status === "FAILED" ? "CLEANED" : "UNCERTAIN";
    const evidence = createExecutionEvidence({
      identity: this.identity(input, backend.id),
      facts,
      cleanup,
      verification: { state: "UNVERIFIED", probesRun: [], checkedAt: new Date().toISOString() },
    });
    await this.saveEvidence(evidence).catch(() => undefined);

    // Cleanup of the supervisor-owned isolated workspace (adapter mode):
    // bounded retries; failures are recorded honestly and surfaced, never
    // hidden. Caller-managed workspaces (no isolatedRoot) are NEVER deleted.
    const cleaned = isolatedRoot === undefined ? true : await this.cleanupWithRetries(isolatedRoot);
    if (!cleaned) {
      await this.emitCleanupFailed(input.missionId, input.executionId);
      const failedCleanupEvidence = createExecutionEvidence({
        identity: evidence.identity,
        facts: evidence.facts,
        cleanup: "CLEANUP_FAILED",
        verification: evidence.verification,
      });
      await this.saveEvidence(failedCleanupEvidence).catch(() => undefined);
    }

    if (result.status === "UNSUPPORTED") {
      // Resolution said available, execution said unsupported: treat as
      // denial (fail closed), evidence records the contradiction honestly.
      return { status: "DENIED", error: result.error ?? "backend reported UNSUPPORTED at execution time", evidence, backendId: backend.id };
    }
    return { status: result.status, output: result.output, ...(result.error !== undefined ? { error: result.error } : {}), evidence, backendId: backend.id };
  }

  /**
   * Attach trusted verification to settled evidence. Called by the
   * composition AFTER probes run; rewrites verification state with a fresh
   * digest. Identity must match exactly or the update fails closed.
   *
   * P13 review finding 10: settlement failures PROPAGATE (they are never
   * swallowed by the caller) — the composition downgrades the reported
   * verdict to INCONCLUSIVE instead of claiming PASSED/VERIFIED over an
   * unconfirmable durable state. Absence of an evidence store is a wiring
   * decision made by the composition, not a settlement failure.
   */
  async settleVerification(input: {
    readonly missionId: string;
    readonly stepIndex: number;
    readonly capability: string;
    readonly executionId: string;
    readonly verification: ExecutionEvidenceVerification;
  }): Promise<ExecutionEvidenceRecord | undefined> {
    const store = this.options.evidenceStore;
    if (!store) return undefined;
    const record = await store.load(input.executionId);
    if (!record) return undefined;
    if (!evidenceMatchesIdentity(record, input)) {
      throw new Error("Verification settlement refused: evidence identity mismatch (fail closed).");
    }
    const updated = createExecutionEvidence({
      identity: record.identity,
      facts: record.facts,
      cleanup: record.cleanup,
      verification: input.verification,
    });
    await store.save(updated);
    return updated;
  }

  // -----------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------

  private identity(input: { readonly missionId: string; readonly stepIndex: number; readonly capability: string; readonly executionId: string }, backendId: string): ExecutionEvidenceIdentity {
    return {
      missionId: input.missionId,
      stepIndex: input.stepIndex,
      capability: input.capability,
      executionId: input.executionId,
      backendId,
    };
  }

  private async saveEvidence(record: ExecutionEvidenceRecord): Promise<void> {
    await this.options.evidenceStore?.save(record).catch(() => undefined);
  }

  private async cleanupWithRetries(root: string, attempts = 5): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true });
        return true;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    return false;
  }

  private async emitCleanupFailed(missionId: string, executionId: string): Promise<void> {
    await this.options.events.emit("execution.cleanup_failed", { missionId, executionId },
      { actor: this.options.actor ?? "isolation-supervisor" }).catch(() => undefined);
  }
}

/** sha256 over canonical workload output; never stores the payload. */
const ProbeOutputDigest = {
  of(output: JsonObject | undefined): { digest?: string; bytes: number } {
    if (output === undefined) return { bytes: 0 };
    const serialized = JSON.stringify(output);
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized, "utf8") };
  },
} as const;

/**
 * Redact absolute filesystem paths out of metadata-only denial reasons
 * (P13 review finding 8): event payloads and evidence must not leak host
 * paths. Relative segments and error codes survive; drive-absolute and
 * root-absolute paths become "[path]".
 */
function redactPath(message: string): string {
  return message
    .replace(/[a-zA-Z]:[\\/][^"'`\s,;:)]*/g, "[path]")
    .replace(/(?<![\w.])\/(?:[\w.-]+\/)*[\w.-]+/g, (match) => (match.length > 1 && match.includes("/") ? "[path]" : match));
}

/**
 * Copy the REGISTERED entry module from the trusted source directory into
 * the isolated workspace root. Only this one file crosses. Traversal in the
 * entry name and symlinked sources are rejected (fail-closed).
 */
async function materializeEntry(sourceDirectory: string, entry: string, isolatedRoot: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (entry.startsWith("/") || entry.startsWith("\\") || /^[a-zA-Z]:/.test(entry) || entry.split(/[\\/]+/).includes("..")) {
      return { ok: false, reason: "entry must be a safe relative path" };
    }
    const source = resolve(sourceDirectory, entry);
    const sourceRoot = resolve(sourceDirectory);
    if (source !== sourceRoot && !source.startsWith(sourceRoot + sep)) {
      return { ok: false, reason: "entry resolves outside the trusted source directory" };
    }
    // lstat (NOT stat): a symlinked entry could point outside the trusted
    // source directory — reject it before any content crosses (P13 review
    // finding 4; mirrors the container backend's copyTree rule).
    const info = await lstat(source);
    if (info.isSymbolicLink()) return { ok: false, reason: "entry is a symlink and is rejected" };
    if (!info.isFile()) return { ok: false, reason: "entry is not a regular file" };
    const target = join(isolatedRoot, entry);
    const targetResolved = resolve(target);
    const rootResolved = resolve(isolatedRoot);
    if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + sep)) {
      return { ok: false, reason: "target escapes the isolated workspace" };
    }
    await mkdir(dirname(targetResolved), { recursive: true });
    await copyFile(source, targetResolved);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
