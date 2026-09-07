import test from "node:test";
import assert from "node:assert/strict";
import { RiskAwareApprovalPolicy, ConsoleApprovalCallback, type RiskAssessment } from "./approval-controller.js";
import { AllowListPermissionPolicy, type PermissionRequest, type Permission } from "./permissions.js";

const baseRequest: PermissionRequest = {
  id: "req_1",
  actor: "test",
  permission: "workspace.read",
  reason: "reading files",
};

test("RiskAwareApprovalPolicy auto-approves low risk", async () => {
  const policy = new RiskAwareApprovalPolicy(
    ["workspace.read", "memory.read", "git.read" as Permission],
    undefined,
    { autoApproveLow: true },
  );
  const decision = await policy.decide({ ...baseRequest, permission: "workspace.read" });
  assert.equal(decision.granted, true);
  assert.match(decision.reason, /low risk/i);
});

test("RiskAwareApprovalPolicy denies unknown permission outside allow list", async () => {
  const policy = new RiskAwareApprovalPolicy(["workspace.read" as Permission]);
  const decision = await policy.decide({ ...baseRequest, permission: "secrets.write" });
  assert.equal(decision.granted, false);
});

test("RiskAwareApprovalPolicy asks approver for high risk and denies when no approver", async () => {
  const policy = new RiskAwareApprovalPolicy(
    ["terminal.execute" as Permission, "git.write" as Permission, "secrets.write" as Permission],
    undefined,
  );
  const decision = await policy.decide({ ...baseRequest, permission: "secrets.write" });
  assert.equal(decision.granted, false);
  assert.match(decision.reason, /no approver is wired|denied for safety/i);
});

test("RiskAwareApprovalPolicy respects approver true verdict", async () => {
  let prompted = "";
  const approver = {
    async requestApproval(prompt: string) {
      prompted = prompt;
      return true;
    },
  };
  const policy = new RiskAwareApprovalPolicy(
    ["terminal.execute" as Permission],
    approver,
  );
  const decision = await policy.decide({ ...baseRequest, permission: "terminal.execute" });
  assert.equal(decision.granted, true);
  assert.match(prompted, /high/i);
});

test("RiskAwareApprovalPolicy respects approver false verdict", async () => {
  const policy = new RiskAwareApprovalPolicy(
    ["terminal.execute" as Permission],
    { async requestApproval() { return false; } },
  );
  const decision = await policy.decide({ ...baseRequest, permission: "terminal.execute" });
  assert.equal(decision.granted, false);
});

test("assessRisk classifies levels", () => {
  const policy = new RiskAwareApprovalPolicy(["workspace.read" as Permission, "secrets.write" as Permission]);
  const low = policy.assessRisk({ ...baseRequest, permission: "workspace.read" });
  assert.equal(low.level, "low");
  const high = policy.assessRisk({ ...baseRequest, permission: "secrets.write" });
  assert.equal(high.level, "high");
});

test("ConsoleApprovalCallback is constructible", () => {
  const cb = new ConsoleApprovalCallback();
  assert.equal(typeof cb.requestApproval, "function");
});

test("approval cannot grant authority denied by an empty list or wrapped policy", async () => {
  let approvals = 0;
  const approver = { async requestApproval() { approvals += 1; return true; } };
  for (const allowed of [[], new AllowListPermissionPolicy([])]) {
    const policy = new RiskAwareApprovalPolicy(allowed, approver);
    assert.equal((await policy.decide(baseRequest)).granted, false);
    assert.equal((await policy.decide({ ...baseRequest, permission: "terminal.execute" })).granted, false);
  }
  assert.equal(approvals, 0);
});

test("a wrapped permission policy is evaluated before risk approval", async () => {
  const policy = new RiskAwareApprovalPolicy(new AllowListPermissionPolicy(["workspace.read"]));
  assert.equal((await policy.decide(baseRequest)).granted, true);
  assert.equal((await policy.decide({ ...baseRequest, permission: "memory.read" })).granted, false);
});
