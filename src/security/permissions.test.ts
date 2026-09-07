import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DenyByDefaultPermissionPolicy, AllowListPermissionPolicy } from "./permissions.js";

describe("DenyByDefaultPermissionPolicy", () => {
  it("denies all permissions", async () => {
    const policy = new DenyByDefaultPermissionPolicy();
    const decision = await policy.decide({
      id: "req-1",
      actor: "test",
      permission: "workspace.read",
      reason: "testing",
    });
    assert.equal(decision.granted, false);
    assert.ok(decision.reason.includes("denied by default"));
  });
});

describe("AllowListPermissionPolicy", () => {
  it("grants permissions in the allow list", async () => {
    const policy = new AllowListPermissionPolicy(["workspace.read", "memory.write"]);
    const decision = await policy.decide({
      id: "req-1",
      actor: "test",
      permission: "workspace.read",
      reason: "testing",
    });
    assert.equal(decision.granted, true);
    assert.ok(decision.reason.includes("allowed by policy"));
  });

  it("denies permissions not in the allow list", async () => {
    const policy = new AllowListPermissionPolicy(["memory.read"]);
    const decision = await policy.decide({
      id: "req-1",
      actor: "test",
      permission: "workspace.write",
      reason: "testing",
    });
    assert.equal(decision.granted, false);
    assert.ok(decision.reason.includes("not in the allow list"));
  });

  it("handles empty allow list", async () => {
    const policy = new AllowListPermissionPolicy([]);
    const decision = await policy.decide({
      id: "req-1",
      actor: "test",
      permission: "workspace.read",
      reason: "testing",
    });
    assert.equal(decision.granted, false);
  });
});
