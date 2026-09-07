import {
  QUACK_CONTRACT_VERSION,
  type ActionRequestV1,
  type ActionResultV1,
  type ExecutionContextV1,
  type QuackContractVersion,
} from "../../contracts/index.js";
import { createId, type IsoTimestamp, type JsonObject, type JsonValue } from "../../core/types.js";

/**
 * Canonical action / result contract for the executive loop boundary.
 *
 * `ActionRequestV1` (../../contracts/v1/contracts.ts:240) is the
 * **provider-facing** request shape: actionId, input, dryRun,
 * idempotencyKey. It is intentionally minimal because action providers are
 * runtime plugins with an explicit contract version.
 *
 * `ActionProposal` below is the **loop-facing** proposal shape: it is what
 * the planner / executive loop emits before a capability is executed. It
 * carries the prompt's full proposal surface (§6): capability, arguments,
 * intent, risk level, timeout, idempotency key, expected effect, and a
 * verification strategy.
 *
 * The loop authorizes the proposal (Phase 7) and then lowers it to an
 * `ActionRequestV1` via `lowerProposal()` and submits that to the existing
 * `ActionRuntime.execute()`. This keeps provider contracts untouched while
 * giving the loop a single canonical action type that survives across tool
 * execution, MCP actions, future NAVIQ capabilities, and humans.
 *
 * `ResultVerification` is the executable form of the bring-up gap: today
 * `AgentLoop.verify()` (agent-loop/index.ts:450-460) defaults to
 * "execution succeeded ⇒ verification passed" (audit §25.1). The proposal
 * optionally carries `expected_effect` + `verification_strategy`; the loop
 * uses `verifyActionResult()` to run them against the `ActionResultV1`
 * returned by `ActionRuntime.execute()`.
 *
 * See `docs/runtime/ACTION_CONTRACT.md` for the full contract including the
 * executed-vs-goal-success separation (audit §29), the idempotency rules
 * (audit §19), and the mapping onto the existing v1 contracts.
 */

export type ExecutionRiskLevel =
  | "READ_ONLY"
  | "REVERSIBLE"
  | "IRREVERSIBLE"
  | "DESTRUCTIVE";

export type ExecutionSandbox =
  | "IN_PROCESS_TRUSTED"
  | "LOCAL_ISOLATED"
  | "EXTERNAL_TRUSTED"
  | "EXTERNAL_UNTRUSTED"
  | "PHYSICAL"
  | "HUMAN";

export interface ActionProposal {
  readonly id: string;
  readonly missionId: string;
  readonly capability: string;
  readonly providerId?: string;
  readonly arguments: JsonObject;
  readonly intent: string;
  readonly riskLevel: ExecutionRiskLevel;
  readonly sandbox: ExecutionSandbox;
  readonly idempotencyKey?: string;
  readonly timeoutMs: number;
  readonly expectedEffect?: ExpectedEffect;
  readonly verificationStrategy?: VerificationStrategy;
  readonly selectionReason: string;
  readonly proposedAt: IsoTimestamp;
  readonly proposedBy: string;
}

export interface ExpectedEffect {
  readonly description: string;
  readonly successProbes: readonly EffectProbe[];
}

export type EffectProbe =
  | { kind: "output_field"; path: string; equals?: JsonValue; notEquals?: JsonValue; contains?: JsonValue; matches?: string }
  | { kind: "status_equals"; value: string }
  | { kind: "no_error" }
  | { kind: "external_check"; capability: string; arguments: JsonObject; assertion: string };

export type VerificationStrategy =
  | { kind: "trust_executed"; reason: string }
  | { kind: "probe_external_state"; capability: string; arguments: JsonObject; expected: ExpectedEffect }
  | { kind: "evaluator_with_objective"; objectiveId: string; reason: string }
  | { kind: "human_confirm"; actor: string };

export interface ActionOutcome {
  readonly proposalId: string;
  readonly executionId: string;
  readonly missionId: string;
  readonly executedAt: IsoTimestamp;
  readonly actionResult: ActionResultV1;
  readonly verification?: ResultVerification;
}

export interface ResultVerification {
  readonly strategy: VerificationStrategy;
  readonly status: "PASSED" | "FAILED" | "INCONCLUSIVE" | "SKIPPED";
  readonly evidenceId?: string;
  readonly message: string;
  readonly checkedAt: IsoTimestamp;
}

export function createProposal(
  params: Omit<ActionProposal, "id" | "proposedAt">,
): ActionProposal {
  return {
    ...params,
    id: createId("proposal"),
    proposedAt: new Date().toISOString(),
  };
}

export function lowerProposal(proposal: ActionProposal): ActionRequestV1 {
  return {
    actionId: proposal.capability,
    input: proposal.arguments,
    dryRun: false,
    idempotencyKey: proposal.idempotencyKey,
  };
}

export function executionContextFor(
  proposal: ActionProposal,
  executionId: string,
  contractVersion: QuackContractVersion = QUACK_CONTRACT_VERSION,
  signal?: AbortSignal,
  deadline?: IsoTimestamp,
): ExecutionContextV1 {
  return {
    contractVersion,
    missionId: proposal.missionId,
    taskId: proposal.id,
    executionId,
    actor: proposal.proposedBy,
    signal,
    deadline,
  };
}

