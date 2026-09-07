import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../../core/types.js";
import { createQuackSystem } from "../../distributions/swe-system.js";
import { type SkillPackageManifest, type SkillPackageWorkflow } from "./index.js";

test("valid skill package imports and stays disabled until enabled", async () => {
  const fixture = await createFixture();
  const events: string[] = [];
  const detach = fixture.system.events.onAny((event) => {
    events.push(event.type);
  });
  try {
    const packageRoot = await writePackage(fixture.workspaceRoot, "valid-package");
    const result = await fixture.system.skillPackages.registerSkillPackage(packageRoot);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.id, "valid-package");
    assert.equal(result.data.enabled, false);
    assert.equal(fixture.system.skills.getRecord("valid-package", "1.0.0")?.status, "inactive");
    assert.ok(events.includes("skill.package.imported"));
    assert.ok(events.includes("skill.package.validated"));
  } finally {
    detach();
    await fixture.cleanup();
  }
});

test("invalid skill package manifest is rejected", async () => {
  const fixture = await createFixture();
  const rejected: string[] = [];
  const detach = fixture.system.events.on("skill.package.rejected", (event) => {
    rejected.push(String(event.payload["reason"]));
  });
  try {
    const packageRoot = await writePackage(fixture.workspaceRoot, "invalid-package", {
      manifest: {
        id: "",
        name: "",
        version: "",
      },
    });
    const result = await fixture.system.skillPackages.registerSkillPackage(packageRoot);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "skill_package.invalid");
    assert.ok(rejected.some((reason) => reason.includes("Skill id is required")));
  } finally {
    detach();
    await fixture.cleanup();
  }
});

test("skill package capability violation is rejected before registration", async () => {
  const fixture = await createFixture();
  try {
    const packageRoot = await writePackage(fixture.workspaceRoot, "write-package", {
      manifest: {
        requiredCapabilities: ["permission.workspace.write"],
        allowedTools: ["core.workspace.write-file"],
      },
      workflow: {
        steps: [
          {
            id: "write-file",
            description: "Attempt to write a file.",
            requiredTools: ["core.workspace.write-file"],
            toolInvocations: [
              {
                toolId: "core.workspace.write-file",
                input: { path: "out.txt", content: "blocked" },
              },
            ],
          },
        ],
      },
    });
    const result = await fixture.system.skillPackages.registerSkillPackage(packageRoot);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "skill_package.invalid");
    assert.match(result.error.message, /permission\.workspace\.write/);
    assert.equal(fixture.system.skills.getRecord("write-package", "1.0.0"), undefined);
  } finally {
    await fixture.cleanup();
  }
});

test("skill package enable and disable lifecycle updates runtime status", async () => {
  const fixture = await createFixture();
  const events: string[] = [];
  const detach = fixture.system.events.onAny((event) => {
    events.push(event.type);
  });
  try {
    const packageRoot = await writePackage(fixture.workspaceRoot, "lifecycle-package");
    const imported = await fixture.system.skillPackages.registerSkillPackage(packageRoot);
    assert.equal(imported.ok, true);

    const enabled = fixture.system.skillPackages.enableSkill("lifecycle-package");
    assert.equal(enabled.ok, true);
    assert.equal(fixture.system.skills.getRecord("lifecycle-package", "1.0.0")?.status, "active");
    assert.equal(fixture.system.skillPackages.listInstalled()[0]?.enabled, true);

    const disabled = fixture.system.skillPackages.disableSkill("lifecycle-package");
    assert.equal(disabled.ok, true);
    assert.equal(fixture.system.skills.getRecord("lifecycle-package", "1.0.0")?.status, "inactive");
    assert.equal(fixture.system.skillPackages.listInstalled()[0]?.enabled, false);
    const removed = fixture.system.skillPackages.removeSkill("lifecycle-package");
    assert.equal(removed.ok, true);
    assert.equal(fixture.system.skills.getRecord("lifecycle-package", "1.0.0"), undefined);
    assert.equal(fixture.system.skillPackages.listInstalled().length, 0);
    assert.ok(events.includes("skill.package.enabled"));
    assert.ok(events.includes("skill.package.disabled"));
  } finally {
    detach();
    await fixture.cleanup();
  }
});

test("skill package persistence recovers installed package metadata and enabled state", async () => {
  const fixture = await createFixture();
  try {
    const packageRoot = await writePackage(fixture.workspaceRoot, "persistent-package");
    const imported = await fixture.system.skillPackages.registerSkillPackage(packageRoot);
    assert.equal(imported.ok, true);
    const enabled = fixture.system.skillPackages.enableSkill("persistent-package");
    assert.equal(enabled.ok, true);

    const recovered = createQuackSystem({
      workspaceRoot: fixture.workspaceRoot,
      dataDir: fixture.dataDir,
      permissions: ["workspace.read", "memory.read", "memory.write"],
    });
    const installed = recovered.skillPackages.listInstalled();

    assert.equal(installed.length, 1);
    assert.equal(installed[0]?.id, "persistent-package");
    assert.equal(installed[0]?.enabled, true);
    assert.equal(recovered.skills.getRecord("persistent-package", "1.0.0")?.status, "active");
  } finally {
    await fixture.cleanup();
  }
});

async function createFixture() {
  const workspaceRoot = join(tmpdir(), createId("quack_skillpkg_workspace"));
  const dataDir = join(tmpdir(), createId("quack_skillpkg_data"));
  await mkdir(workspaceRoot, { recursive: true });
  const system = createQuackSystem({
    workspaceRoot,
    dataDir,
    permissions: ["workspace.read", "memory.read", "memory.write"],
  });
  return {
    workspaceRoot,
    dataDir,
    system,
    cleanup: async () => {
      await removeFixtureDir(workspaceRoot);
      await removeFixtureDir(dataDir);
    },
  };
}

async function writePackage(
  workspaceRoot: string,
  id: string,
  overrides: {
    readonly manifest?: Partial<SkillPackageManifest>;
    readonly workflow?: SkillPackageWorkflow;
  } = {},
): Promise<string> {
  const packageRoot = join(workspaceRoot, id);
  await mkdir(join(packageRoot, "tests"), { recursive: true });
  const manifest: SkillPackageManifest = {
    id,
    name: id,
    version: "1.0.0",
    description: `Test package ${id}.`,
    author: "QUACK tests",
    trustLevel: "community",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.list-files"],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    executionLimits: {
      timeoutMs: 5000,
      maxIterations: 1,
      maxToolCalls: 1,
      maxRetriesPerStep: 0,
    },
    ...overrides.manifest,
  };
  const workflow = overrides.workflow ?? {
    steps: [
      {
        id: "list",
        description: "List workspace files.",
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [
          {
            toolId: "core.workspace.list-files",
            input: { path: ".", depth: 1 },
          },
        ],
        timeoutMs: 5000,
      },
    ],
  };
  await writeFile(join(packageRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "workflow.json"), `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  await writeFile(join(packageRoot, "README.md"), `# ${id}\n`, "utf8");
  await writeFile(join(packageRoot, "tests", "package.json"), "{\"expect\":\"valid\"}\n", "utf8");
  return packageRoot;
}

async function removeFixtureDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableRmError(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function isRetryableRmError(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "EPERM" || error.code === "EBUSY");
}
