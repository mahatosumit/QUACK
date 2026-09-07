import { type JsonObject } from "../core/types.js";
import { AllowListPermissionPolicy, type Permission, type PermissionRequest, type PermissionDecision, type PermissionPolicy } from "./permissions.js";

/** Risk classification per quackos.md §10. */
export type RiskLevel = "low" | "medium" | "high";

/** Risk-aware action descriptor. Maps permissions to default risk levels. */
export interface RiskAssessment {
  readonly level: RiskLevel;
  readonly reason: string;
  readonly requiresUserApproval: boolean;
}

/** A user-approval callback invoked for medium/high-risk actions. */
export interface ApprovalCallback {
  requestApproval(prompt: string, context: JsonObject): Promise<boolean>;
}

/** In-process approval callback using stdin. */
export class ConsoleApprovalCallback {
  async requestApproval(prompt: string, _context: JsonObject): Promise<boolean> {
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`[APPROVAL] ${prompt} (y/N): `, (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
  }
}

const HIGH_RISK: ReadonlySet<Permission> = new Set([
  "filesystem.write.external",
  "git.write",
  "secrets.write",
  "plugin.install",
  "terminal.execute",
  "browser.control",
  "mcp.execute",
  "external.write",
  "email.send",
]);

const LOW_RISK: ReadonlySet<Permission> = new Set([
  "workspace.read",
  "filesystem.read.external",
  "git.read",
  "memory.read",
  "memory.write",
]);

/**
 * RiskAwareApprovalPolicy — the human approval controller (quackos.md §10).
 *
 * Low risk  -> auto-execute
 * Medium    -> ask user via callback
 * High risk -> require explicit approval
 *
 * Combine with an AllowListPermissionPolicy for the underlying allow set.
 */
export class RiskAwareApprovalPolicy implements PermissionPolicy {
  private readonly authority: PermissionPolicy;
  private readonly approver?: ApprovalCallback;
  private readonly userAutoApproveLow: boolean;

  constructor(
    allowed: readonly Permission[] | PermissionPolicy,
    approver?: ApprovalCallback,
    opts?: { autoApproveLow?: boolean },
  ) {
    this.authority = Array.isArray(allowed)
      ? new AllowListPermissionPolicy(allowed)
      : allowed as PermissionPolicy;
    this.approver = approver;
    this.userAutoApproveLow = opts?.autoApproveLow ?? true;
  }

  assessRisk(request: PermissionRequest): RiskAssessment {
    if (HIGH_RISK.has(request.permission)) {
      return { level: "high", reason: `${request.permission} is high-impact`, requiresUserApproval: true };
    }
    if (LOW_RISK.has(request.permission)) {
      return { level: "low", reason: `${request.permission} is low-impact`, requiresUserApproval: false };
    }
    return { level: "medium", reason: `${request.permission} is medium-impact`, requiresUserApproval: true };
  }

  async decide(request: PermissionRequest): Promise<PermissionDecision> {
    const authority = await this.authority.decide(request);
    if (!authority.granted) return authority;

    const assessment = this.assessRisk(request);

    // Low risk: auto-execute unless user disabled auto-approve.
    if (assessment.level === "low" && this.userAutoApproveLow) {
      return { granted: true, reason: `Auto-approved (low risk): ${assessment.reason}` };
    }

    // Medium/High risk: require approval callback.
    if (!this.approver) {
      // No approver wired: deny for safety. This is the safe default.
      return { granted: false, reason: `${assessment.level} risk requires approval but no approver is wired (denied for safety).` };
    }

    const granted = await this.approver.requestApproval(
      `${request.actor} requests ${request.permission}. Reason: ${request.reason}. Risk: ${assessment.level}.`,
      request.context ?? {},
    );
    return { granted, reason: granted ? `Approved (user) for ${assessment.level} risk` : `Denied (user) for ${assessment.level} risk` };
  }
}
