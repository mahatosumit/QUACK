import assert from "node:assert/strict";
import test from "node:test";
import {
  type ActionProposal,
  checkExpectedEffect,
  createProposal,
  executionContextFor,
  lowerProposal,
  verifyActionResult,
  type EffectProbe,
  type ExpectedEffect,
  type VerificationStrategy,
} from "./action-contract.js";
import { QUACK_CONTRACT_VERSION, type ActionResultV1 } from "../../contracts/index.js";

function succeededResult(overrides: Partial<ActionResultV1> = {}): ActionResultV1 {
  const base: ActionResultV1 = {
    executionId: "exec-1",
    providerId: "provider-1",
    actionId: "restart_service",
    status: "SUCCEEDED",
    output: undefined,
    evidenceIds: [],
  };
  return { ...base, ...overrides };
}

const baseProposal: ActionProposal = {
  id: "proposal-1",
  missionId: "mission-1",
  capability: "restart_service",
  arguments: { service: "billing-api" },
  intent: "restart the billing service",
  riskLevel: "REVERSIBLE",
  sandbox: "IN_PROCESS_TRUSTED",
  timeoutMs: 30_000,
  selectionReason: "deterministic first executable node",
  proposedAt: "2026-01-01T00:00:00Z",
  proposedBy: "agent-loop",
};

test("createProposal assigns id and proposedAt", () => {
  const proposal = createProposal({ ...baseProposal, capability: "call_a" });
  assert.ok(proposal.id.startsWith("proposal"));
  assert.ok(typeof proposal.proposedAt === "string");
  assert.ok(proposal.proposedAt.length > 0);
  assert.equal(proposal.capability, "call_a");
});

test("lowerProposal maps capability to actionId, keeps idempotency key, no dry-run", () => {
  const proposal = createProposal({
    ...baseProposal,
    capability: "search_code",
    arguments: { query: "foo" },
    idempotencyKey: "once-only",
  });
  const lowered = lowerProposal(proposal);
  assert.equal(lowered.actionId, "search_code");
  assert.deepEqual(lowered.input, { query: "foo" });
  assert.equal(lowered.dryRun, false);
  assert.equal(lowered.idempotencyKey, "once-only");
});

test("lowerProposal on a proposal without idempotency key omits it", () => {
  const proposal = createProposal({ ...baseProposal, capability: "read" });
  const lowered = lowerProposal(proposal);
  assert.equal(lowered.idempotencyKey, undefined);
});

test("executionContextFor threads missionId, actor, executionId, and default contract version", () => {
  const proposal = createProposal(baseProposal);
  const ctx = executionContextFor(proposal, "exec-1");
  assert.equal(ctx.contractVersion, QUACK_CONTRACT_VERSION);
  assert.equal(ctx.missionId, "mission-1");
  assert.equal(ctx.executionId, "exec-1");
  assert.equal(ctx.taskId, proposal.id);
  assert.equal(ctx.actor, "agent-loop");
  assert.equal(ctx.signal, undefined);
  assert.equal(ctx.deadline, undefined);
});

test("executionContextFor passes signal and deadline when provided", () => {
  const controller = new AbortController();
  const proposal = createProposal(baseProposal);
  const ctx = executionContextFor(
    proposal,
    "exec-1",
    QUACK_CONTRACT_VERSION,
    controller.signal,
    "2026-12-31T23:59:59Z",
  );
  assert.equal(ctx.signal, controller.signal);
  assert.equal(ctx.deadline, "2026-12-31T23:59:59Z");
});

test("verifyActionResult skips when no strategy is on the proposal", () => {
  const proposal = createProposal(baseProposal);
  const verdict = verifyActionResult(proposal, succeededResult());
  assert.equal(verdict.status, "SKIPPED");
  assert.equal(verdict.strategy.kind, "trust_executed");
});

test("verifyActionResult fails when action did not succeed, regardless of strategy", () => {
  const strategy: VerificationStrategy = { kind: "trust_executed", reason: "low-risk" };
  const proposal = createProposal({ ...baseProposal, verificationStrategy: strategy });
  const result = succeededResult({ status: "FAILED" });
  const verdict = verifyActionResult(proposal, result);
  assert.equal(verdict.status, "FAILED");
  assert.ok(verdict.message.toLowerCase().includes("failed"));
});

