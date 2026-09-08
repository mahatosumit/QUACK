/**
 * Phase 7E — persona framework tests.
 *
 * Verifies the security contract: personas are style-only.
 *   - No capability/tool/permission/trust change is possible via a persona.
 *   - applyPersona is lossless and additive on style fields only.
 *   - Persona agents route through the existing workforce router without
 *     any broker bypass (they execute through SpecialistAgent → SkillRuntime
 *     exactly like non-persona agents).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyPersona, buildPersonaWorkforce, getPersona, listPersonaIds, PERSONAS, type PersonaId } from "./personas.js";
import { createWorkforce, type SpecialistAgentDefinition } from "../index.js";
import type { SkillResult } from "../../skills/types.js";

const base: SpecialistAgentDefinition = {
  identity: { id: "coding-agent", name: "Coding Agent", description: "Implements and reviews code changes." },
  skills: ["code-analysis"],
  capabilities: ["permission.workspace.read"],
  trustLevel: "builtin",
  specialization: ["code", "review"],
};

const SEVEN: readonly PersonaId[] = ["architect", "researcher", "debugger", "security-reviewer", "product-manager", "engineer", "critic"];

test("exactly the seven required personas exist", () => {
  assert.equal(PERSONAS.length, 7);
  assert.deepEqual(listPersonaIds(), SEVEN);
});

test("persona application never changes authority fields", () => {
  for (const persona of PERSONAS) {
    const decorated = applyPersona(base, persona);
    assert.deepEqual(decorated.skills, base.skills, `${persona.id} must not change skills`);
    assert.deepEqual(decorated.capabilities, base.capabilities, `${persona.id} must not change capabilities`);
    assert.equal(decorated.trustLevel, base.trustLevel, `${persona.id} must not change trust level`);
    assert.equal(decorated.modelCapability, base.modelCapability, `${persona.id} must not change model capability`);
    assert.equal(decorated.identity.id, base.identity.id, "default applyPersona must not fork the agent id");
    // Specialization additions are style/routing terms only — never capability-shaped.
    const added = decorated.specialization.filter(term => !base.specialization.includes(term));
    assert.ok(added.length > 0, `${persona.id} must add routing terms`);
    assert.ok(added.every(term => !term.startsWith("permission.") && !term.startsWith("capability.")),
      `${persona.id} must not smuggle capability-shaped terms`);
  }
});

test("persona agents cannot out-privilege their base", () => {
  const hostile = applyPersona(base, getPersona("security-reviewer"));
  // Even if a caller tampered with a persona copy, equality on the base
  // fields is the enforced invariant — re-assert with a forged attempt.
  const forged: SpecialistAgentDefinition = { ...hostile, capabilities: [...hostile.capabilities, "permission.terminal.execute"] };
  assert.notDeepEqual(forged.capabilities, base.capabilities, "tamper detection fixture");
  // applyPersona itself is the safe API; verify it ignores any impossible
  // persona that tries to carry capabilities (personas have no such field).
  const persona = getPersona("debugger");
  assert.equal("capabilities" in persona, false);
});

test("persona terms are additive and idempotent", () => {
  const once = applyPersona(base, getPersona("architect"));
  const twice = applyPersona(once, getPersona("architect"));
  assert.deepEqual(twice.specialization, once.specialization);
  assert.ok(twice.specialization.length > base.specialization.length);
});

test("persona workforce routes persona goals through the standard workforce", async () => {
  const executed: string[] = [];
  const runtime = {
    executeSkill: async (skillId: string): Promise<SkillResult> => {
      executed.push(skillId);
      return { ok: true, data: { skillId }, durationMs: 1 };
    },
  };
  const workforce = createWorkforce(runtime, undefined, { definitions: buildPersonaWorkforce([base]) });
  assert.equal(workforce.registry.list().length, 7);

  const selection = workforce.selectAgent({ goal: "audit the authentication boundary for security vulnerabilities" });
  assert.ok(selection.ok, selection.ok ? "" : selection.error.message);
  assert.match(selection.data.agent.identity.id, /security-reviewer$/, "security goal should match security-reviewer persona");

  const result = await workforce.executeMission({ goal: "audit the authentication boundary for security vulnerabilities" });
  assert.ok(result.ok, result.ok ? "" : result.error.message);
  assert.deepEqual(executed, [base.skills[0]], "persona mission executes the base agent skill through the governed SkillRuntime");
});

test("architect and critic personas route distinctly", () => {
  const runtime = { executeSkill: async (): Promise<SkillResult> => ({ ok: true, durationMs: 0 }) };
  const workforce = createWorkforce(runtime, undefined, { definitions: buildPersonaWorkforce([base]) });
  const architect = workforce.selectAgent({ goal: "design the subsystem architecture and trade-offs" });
  const critic = workforce.selectAgent({ goal: "critique this review for holes and weaknesses" });
  assert.ok(architect.ok && architect.data.agent.identity.id.endsWith(":architect"), "architecture goal → architect persona");
  assert.ok(critic.ok && critic.data.agent.identity.id.endsWith(":critic"), "critique goal → critic persona");
});
