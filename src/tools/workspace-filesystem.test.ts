import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";

test("workspace tools list and read files through runtime permission checks", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));

  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello QUACK", "utf8");

  try {
    const system = await createQuackSystem({ workspaceRoot, dataDir, permissions: ["workspace.read", "memory.write", "memory.read"] });
    const capabilityEvents: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
    system.events.onAny((event) => {
      if (event.type.startsWith("capability.")) {
        capabilityEvents.push({ type: event.type, payload: event.payload });
      }
    });
    const taskId = createId("task");

    const listed = await system.runtime.executeTool("core.workspace.list-files", {}, { taskId, actor: "test" });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.deepEqual(listed.data.files, ["hello.txt (11 bytes)"]);

    const read = await system.runtime.executeTool("core.workspace.read-file", { path: "hello.txt" }, { taskId, actor: "test" });
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.data.content, "hello QUACK");
    assert.equal(read.data.truncated, false);

    const checks = capabilityEvents.filter((event) => event.type === "capability.checked");
    const allowedEvents = capabilityEvents.filter((event) => event.type === "capability.allowed");
    const decisions = capabilityEvents.filter((event) => event.type === "capability.decided");
    assert.equal(checks.length, 2);
    assert.equal(allowedEvents.length, 2);
    assert.equal(decisions.length, 2);
    assert.deepEqual(decisions.map((event) => event.payload["capabilityId"]), [
      "permission.workspace.read",
      "permission.workspace.read",
    ]);
    assert.equal(decisions.every((event) => event.payload["granted"] === true), true);
    assert.equal(decisions.every((event) => typeof event.payload["timestamp"] === "string"), true);
    assert.equal(decisions.every((event) => event.payload["decision"] === "allowed"), true);
    assert.deepEqual(decisions[1].payload["resource"], { kind: "workspace", path: "hello.txt" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("workspace tools are denied when workspace.read is not granted", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));

  await mkdir(workspaceRoot, { recursive: true });

  try {
    const system = await createQuackSystem({ workspaceRoot, dataDir, permissions: ["memory.write", "memory.read"] });
    const capabilityEvents: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
    system.events.onAny((event) => {
      if (event.type.startsWith("capability.")) {
        capabilityEvents.push({ type: event.type, payload: event.payload });
      }
    });
    const taskId = createId("task");

    const listed = await system.runtime.executeTool("core.workspace.list-files", {}, { taskId, actor: "test" });
    assert.equal(listed.ok, false);
    if (listed.ok) return;
    assert.equal(listed.error.code, "tool.permission_denied");
    assert.equal(listed.error.context?.["errorType"], "CapabilityDeniedError");
    assert.equal(listed.error.context?.["toolName"], "List Workspace Files");
    assert.equal(listed.error.context?.["requiredCapability"], "permission.workspace.read");
    assert.equal(listed.error.context?.["missingPermission"], "workspace.read");

    const denied = capabilityEvents.filter((event) => event.type === "capability.denied");
    assert.equal(denied.length, 1);
    assert.equal(denied[0].payload["decision"], "denied");
    assert.equal(denied[0].payload["capabilityId"], "permission.workspace.read");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("workspace tools respect bootstrapped mission capability grants", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));

  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await mkdir(join(workspaceRoot, "src"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "allowed.txt"), "allowed", "utf8");
  await writeFile(join(workspaceRoot, "src", "blocked.txt"), "blocked", "utf8");

  try {
      const system = await createQuackSystem({
        workspaceRoot,
        dataDir,
        missionId: "mission-1",
        permissions: ["workspace.read", "memory.write", "memory.read"],
        capabilityGrants: [{
          missionId: "mission-1",
          capabilities: ["permission.workspace.read"],
          scope: { workspacePaths: ["docs"] },
          approval: {
            approvedBy: "security",
            reason: "mission may inspect docs",
            approvedAt: "2026-08-07T00:00:00.000Z",
          },
        }],
      });
      const capabilityEvents: { readonly type: string; readonly payload: Record<string, unknown> }[] = [];
      system.events.onAny((event) => {
        if (event.type.startsWith("capability.")) {
          capabilityEvents.push({ type: event.type, payload: event.payload });
        }
      });

      assert.equal(system.capabilityGrants.queryActiveGrants({ missionId: "mission-1" }).length, 1);

    const allowed = await system.runtime.executeTool("core.workspace.read-file", { path: "docs/allowed.txt" }, { taskId: "task-1", actor: "test" });
    assert.equal(allowed.ok, true);

    const blocked = await system.runtime.executeTool("core.workspace.read-file", { path: "src/blocked.txt" }, { taskId: "task-1", actor: "test" });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error.code, "tool.permission_denied");
    assert.equal(blocked.error.context?.["errorType"], "CapabilityDeniedError");
    assert.equal(blocked.error.context?.["missionId"], "mission-1");
    assert.equal(blocked.error.context?.["toolName"], "Read Workspace File");
    assert.equal(blocked.error.context?.["requiredCapability"], "permission.workspace.read");
    assert.equal(blocked.error.context?.["missingPermission"], "workspace.read");
    assert.equal(blocked.error.context?.["capabilityId"], "permission.workspace.read");

    const checked = capabilityEvents.filter((event) => event.type === "capability.checked");
    const allowedEvents = capabilityEvents.filter((event) => event.type === "capability.allowed");
    const deniedEvents = capabilityEvents.filter((event) => event.type === "capability.denied");
    assert.equal(checked.length, 2);
    assert.equal(allowedEvents.length, 1);
    assert.equal(deniedEvents.length, 1);
    assert.equal(allowedEvents[0].payload["missionId"], "mission-1");
    assert.equal(allowedEvents[0].payload["decision"], "allowed");
    assert.equal(deniedEvents[0].payload["missionId"], "mission-1");
    assert.equal(deniedEvents[0].payload["decision"], "denied");
    assert.deepEqual(deniedEvents[0].payload["resource"], { kind: "workspace", path: "src/blocked.txt" });

    const restarted = await createQuackSystem({
          workspaceRoot,
          dataDir,
          missionId: "mission-1",
          permissions: ["workspace.read", "memory.write", "memory.read"],
        });
    assert.equal(restarted.capabilityGrants.queryActiveGrants({ missionId: "mission-1" }).length, 1);

    const persistedAllowed = await restarted.runtime.executeTool("core.workspace.read-file", { path: "docs/allowed.txt" }, { taskId: "task-2", actor: "test" });
    assert.equal(persistedAllowed.ok, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("workspace tools are denied when a mission capability is missing", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));

  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "missing-grant.txt"), "blocked", "utf8");

  try {
    const system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      missionId: "mission-without-grants",
      permissions: ["workspace.read", "memory.write", "memory.read"],
    });
    const result = await system.runtime.executeTool("core.workspace.read-file", { path: "missing-grant.txt" }, {
      taskId: "task-1",
      actor: "test",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "tool.permission_denied");
    assert.equal(result.error.context?.["errorType"], "CapabilityDeniedError");
    assert.equal(result.error.context?.["missionId"], "mission-without-grants");
    assert.equal(result.error.context?.["requiredCapability"], "permission.workspace.read");
    assert.match(String(result.error.context?.["reason"]), /has no capability grants/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("workspace tools are denied after mission capability revocation", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_workspace"));
  const dataDir = join(tmpdir(), createId("quack_state"));

  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await writeFile(join(workspaceRoot, "docs", "revoked.txt"), "revoked", "utf8");

  try {
    const system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      missionId: "mission-revoked",
      permissions: ["workspace.read", "memory.write", "memory.read"],
      capabilityGrants: [{
        missionId: "mission-revoked",
        capabilities: ["permission.workspace.read"],
        scope: { workspacePaths: ["docs"] },
        approval: {
          approvedBy: "security",
          reason: "mission may inspect docs",
          approvedAt: "2026-08-07T00:00:00.000Z",
        },
      }],
    });
    const grant = system.capabilityGrants.queryActiveGrants({ missionId: "mission-revoked" })[0];
    assert.ok(grant);
    assert.equal(system.capabilityGrants.revokeGrant(grant.id, { revokedBy: "security", reason: "test revocation" }), true);

    const result = await system.runtime.executeTool("core.workspace.read-file", { path: "docs/revoked.txt" }, {
      taskId: "task-1",
      actor: "test",
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "tool.permission_denied");
    assert.equal(result.error.context?.["errorType"], "CapabilityDeniedError");
    assert.equal(result.error.context?.["missionId"], "mission-revoked");
    assert.equal(result.error.context?.["requiredCapability"], "permission.workspace.read");
    assert.match(String(result.error.context?.["reason"]), /No active grant permits permission\.workspace\.read/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  }
});
