import { resolve } from "node:path";
import { type Permission } from "../security/permissions.js";
import { type ApprovalCallback } from "../security/approval-controller.js";
import { type CapabilityGrantCreateInput } from "../security/capability-broker.js";
import { type AgentReachToolAdapterConfig } from "../tools/agent-reach.js";

/** Runtime configuration for a QUACK session. */
export interface QuackConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly permissions: readonly Permission[];
  readonly missionId?: string;
  readonly capabilityGrants?: readonly CapabilityGrantCreateInput[];
  /** Approves medium/high-risk permission requests (terminal.execute, git.write, ...). Omit to deny them by default. */
  readonly approver?: ApprovalCallback;
  /** Improvement loop configuration. */
  readonly improvement?: {
    /** Enable improvement evaluation after mission completion. */
    readonly enabled?: boolean;
    /** Automatically evaluate eligibility after successful missions. */
    readonly autoEvaluate?: boolean;
    /** Minimum evidence items required before improvement cycle runs. */
    readonly minimumEvidence?: number;
    /** Cooldown between improvement cycles in milliseconds. */
    readonly cooldownMs?: number;
  };
  /** Optional external research integrations. All are disabled unless explicitly enabled. */
  readonly research?: {
    readonly agentReach?: AgentReachToolAdapterConfig;
  };
  /**
   * Mission completion certification mode. Default "evidence" wires the
   * deterministic workflow-evidence validator (contract v1): missions
   * complete only with a bound VerificationRecordV1 over governed workflow
   * evidence. "brain" defers certification to the configured brain's
   * verifyExecution (fresh machines without a real provider then fail
   * closed, as before). "none" is not a bypass — completion then requires
   * an explicit verifyExecution dependency and is otherwise refused.
   */
  readonly workflowVerification?: "evidence" | "brain" | "none";
}

/** Creates a default {@link QuackConfig}, merging any user-supplied overrides. */
export function createDefaultConfig(options: Partial<QuackConfig> = {}): QuackConfig {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  const dataDir = resolve(options.dataDir ?? ".quack");

  return {
    workspaceRoot,
    dataDir,
    permissions: options.permissions ?? ["memory.read", "memory.write", "workspace.read"],
    missionId: options.missionId,
    capabilityGrants: options.capabilityGrants,
    approver: options.approver,
    improvement: {
      enabled: options.improvement?.enabled ?? true,
      autoEvaluate: options.improvement?.autoEvaluate ?? true,
      minimumEvidence: options.improvement?.minimumEvidence ?? 3,
      cooldownMs: options.improvement?.cooldownMs ?? 5 * 60 * 1000, // 5 minutes
    },
    research: options.research,
    workflowVerification: options.workflowVerification ?? "evidence",
  };
}

