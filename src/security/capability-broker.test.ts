import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryCapabilityGrantRegistry,
  JsonFileCapabilityGrantRegistry,
  PermissionBackedCapabilityBroker,
  buildToolCapabilityRequest,
  capabilityIdForPermission,
  classifyPermissionAction,
  defineCapabilityForPermission,
  resourceKindForPermission,
  scopeForPermission,
} from "./capability-broker.js";
import { AllowListPermissionPolicy } from "./permissions.js";
import { type CapabilityGrantCreateInput, type CapabilityRequest } from "./capability-broker.js";

const approval = {
  approvedBy: "security",
  reason: "test grant",
  approvedAt: "2026-08-07T00:00:00.000Z",
};

test("delegation preserves every parent restriction and cannot reuse owner authority", () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  const parent = grants.createGrant({ missionId: "delegation", capabilities: ["permission.workspace.read", "permission.workspace.write"],
    scope: { workspacePaths: ["docs"], toolIds: ["read-doc"], actions: ["READ"], resources: [{ kind: "workspace", path: "docs" }] },
    expiresAt: new Date(Date.now() + 60_000).toISOString(), approval });
  const input: CapabilityGrantCreateInput = { missionId: "delegation", agentId: "child", capabilities: ["permission.workspace.read"], approval };
  const child = grants.deriveGrant(parent.id, input);
  assert.equal(child.parentGrantId, parent.id);
  assert.deepEqual(child.scope, parent.scope);
  assert.equal(child.expiresAt, parent.expiresAt);
  const request = buildToolCapabilityRequest({ missionId: "delegation", agentId: "child", actor: "child", toolId: "read-doc", permission: "workspace.read", input: { path: "docs/readme.md" } });
  assert.equal(grants.missionHasCapability(request).granted, true);
  assert.equal(grants.missionHasCapability({ ...request, toolId: "other-tool" }).granted, false);
  assert.equal(grants.missionHasCapability({ ...request, resource: { kind: "workspace", path: "docs/../outside.md" } }).granted, false);
  assert.equal(grants.missionHasCapability({ ...request, capabilityId: "permission.workspace.write", action: "REVERSIBLE_CHANGE" }).granted, false);
  for (const override of [
    { capabilities: ["permission.terminal.execute"] },
    { expiresAt: new Date(Date.now() + 120_000).toISOString() },
    { scope: { ...parent.scope, toolIds: ["other-tool"] } },
    { scope: { ...parent.scope, workspacePaths: ["."] } },
    { scope: { ...parent.scope, actions: ["REVERSIBLE_CHANGE"] as const } },
    { scope: { ...parent.scope, resources: [{ kind: "workspace", path: "." }] as const } },
  ]) assert.throws(() => grants.deriveGrant(parent.id, { ...input, ...override }), /exceeds|exceed/i);
  grants.revokeGrant(child.id);
  assert.equal(grants.missionHasCapability(request).granted, false);
});

test("host scopes and ancestor revocation apply transitively", () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  const parent = grants.createGrant({ missionId: "network", capabilities: ["permission.network.http"], scope: { hosts: ["api.example.test"] }, approval });
  const child = grants.deriveGrant(parent.id, { missionId: "network", agentId: "child", capabilities: parent.capabilities, approval });
  const grandchild = grants.deriveGrant(child.id, { missionId: "network", agentId: "grandchild", capabilities: parent.capabilities, approval });
  assert.throws(() => grants.deriveGrant(child.id, { missionId: "network", agentId: "invalid", capabilities: parent.capabilities, scope: { hosts: ["other.example.test"] }, approval }), /scope exceeds/);
  const request = buildToolCapabilityRequest({ missionId: "network", agentId: "grandchild", actor: "grandchild", toolId: "fetch", permission: "network.http", input: { url: "https://api.example.test/data" } });
  assert.equal(grants.missionHasCapability(request).grant?.id, grandchild.id);
  assert.equal(grants.missionHasCapability(buildToolCapabilityRequest({ missionId: "network", agentId: "grandchild", actor: "grandchild", toolId: "fetch", permission: "network.http",
    input: { url: "https://other.example.test/data", host: "api.example.test" } })).granted, false);
  assert.equal(grants.missionHasCapability({ ...request, resource: { kind: "network", host: "other.example.test" } }).granted, false);
  grants.revokeGrant(parent.id);
  assert.equal(grants.missionHasCapability(request).granted, false);
  assert.equal(grants.queryActiveGrants({ missionId: "network" }).length, 0);
});

