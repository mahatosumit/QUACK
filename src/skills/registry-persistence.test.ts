import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Permission } from "../security/permissions.js";
import { type SkillDefinition } from "./types.js";
import { SkillRegistry } from "./registry.js";
import {
  JsonFileSkillRegistryStore,
  SKILL_REGISTRY_SCHEMA_VERSION,
  skillDefinitionFingerprint,
  type PersistedSkillVersion,
  type SkillRegistrySnapshot,
  type SkillRegistryStore,
} from "./persistence.js";

test("JsonFileSkillRegistryStore reports an empty store without crashing", () => {
  const dir = tempDir();
  try {
    const store = new JsonFileSkillRegistryStore(join(dir, "skills", "registry.json"));
    const result = store.load();

    assert.equal(result.snapshot, undefined);
    assert.equal(result.issues[0]?.code, "missing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SkillRegistry persists and restores multiple versions with default lineage and rollback", async () => {
  const dir = tempDir();
  try {
    const store = new JsonFileSkillRegistryStore(join(dir, "skills", "registry.json"));
    const first = new SkillRegistry();
    first.register(skill("contract-impact-analysis", "1.0.0"));
    first.attachStore(store, { persistCurrent: true });
    first.register(skill("contract-impact-analysis", "1.1.0"), "generated", "active", {
      parentVersion: "1.0.0",
      supersedesVersion: "1.0.0",
      setDefault: true,
      portableInstructions: "Prefer modern TypeScript contract analysis.",
    });
    first.transition("contract-impact-analysis", "review", "Validated replacement available.", {
      version: "1.0.0",
      replacementVersion: "1.1.0",
      evidenceRefs: ["evidence-v2"],
    });

    const second = new SkillRegistry();
    second.register(skill("contract-impact-analysis", "1.0.0"));
    const loaded = store.load();
    assert.equal(loaded.snapshot?.schemaVersion, SKILL_REGISTRY_SCHEMA_VERSION);
    const reconciliation = second.loadSnapshot(loaded.snapshot!);
    second.attachStore(store);

    assert.deepEqual(reconciliation.issues, []);
    assert.deepEqual(second.getVersions("contract-impact-analysis").map((record) => record.manifest.version), ["1.0.0", "1.1.0"]);
    assert.equal(second.get("contract-impact-analysis")?.manifest.version, "1.1.0");
    assert.equal(second.getRecord("contract-impact-analysis", "1.1.0")?.parentVersion, "1.0.0");
    assert.equal(second.getVersionSupersededBy("contract-impact-analysis", "1.0.0"), "1.1.0");

    const restoredGenerated = second.get("contract-impact-analysis", "1.1.0")!;
    const execution = await restoredGenerated.execute({ goal: "", parameters: {}, context: { workspaceRoot: dir, dataDir: dir, sessionId: "test" } });
    assert.equal((execution.data as { restoredFromRegistry?: boolean }).restoredFromRegistry, true);

    second.rollback("contract-impact-analysis", "1.0.0", "Regression after restart.", {
      previousVersion: "1.1.0",
      evidenceRefs: ["evidence-rollback"],
    });

    const third = new SkillRegistry();
    third.register(skill("contract-impact-analysis", "1.0.0"));
    third.loadSnapshot(store.load().snapshot!);

    assert.equal(third.get("contract-impact-analysis")?.manifest.version, "1.0.0");
    assert.equal(third.getRecord("contract-impact-analysis", "1.1.0")?.status, "review");
    assert.equal(third.getLifecycleHistory("contract-impact-analysis").some((event) => event.reason.includes("Regression after restart")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persisted imported candidates keep trust status and do not auto-activate", () => {
  const dir = tempDir();
  try {
    const store = new JsonFileSkillRegistryStore(join(dir, "registry.json"));
    const first = new SkillRegistry();
    first.register(skill("contract-impact-analysis", "1.0.0"));
    first.attachStore(store, { persistCurrent: true });
    first.register(skill("contract-impact-analysis", "1.1.0"), "imported", "candidate", {
      parentVersion: "1.0.0",
      portableInstructions: "Imported external review procedure.",
      sourceRef: "file:///skills/contract-impact-analysis/SKILL.md",
    });

    const second = new SkillRegistry();
    second.register(skill("contract-impact-analysis", "1.0.0"));
    second.loadSnapshot(store.load().snapshot!);

    assert.equal(second.getRecord("contract-impact-analysis", "1.1.0")?.source, "imported");
    assert.equal(second.getRecord("contract-impact-analysis", "1.1.0")?.status, "candidate");
    assert.equal(second.get("contract-impact-analysis")?.manifest.version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("corrupt persisted registry is quarantined and trusted source skills can still load", () => {
    const dir = tempDir();
  try {
    const file = join(dir, "skills", "registry.json");
    mkdirSync(join(dir, "skills"), { recursive: true });
    writeFileSync(file, "{ not json", "utf8");

    const store = new JsonFileSkillRegistryStore(file);
    const result = store.load();
    const registry = new SkillRegistry();
    registry.register(skill("contract-impact-analysis", "1.0.0"));

    assert.equal(result.snapshot, undefined);
    assert.equal(result.issues[0]?.code, "malformed_json");
    assert.ok(result.issues[0]?.quarantinedPath);
    assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconciliation rejects missing parents invalid defaults and prohibited active adaptive manifests", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));

  const snapshot = snapshotWith([
    persistedGenerated("contract-impact-analysis", "1.1.0", "active", {
      parentVersion: "9.9.9",
      instructions: "Missing parent.",
    }),
    persistedGenerated("contract-impact-analysis", "1.2.0", "candidate", {
      parentVersion: "1.0.0",
      instructions: "Candidate cannot be default.",
    }),
    persistedGenerated("contract-impact-analysis", "1.3.0", "active", {
      parentVersion: "1.0.0",
      permissions: ["everything" as Permission],
      instructions: "Unsafe permissions.",
    }),
  ], "1.2.0");

  const result = registry.loadSnapshot(snapshot);

  assert.equal(result.issues.some((loadIssue) => loadIssue.message.includes("parent version")), true);
  assert.equal(result.issues.some((loadIssue) => loadIssue.message.includes("not active")), true);
  assert.equal(result.issues.some((loadIssue) => loadIssue.message.includes("prohibited permission")), true);
  assert.equal(registry.getRecord("contract-impact-analysis", "1.1.0"), undefined);
  assert.equal(registry.getRecord("contract-impact-analysis", "1.3.0"), undefined);
  assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.0.0");
});

test("reconciliation reports same-version source fingerprint conflicts without overwriting source", () => {
  const original = skill("contract-impact-analysis", "1.0.0", { description: "Original immutable artifact." });
  const snapshot = snapshotWith([persistedFromDefinition(original)]);
  const changed = skill("contract-impact-analysis", "1.0.0", { description: "Changed artifact under the same version." });
  const registry = new SkillRegistry();
  registry.register(changed);

  const result = registry.loadSnapshot(snapshot);

  assert.equal(result.issues.some((loadIssue) => loadIssue.message.includes("fingerprint conflict")), true);
  assert.equal(registry.getRecord("contract-impact-analysis", "1.0.0")?.manifest.description, "Changed artifact under the same version.");
});

test("registry mutation rolls back in memory when durable persistence fails", () => {
  const registry = new SkillRegistry();
  registry.register(skill("contract-impact-analysis", "1.0.0"));
  registry.attachStore(new FailingSkillRegistryStore());

  assert.throws(() => registry.register(skill("contract-impact-analysis", "1.1.0"), "generated", "active", {
    parentVersion: "1.0.0",
    portableInstructions: "This write fails.",
  }), /simulated persistence failure/);
  assert.equal(registry.getRecord("contract-impact-analysis", "1.1.0"), undefined);
  assert.equal(registry.get("contract-impact-analysis")?.manifest.version, "1.0.0");
});

class FailingSkillRegistryStore implements SkillRegistryStore {
  load() {
    return { issues: [] };
  }

  save(_snapshot: SkillRegistrySnapshot): void {
    throw new Error("simulated persistence failure");
  }
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "quack-skill-registry-"));
}

function skill(
  id: string,
  version: string,
  options: { readonly permissions?: readonly Permission[]; readonly description?: string } = {},
): SkillDefinition {
  return {
    manifest: {
      id,
      name: id.replaceAll("-", " "),
      version,
      description: options.description ?? `${id} version ${version}`,
      author: "test",
      category: "analysis",
      tags: ["contract", "impact"],
      requiresPermissions: options.permissions ?? ["workspace.read"],
      requiresTools: ["core.workspace.list-files"],
      entry: `skills/${id}-${version}.js`,
    },
    execute: async () => ({ ok: true, durationMs: 0 }),
  };
}

function snapshotWith(versions: readonly PersistedSkillVersion[], defaultVersion?: string): SkillRegistrySnapshot {
  return {
    schemaVersion: SKILL_REGISTRY_SCHEMA_VERSION,
    savedAt: "2026-08-05T00:00:00.000Z",
    logicalSkills: [{
      skillId: "contract-impact-analysis",
      defaultVersion: defaultVersion ?? versions.find((version) => version.status === "active")?.version,
      versions,
    }],
    lifecycleHistory: [],
  };
}

function persistedFromDefinition(definition: SkillDefinition): PersistedSkillVersion {
  return {
    skillId: definition.manifest.id,
    version: definition.manifest.version,
    manifest: definition.manifest,
    status: "active",
    source: "builtin",
    loadedAt: "2026-08-05T00:00:00.000Z",
    useCount: 0,
    avgDurationMs: 0,
    fingerprint: skillDefinitionFingerprint(definition),
  };
}

function persistedGenerated(
  id: string,
  version: string,
  status: "active" | "candidate",
  options: {
    readonly parentVersion?: string;
    readonly instructions: string;
    readonly permissions?: readonly Permission[];
  },
): PersistedSkillVersion {
  const definition = skill(id, version, { permissions: options.permissions });
  const portable = { kind: "portable" as const, instructions: options.instructions };
  return {
    skillId: id,
    version,
    manifest: definition.manifest,
    status,
    source: "generated",
    loadedAt: "2026-08-05T00:00:00.000Z",
    useCount: 0,
    avgDurationMs: 0,
    parentVersion: options.parentVersion,
    fingerprint: skillDefinitionFingerprint(definition, portable),
    definition: portable,
  };
}
