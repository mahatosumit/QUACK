/**
 * Phase 7D — Reasoning capability pack tests.
 *
 * Verifies: every reasoning skill (1) materializes as a declarative package,
 * (2) validates through the REAL governed installer, (3) carries no elevated
 * permission, (4) injects its policy verbatim into the mission workflow, and
 * (5) is selectable by the contextual skill selector on trigger goals.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { REASONING_SKILLS, writeReasoningSkillPack } from "./pack.js";

const EXPECTED_IDS = [
  "reasoning.ultrathink", "reasoning.skeptic", "reasoning.mirror", "reasoning.punch",
  "reasoning.no-yap", "reasoning.blind-spots", "reasoning.ooda", "reasoning.artifacts",
] as const;

test("the pack defines exactly the eight required reasoning policies", () => {
  assert.equal(REASONING_SKILLS.length, 8);
  assert.deepEqual(REASONING_SKILLS.map(skill => skill.id), [...EXPECTED_IDS]);
});

test("every reasoning package installs through the real governed installer", async (context) => {
  const staging = await mkdtemp(join(tmpdir(), "quack-reasoning-stage-"));
  const dataRoot = await mkdtemp(join(tmpdir(), "quack-reasoning-sys-"));
  const workspace = await mkdtemp(join(tmpdir(), "quack-reasoning-ws-"));
  context.after(async () => {
    for (const dir of [staging, dataRoot, workspace]) {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });

  const { written } = writeReasoningSkillPack({ destinationRoot: staging });
  assert.equal(written.length, 8);

  const { createQuackSystem } = await import("../../distributions/swe-system.js");
  const system = createQuackSystem({ workspaceRoot: workspace, dataDir: dataRoot });
  for (const packageRoot of written) {
    const result = await system.skillPackages.registerSkillPackage(packageRoot);
    assert.ok(result.ok, `package ${packageRoot} must install: ${result.ok ? "" : result.error.message}`);
    assert.equal(result.data.enabled, false, "reasoning skills stay disabled until enabled");
  }
  assert.equal(system.skillPackages.listInstalled().length, 8);
  await system.events.drain();
});

test("reasoning skills carry only read-only, non-escalating permissions", () => {
  for (const skill of REASONING_SKILLS) {
    const staging = mkdtempSync();
    try {
      writeReasoningSkillPack({ destinationRoot: staging });
      const manifest = JSON.parse(readFileSync(join(staging, skill.id.replace("reasoning.", ""), "manifest.json"), "utf8")) as {
        readonly requiredCapabilities: readonly string[];
        readonly allowedTools: readonly string[];
        readonly trustLevel: string;
      };
      assert.deepEqual(manifest.requiredCapabilities, ["permission.workspace.read"], `${skill.id} must be read-only`);
      assert.ok(manifest.allowedTools.every(tool => tool === "core.workspace.list-files"), `${skill.id} must not grant non-listing tools`);
      assert.equal(manifest.trustLevel, "verified");
      const permissions = readFileSync(join(staging, skill.id.replace("reasoning.", ""), "permissions.yaml"), "utf8");
      assert.match(permissions, /deny-escalation: true/);
      assert.match(permissions, /network: none/);
      assert.match(permissions, /secrets: none/);
    } finally {
      rmSync(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  }
});

test("each policy is injected verbatim into the mission workflow", () => {
  const staging = mkdtempSync();
  try {
    writeReasoningSkillPack({ destinationRoot: staging });
    for (const skill of REASONING_SKILLS) {
      const workflow = JSON.parse(readFileSync(join(staging, skill.id.replace("reasoning.", ""), "workflow.json"), "utf8")) as {
        readonly steps: ReadonlyArray<{ readonly id: string; readonly description: string; readonly toolInvocations: ReadonlyArray<{ toolId: string }> }>;
      };
      const apply = workflow.steps.find(step => step.id === "apply-policy");
      assert.ok(apply, `${skill.id} must have an apply-policy step`);
      for (const rule of skill.policy) {
        assert.ok(apply!.description.includes(rule), `${skill.id} workflow must carry policy rule: ${rule}`);
      }
      assert.ok(workflow.steps.every(step => step.toolInvocations.every(invocation => invocation.toolId === "core.workspace.list-files")));
    }
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test("reasoning skills are selectable by trigger goals through the contextual selector", async (context) => {
  const staging = await mkdtemp(join(tmpdir(), "quack-reasoning-sel-"));
  const dataRoot = await mkdtemp(join(tmpdir(), "quack-reasoning-selsys-"));
  const workspace = await mkdtemp(join(tmpdir(), "quack-reasoning-selws-"));
  context.after(async () => {
    for (const dir of [staging, dataRoot, workspace]) {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });

  const { written } = writeReasoningSkillPack({ destinationRoot: staging });
  const { createQuackSystem } = await import("../../distributions/swe-system.js");
  const system = createQuackSystem({ workspaceRoot: workspace, dataDir: dataRoot });
  for (const packageRoot of written) {
    const installed = await system.skillPackages.registerSkillPackage(packageRoot);
    assert.ok(installed.ok, installed.ok ? "" : installed.error.message);
    system.skillPackages.enableSkill(installed.data.id);
  }

  const decision = system.contextualSkillSelector.select({ goal: "ultrathink: analyze this architecture deeply" });
  assert.ok(decision.selected.some(entry => entry.skillId === "reasoning.ultrathink"),
    `ultrathink goal must select reasoning.ultrathink (got ${decision.selected.map(entry => entry.skillId).join(", ")})`);
  const riskDecision = system.contextualSkillSelector.select({ goal: "review blind spots and failure modes of the plan" });
  assert.ok(riskDecision.selected.some(entry => entry.skillId === "reasoning.blind-spots"),
    `blind-spots goal must select reasoning.blind-spots (got ${riskDecision.selected.map(entry => entry.skillId).join(", ")})`);
  await system.events.drain();
});

test("reasoning skills never request elevated permission through the broker", async (context) => {
  const staging = await mkdtemp(join(tmpdir(), "quack-reasoning-broker-"));
  const dataRoot = await mkdtemp(join(tmpdir(), "quack-reasoning-brokersys-"));
  const workspace = await mkdtemp(join(tmpdir(), "quack-reasoning-brokerws-"));
  context.after(async () => {
    for (const dir of [staging, dataRoot, workspace]) {
      await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });

  const { written } = writeReasoningSkillPack({ destinationRoot: staging });
  const { createQuackSystem } = await import("../../distributions/swe-system.js");
  // Default config has NO workspace.write grant — an escalated skill would
  // fail validation here. Read-only reasoning skills must all pass.
  const system = createQuackSystem({ workspaceRoot: workspace, dataDir: dataRoot });
  for (const packageRoot of written) {
    const result = await system.skillPackages.registerSkillPackage(packageRoot);
    assert.ok(result.ok, result.ok ? "" : result.error.message);
  }
  // Executing one enabled skill must succeed under default (read-only) grants.
  const installed = system.skillPackages.listInstalled()[0]!;
  system.skillPackages.enableSkill(installed.id);
  const execution = await system.skillRuntime.executeSkill(installed.id, { goal: "ultrathink analysis", parameters: {} }, { actor: "test" });
  assert.ok(execution.ok, `reasoning skill execution must pass under read-only grants: ${execution.error}`);
  await system.events.drain();
});

function mkdtempSync(): string {
  const dir = join(tmpdir(), `quack-reasoning-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rmSyncDir(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
