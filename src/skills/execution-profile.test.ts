import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveSkillExecutionProfile, validateSkillExecutionProfile, toIsolationRequest } from "./execution-profile.js";
import type { UniversalSkillFields } from "./universal.js";

function fields(overrides: Partial<UniversalSkillFields> = {}): UniversalSkillFields {
  return {
    kind: "TOOL", source: "local", platforms: ["all"], networkRequirements: [],
    filesystemRequirements: [], secretRequirements: [], riskClass: "LOW",
    sandboxProfile: "IN_PROCESS", ...overrides,
  };
}

test("derived skill profiles default to least privilege", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-skillprof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const profile = deriveSkillExecutionProfile({
    executionId: "exec-1", skillId: "fixture.safe", missionId: "mission-1", actor: "observer",
    capabilities: ["workspace.read"], workspaceRoot: dir, fields: fields(), riskClass: "LOW",
  });
  assert.equal(profile.networkPolicy.mode, "DENY");
  assert.equal(profile.secretPolicy.mode, "DENY");
  assert.equal(profile.sandboxBackend, "IN_PROCESS");
  assert.equal(profile.filesystemPolicy.workspaceRoot, dir);
  validateSkillExecutionProfile(profile);
  const request = toIsolationRequest(profile, { kind: "module", entry: "skill.cjs", args: {} });
  assert.equal(request.profile.level, "IN_PROCESS");
  assert.equal(request.executionId, "exec-1");
  assert.equal(request.missionId, "mission-1");
});

test("HIGH risk and claimed IN_PROCESS skills are held at worker isolation", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-skillprof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const high = deriveSkillExecutionProfile({
    executionId: "exec-2", skillId: "fixture.risky", missionId: "mission-1", actor: "observer",
    capabilities: ["workspace.read", "network.http"], workspaceRoot: dir,
    fields: fields({ sandboxProfile: "IN_PROCESS", networkRequirements: ["network.http"] }), riskClass: "HIGH",
  });
  // Risk never lowers isolation: claimed IN_PROCESS is upgraded.
  assert.equal(high.sandboxBackend, "WORKER_PROCESS");
  assert.equal(high.networkPolicy.mode, "ALLOWLIST");
  assert.equal(high.networkPolicy.hosts.length, 0, "allowlist starts empty — network requires explicit authorization");
});

test("EXPLICIT secret policy without materialized secrets fails closed", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-skillprof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const profile = deriveSkillExecutionProfile({
    executionId: "exec-3", skillId: "fixture.secret", missionId: "mission-1", actor: "observer",
    capabilities: ["secrets.read"], workspaceRoot: dir,
    fields: fields({ secretRequirements: ["API_KEY"] }), riskClass: "HIGH",
  });
  assert.equal(profile.secretPolicy.mode, "EXPLICIT");
  assert.throws(() => validateSkillExecutionProfile(profile), /materialized secret grants/);
});