test("verifyActionResult with trust_executed strategy passes when execution succeeded", () => {
  const strategy: VerificationStrategy = { kind: "trust_executed", reason: "reversible action ratified" };
  const proposal = createProposal({ ...baseProposal, verificationStrategy: strategy });
  const verdict = verifyActionResult(proposal, succeededResult());
  assert.equal(verdict.status, "PASSED");
  assert.ok(verdict.message.includes("reversible action ratified"));
});

test("verifyActionResult returns INCONCLUSIVE for non-trust strategies when no probe runner is supplied", () => {
  const strategy: VerificationStrategy = {
    kind: "probe_external_state",
    capability: "health_check",
    arguments: { url: "http://billing/api/health" },
    expected: { description: "service returns healthy", successProbes: [{ kind: "no_error" }] },
  };
  const proposal = createProposal({ ...baseProposal, verificationStrategy: strategy });
  const verdict = verifyActionResult(proposal, succeededResult());
  assert.equal(verdict.status, "INCONCLUSIVE");
  assert.ok(verdict.message.includes("external probe runner"));
});

test("checkExpectedEffect passes when status_equals probe matches", () => {
  const expected: ExpectedEffect = {
    description: "succeeded",
    successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }],
  };
  const outcome = checkExpectedEffect(succeededResult(), expected);
  assert.equal(outcome.status, "PASSED");
  assert.equal(outcome.failures.length, 0);
});

test("checkExpectedEffect fails when status_equals probe does not match", () => {
  const expected: ExpectedEffect = {
    description: "succeeded",
    successProbes: [{ kind: "status_equals", value: "SUCCEEDED" }],
  };
  const result = succeededResult({ status: "FAILED" });
  const outcome = checkExpectedEffect(result, expected);
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0], "status === SUCCEEDED");
});

test("checkExpectedEffect evaluates output_field equals", () => {
  const expected: ExpectedEffect = {
    description: "output carries healthy=true",
    successProbes: [{ kind: "output_field", path: "healthy", equals: true }],
  };
  assert.equal(checkExpectedEffect(succeededResult({ output: { healthy: true } }), expected).status, "PASSED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { healthy: false } }), expected).status, "FAILED");
  assert.equal(checkExpectedEffect(succeededResult(), expected).status, "INCONCLUSIVE");
});

test("checkExpectedEffect evaluates output_field notEquals", () => {
  const expected: ExpectedEffect = {
    description: "no error code",
    successProbes: [{ kind: "output_field", path: "code", notEquals: "E_INTERNAL" }],
  };
  assert.equal(checkExpectedEffect(succeededResult({ output: { code: "OK" } }), expected).status, "PASSED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { code: "E_INTERNAL" } }), expected).status, "FAILED");
});

test("checkExpectedEffect evaluates output_field contains with array + string", () => {
  const expected: ExpectedEffect = {
    description: "result includes the service",
    successProbes: [{ kind: "output_field", path: "services", contains: "billing-api" }],
  };
  assert.equal(checkExpectedEffect(succeededResult({ output: { services: ["billing-api", "auth"] } }), expected).status, "PASSED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { services: ["auth"] } }), expected).status, "FAILED");
});

test("checkExpectedEffect evaluates output_field matches with regex on a string field", () => {
  const expected: ExpectedEffect = {
    description: "log line matches healthy pattern",
    successProbes: [{ kind: "output_field", path: "log", matches: "^ok:" }],
  };
  assert.equal(checkExpectedEffect(succeededResult({ output: { log: "ok: ready" } }), expected).status, "PASSED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { log: "fail: boom" } }), expected).status, "FAILED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { log: 42 } }), expected).status, "INCONCLUSIVE");
});

test("checkExpectedEffect evaluates no_error probe", () => {
  const expected: ExpectedEffect = {
    description: "no error in result",
    successProbes: [{ kind: "no_error" }],
  };
  assert.equal(checkExpectedEffect(succeededResult({ output: {} }), expected).status, "PASSED");
  assert.equal(checkExpectedEffect(succeededResult({ output: { error: "boom" } }), expected).status, "FAILED");
});

test("checkExpectedEffect aggregates multiple failures", () => {
  const expected: ExpectedEffect = {
    description: "multi",
    successProbes: [
      { kind: "status_equals", value: "SUCCEEDED" },
      { kind: "output_field", path: "healthy", equals: true },
      { kind: "output_field", path: "errors", notEquals: 0 },
    ],
  };
  const result = succeededResult({ output: { healthy: false, errors: 0 } });
  const outcome = checkExpectedEffect(result, expected);
  assert.equal(outcome.status, "FAILED");
  assert.equal(outcome.failures.length, 2);
});