test("command grants do not allow shell suffixes and malformed lifetime fails closed", () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.createGrant({ missionId: "commands", capabilities: ["permission.terminal.execute"], scope: { commands: ["node --version"] }, approval });
  const request = buildToolCapabilityRequest({ missionId: "commands", actor: "test", toolId: "terminal", permission: "terminal.execute", input: { command: "node --version" } });
  assert.equal(grants.missionHasCapability(request).granted, true);
  assert.equal(grants.missionHasCapability({ ...request, resource: { kind: "terminal", command: "node --version && another-command" } }).granted, false);
  assert.throws(() => grants.createGrant({ missionId: "bad-date", capabilities: [], expiresAt: "invalid", approval }), /lifetime/);
});

test("authority expiring during an awaited approval fails without asking twice", async () => {
  let clock = "2026-01-01T00:00:00.000Z";
  class ClockedGrants extends InMemoryCapabilityGrantRegistry {
    override missionHasCapability(request: CapabilityRequest, at = clock) { return super.missionHasCapability(request, at); }
  }
  const grants = new ClockedGrants();
  const expiresAt = "2026-01-01T00:00:01.000Z";
  grants.createGrant({ missionId: "expiry", capabilities: ["permission.workspace.read"], issuedAt: clock, expiresAt, approval });
  let approvals = 0;
  const broker = new PermissionBackedCapabilityBroker({ decide: async () => {
    approvals++;
    clock = expiresAt;
    return { granted: true, reason: "Approved after grant lifetime" };
  } }, grants);
  const result = await broker.resolve(buildToolCapabilityRequest({ missionId: "expiry", actor: "test", toolId: "read", permission: "workspace.read", input: { path: "docs/readme.md" } }));
  assert.equal(result.granted, false);
  assert.equal(result.policyRef, "mission-grant");
  assert.equal(approvals, 1);
});

test("capability helpers map permissions to action class and resource kind", () => {
  assert.equal(capabilityIdForPermission("workspace.read"), "permission.workspace.read");
  assert.equal(classifyPermissionAction("workspace.read"), "READ");
  assert.equal(classifyPermissionAction("workspace.write"), "REVERSIBLE_CHANGE");
  assert.equal(classifyPermissionAction("terminal.execute"), "IRREVERSIBLE_ACTION");
  assert.equal(resourceKindForPermission("git.read"), "git");
  assert.deepEqual(scopeForPermission("workspace.read", { path: "src/index.ts" }), {
    kind: "workspace",
    path: "src/index.ts",
  });

  assert.deepEqual(defineCapabilityForPermission("memory.write"), {
    id: "permission.memory.write",
    permission: "memory.write",
    name: "memory.write",
    action: "REVERSIBLE_CHANGE",
    resourceKind: "memory",
  });
});

test("PermissionBackedCapabilityBroker delegates decisions to the existing permission policy", async () => {
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]));
  const granted = await broker.resolve(buildToolCapabilityRequest({
    actor: "test",
    taskId: "task-1",
    toolId: "core.workspace.read-file",
    permission: "workspace.read",
    input: { path: "README.md" },
  }));

  assert.equal(granted.granted, true);
  assert.equal(granted.capabilityId, "permission.workspace.read");
  assert.equal(granted.policyRef, "permission-backed");
  assert.equal(granted.permissionDecision?.granted, true);

  const denied = await broker.resolve(buildToolCapabilityRequest({
    actor: "test",
    taskId: "task-1",
    toolId: "core.workspace.write-file",
    permission: "workspace.write",
    input: { path: "README.md" },
  }));

  assert.equal(denied.granted, false);
  assert.equal(denied.capabilityId, "permission.workspace.write");
  assert.equal(denied.permissionDecision?.granted, false);
});

test("tool capability requests preserve actor tool input and resource scope", () => {
  const request = buildToolCapabilityRequest({
    actor: "agent-1",
    taskId: "task-1",
    toolId: "core.workspace.read-file",
    permission: "workspace.read",
    input: { path: "src/runtime/runtime.ts" },
  });

  assert.equal(request.actor, "agent-1");
  assert.equal(request.taskId, "task-1");
  assert.equal(request.toolId, "core.workspace.read-file");
  assert.equal(request.capabilityId, "permission.workspace.read");
  assert.equal(request.action, "READ");
  assert.deepEqual(request.resource, { kind: "workspace", path: "src/runtime/runtime.ts" });
  assert.deepEqual(request.context, {
    toolId: "core.workspace.read-file",
    input: { path: "src/runtime/runtime.ts" },
  });
});

test("mission grant allows a capability inside scope and permission policy", async () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  const grant = grants.createGrant({
    missionId: "mission-1",
    capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["src"] },
    issuedAt: "2026-08-07T00:00:00.000Z",
    approval,
  });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const decision = await broker.resolve(buildToolCapabilityRequest({
    missionId: "mission-1",
    actor: "agent-1",
    taskId: "task-1",
    toolId: "core.workspace.read-file",
    permission: "workspace.read",
    input: { path: "src/index.ts" },
  }));

  assert.equal(decision.granted, true);
  assert.equal(decision.grantId, grant.id);
});