export function verifyActionResult(
  proposal: ActionProposal,
  result: ActionResultV1,
  runner?: ProbeRunner,
): ResultVerification {
  const strategy = proposal.verificationStrategy;
  if (strategy === undefined) {
    return {
      strategy: { kind: "trust_executed", reason: "No verification strategy on proposal; verification skipped (Phase 3 will require one)." },
      status: "SKIPPED",
      message: "No verification strategy on proposal.",
      checkedAt: new Date().toISOString(),
    };
  }
  if (result.status !== "SUCCEEDED") {
    const expectedSucceed = strategy.kind !== "trust_executed" ? true : true;
    if (expectedSucceed) {
      return {
        strategy,
        status: "FAILED",
        message: `Action ${result.status.toLowerCase()}; cannot verify expected effect. Last error from provider: ${
          result.output?.["error"] ? JSON.stringify(result.output["error"]) : "unknown"
        }.`,
        checkedAt: new Date().toISOString(),
      };
    }
  }
  if (strategy.kind === "trust_executed") {
    return {
      strategy,
      status: "PASSED",
      message: `Execution succeeded; trust-based verification accepted. Reason: ${strategy.reason}`,
      checkedAt: new Date().toISOString(),
    };
  }
  if (runner === undefined) {
    return {
      strategy,
      status: "INCONCLUSIVE",
      message: "Strategy requires an external probe runner; none supplied in this call. Phase 3 wires the loop-side runner.",
      checkedAt: new Date().toISOString(),
    };
  }
  return runner(proposal, result, strategy);
}

export type ProbeRunner = (
  proposal: ActionProposal,
  result: ActionResultV1,
  strategy: VerificationStrategy,
) => ResultVerification;

export function checkExpectedEffect(
  result: ActionResultV1,
  expected: ExpectedEffect,
): { readonly status: "PASSED" | "FAILED" | "INCONCLUSIVE"; readonly failures: readonly string[] } {
  const failures: string[] = [];
  for (const probe of expected.successProbes) {
    const outcome = evaluateProbe(probe, result);
    if (outcome === "FAILED") failures.push(describeProbe(probe));
    if (outcome === "INCONCLUSIVE" && expected.successProbes.length === 1) {
      return { status: "INCONCLUSIVE", failures };
    }
  }
  if (failures.length > 0) return { status: "FAILED", failures };
  return { status: "PASSED", failures };
}

function evaluateProbe(probe: EffectProbe, result: ActionResultV1): "PASSED" | "FAILED" | "INCONCLUSIVE" {
  if (probe.kind === "status_equals") {
    return result.status === probe.value ? "PASSED" : "FAILED";
  }
  if (probe.kind === "no_error") {
    const err = readPath(result.output, "error");
    return err === undefined || err === null ? "PASSED" : "FAILED";
  }
  if (probe.kind === "output_field") {
    const value = readPath(result.output, probe.path);
    if (value === undefined) return "INCONCLUSIVE";
    if (probe.equals !== undefined) return deepEqual(value, probe.equals) ? "PASSED" : "FAILED";
    if (probe.notEquals !== undefined) return deepEqual(value, probe.notEquals) ? "FAILED" : "PASSED";
    if (probe.contains !== undefined) return contains(value, probe.contains);
    if (probe.matches !== undefined) {
      if (typeof value !== "string") return "INCONCLUSIVE";
      return new RegExp(probe.matches).test(value) ? "PASSED" : "FAILED";
    }
    return "PASSED";
  }
  return "INCONCLUSIVE";
}

function describeProbe(probe: EffectProbe): string {
  if (probe.kind === "status_equals") return `status === ${probe.value}`;
  if (probe.kind === "no_error") return "result has no error";
  if (probe.kind === "output_field") return `output.${probe.path}`;
  if (probe.kind === "external_check") return `external_check:${probe.capability}`;
  return "(unknown probe)";
}

function readPath(output: JsonObject | undefined, path: string): JsonValue | undefined {
  if (output === undefined) return undefined;
  let cursor: JsonValue = output;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return undefined;
    cursor = (cursor as JsonObject)[segment];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  if (typeof left !== typeof right) return false;
  if (typeof left !== "object" || left === null || right === null) return left === right;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]!));
  }
  const leftKeys = Object.keys(left as JsonObject).sort();
  const rightKeys = Object.keys(right as JsonObject).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && deepEqual((left as JsonObject)[key]!, (right as JsonObject)[key]!));
}

function contains(haystack: JsonValue, needle: JsonValue): "PASSED" | "FAILED" {
  if (Array.isArray(haystack)) {
    return haystack.some((item) => deepEqual(item, needle)) ? "PASSED" : "FAILED";
  }
  if (typeof haystack === "string" && typeof needle === "string") {
    return haystack.includes(needle) ? "PASSED" : "FAILED";
  }
  return "FAILED";
}
