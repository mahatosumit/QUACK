import test from "node:test";
import assert from "node:assert/strict";
import { type Permission } from "../security/permissions.js";
import { type SkillDefinition } from "./types.js";
import { SkillRegistry } from "./registry.js";

test("SkillRegistry stores multiple immutable versions under one logical skill id", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));
  registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "active", {
    parentVersion: "1.0.0",
    supersedesVersion: "1.0.0",
    setDefault: true,
  });

  assert.equal(registry.count(), 2);
  assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.1.0");
  assert.equal(registry.get("contract-impact-analysis", "1.0.0")?.manifest.version, "1.0.0");
  assert.deepEqual(registry.getVersions("contract-impact-analysis").map((record) => record.manifest.version), ["1.0.0", "1.1.0"]);
  assert.equal(registry.getVersionSupersededBy("contract-impact-analysis", "1.0.0"), "1.1.0");
});

test("SkillRegistry rejects duplicate concrete versions and invalid lineage", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));

  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.0.0")), /already registered/);
  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "candidate"), /explicit parent version/);
  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "candidate", {
    parentVersion: "9.9.9",
  }), /parent version/);
  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "candidate", {
    parentVersion: "1.1.0",
  }), /parent itself/);
  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "candidate", {
    parentVersion: "1.0.0",
    setDefault: true,
  }), /must be active/);
});

test("SkillRegistry keeps registered version manifests immutable from caller mutation", () => {
  const registry = new SkillRegistry();
  const original = skill("contract-impact-analysis", "1.0.0");
  registry.register(original);

  (original.manifest as { version: string }).version = "9.9.9";
  const fetched = registry.get("contract-impact-analysis", "1.0.0")!;
  (fetched.manifest as { version: string }).version = "8.8.8";

  assert.equal(registry.getRecord("contract-impact-analysis", "1.0.0")?.manifest.version, "1.0.0");
  assert.equal(registry.get("contract-impact-analysis", "1.0.0")?.manifest.version, "1.0.0");
});

test("SkillRegistry keeps lifecycle state per version", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));
  registry.register(skill("contract-impact-analysis", "2.0.0"), "generated", "active", {
    parentVersion: "1.0.0",
    setDefault: true,
  });

  registry.retire("contract-impact-analysis", "Version superseded after review.", { version: "1.0.0", replacementVersion: "2.0.0" });
  registry.quarantine("contract-impact-analysis", "Unsafe imported manifest.", [], { version: "2.0.0" });

  assert.equal(registry.getRecord("contract-impact-analysis", "1.0.0")?.status, "retired");
  assert.equal(registry.getRecord("contract-impact-analysis", "2.0.0")?.status, "quarantined");
  assert.equal(registry.getLifecycleHistory("contract-impact-analysis", "1.0.0")[0].replacementVersion, "2.0.0");
});

test("SkillRegistry rollback restores a prior version without deleting newer history", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));
  registry.register(skill("contract-impact-analysis", "2.0.0"), "generated", "active", {
    parentVersion: "1.0.0",
    setDefault: true,
  });
  registry.retire("contract-impact-analysis", "Regression in old context.", { version: "1.0.0" });

  registry.rollback("contract-impact-analysis", "1.0.0", "Real-world regression in 2.0.0.");

  assert.equal(registry.getRecord("contract-impact-analysis", "1.0.0")?.status, "active");
  assert.equal(registry.getRecord("contract-impact-analysis", "2.0.0")?.status, "review");
  assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.0.0");
  assert.equal(registry.getVersions("contract-impact-analysis").length, 2);
});

test("SkillRegistry allows explicit imported candidate versions without overwriting trusted active versions", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"), "builtin");
  registry.register(skill("contract-impact-analysis", "1.1.0"), "imported", "candidate", {
    parentVersion: "1.0.0",
  });

  assert.equal(registry.getRecord("contract-impact-analysis", "1.0.0")?.source, "builtin");
  assert.equal(registry.getRecord("contract-impact-analysis", "1.1.0")?.source, "imported");
  assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.0.0");
});

function skill(
  id: string,
  version: string,
  options: { readonly permissions?: readonly Permission[]; readonly tags?: readonly string[] } = {},
): SkillDefinition {
  return {
    manifest: {
      id,
      name: id.replaceAll("-", " "),
      version,
      description: `${id} version ${version}`,
      author: "test",
      category: "analysis",
      tags: options.tags ?? ["contract", "impact"],
      requiresPermissions: options.permissions ?? ["workspace.read"],
      requiresTools: ["core.workspace.list-files"],
      entry: `skills/${id}-${version}.js`,
    },
    execute: async () => ({ ok: true, durationMs: 0 }),
  };
}