test("broker denies mismatched permission-backed capability requests", async () => {
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]));
  const decision = await broker.resolve({
    ...buildToolCapabilityRequest({
      missionId: "mission-1",
      actor: "agent-1",
      taskId: "task-1",
      toolId: "core.workspace.read-file",
      permission: "workspace.read",
      input: { path: "docs/readme.md" },
    }),
    capabilityId: "permission.workspace.write",
  });

  assert.equal(decision.granted, false);
  assert.equal(decision.policyRef, "capability-contract");
  assert.match(decision.reason, /does not match required capability permission\.workspace\.read/);
});

test("mission grant denies a missing capability", async () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.createGrant({
    missionId: "mission-1",
    capabilities: ["permission.workspace.read"],
    issuedAt: "2026-08-07T00:00:00.000Z",
    approval,
  });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read", "workspace.write"]), grants);
  const decision = await broker.resolve(buildToolCapabilityRequest({
    missionId: "mission-1",
    actor: "agent-1",
    taskId: "task-1",
    toolId: "core.workspace.write-file",
    permission: "workspace.write",
    input: { path: "src/index.ts" },
  }));

  assert.equal(decision.granted, false);
  assert.match(decision.reason, /No active grant permits permission\.workspace\.write/);
});

test("mission grant denies expired grants", async () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.createGrant({
    missionId: "mission-1",
    capabilities: ["permission.workspace.read"],
    issuedAt: "2000-01-01T00:00:00.000Z",
    expiresAt: "2000-01-01T01:00:00.000Z",
    approval,
  });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const decision = await broker.resolve(buildToolCapabilityRequest({
    missionId: "mission-1",
    actor: "agent-1",
    taskId: "task-1",
    toolId: "core.workspace.read-file",
    permission: "workspace.read",
    input: { path: "src/index.ts" },
  }));

  assert.equal(decision.granted, false);
  assert.match(decision.reason, /No active grant permits permission\.workspace\.read/);
});

test("mission grant denies path scope violations", async () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  grants.createGrant({
    missionId: "mission-1",
    capabilities: ["permission.workspace.read"],
    scope: { workspacePaths: ["docs"] },
    issuedAt: "2026-08-07T00:00:00.000Z",
    approval,
  });
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  const decision = await broker.resolve(buildToolCapabilityRequest({
    missionId: "mission-1",
    actor: "agent-1",
    taskId: "task-1",
    toolId: "core.workspace.read-file",
    permission: "workspace.read",
    input: { path: "src/index.ts" },
  }));

  assert.equal(decision.granted, false);
  assert.match(decision.reason, /No active grant permits permission\.workspace\.read/);
});

test("grant registry revokes and queries active grants", () => {
  const grants = new InMemoryCapabilityGrantRegistry();
  const grant = grants.createGrant({
    missionId: "mission-1",
    agentId: "agent-1",
    capabilities: ["permission.workspace.read"],
    issuedAt: "2026-08-07T00:00:00.000Z",
    approval,
  });

  assert.equal(grants.queryActiveGrants({ missionId: "mission-1", agentId: "agent-1" }).length, 1);
  assert.equal(grants.revokeGrant(grant.id, { revokedBy: "security", reason: "done" }), true);
  assert.equal(grants.queryActiveGrants({ missionId: "mission-1", agentId: "agent-1" }).length, 0);
});

test("JSON capability grant registry persists grants and revocations", () => {
  const dir = mkdtempSync(join(tmpdir(), "quack-grants-"));
  const filePath = join(dir, "capability-grants.json");

  try {
    const grants = new JsonFileCapabilityGrantRegistry(filePath);
    const grant = grants.ensureGrant({
      missionId: "mission-1",
      agentId: "agent-1",
      capabilities: ["permission.workspace.read"],
      scope: { workspacePaths: ["docs"] },
      issuedAt: "2026-08-07T00:00:00.000Z",
      approval,
    });
    const duplicate = grants.ensureGrant({
      missionId: "mission-1",
      agentId: "agent-1",
      capabilities: ["permission.workspace.read"],
      scope: { workspacePaths: ["docs"] },
      issuedAt: "2026-08-07T00:00:00.000Z",
      approval,
    });

    assert.equal(duplicate.id, grant.id);
    assert.equal(grants.listGrants().length, 1);

    const reloaded = new JsonFileCapabilityGrantRegistry(filePath);
    assert.equal(reloaded.queryActiveGrants({ missionId: "mission-1", agentId: "agent-1" }).length, 1);
    assert.equal(reloaded.revokeGrant(grant.id, { revokedBy: "security", reason: "mission finished" }), true);

    const afterRevocation = new JsonFileCapabilityGrantRegistry(filePath);
    assert.equal(afterRevocation.queryActiveGrants({ missionId: "mission-1", agentId: "agent-1" }).length, 0);
    assert.equal(afterRevocation.listGrants()[0].revokedBy, "security");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
