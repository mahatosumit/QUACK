import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { scanFiles, detectBuildSystems, detectPackage } from "./repository-graph.js";

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), `import { helper } from "./helper";\nexport function main() { helper(); }`);
  writeFileSync(join(root, "src", "helper.ts"), `export function helper() { return 1; }`);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", scripts: { test: "node --test" } }));
  writeFileSync(join(root, "tsconfig.json"), "{}");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("scanFiles finds all source files", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const files = await scanFiles(root, 10);
    assert.ok(files.length >= 2);
    assert.ok(files.some((f) => f.relativePath === "src/main.ts"));
    assert.ok(files.some((f) => f.relativePath === "src/helper.ts"));
  } finally {
    cleanup();
  }
});

test("scanFiles respects maxDepth", async () => {
  const root = join(tmpdir(), `quack-test-depth-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "subdir"), { recursive: true });
  writeFileSync(join(root, "subdir", "deep.ts"), `export const x = 1;\n`);
  try {
    const files = await scanFiles(root, 0);
    // depth 0 processes root but won't recurse into subdirs
    // subdir/deep.ts shouldn't appear since JSON/root files are filtered
    assert.equal(files.filter((f) => f.relativePath.includes("deep.ts")).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detectBuildSystems", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const systems = await detectBuildSystems(root);
    assert.ok(systems.includes("npm"));
  } finally {
    cleanup();
  }
});

test("detectPackage returns npm info", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const pkg = await detectPackage(root);
    assert.equal(pkg?.type, "npm");
    assert.equal(pkg?.name, "test");
  } finally {
    cleanup();
  }
});

test("detectPackage returns undefined for empty dir", async () => {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  try {
    const pkg = await detectPackage(root);
    assert.equal(pkg, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scanFiles ignores node_modules", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    mkdirSync(join(root, "node_modules", "some-pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "some-pkg", "index.js"), "module.exports = {};");

    const files = await scanFiles(root, 10);
    assert.equal(files.filter((f) => f.relativePath.includes("node_modules")).length, 0);
  } finally {
    cleanup();
  }
});

test("scanFiles assigns correct language", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const files = await scanFiles(root, 10);
    const tsFiles = files.filter((f) => f.language === "typescript");
    assert.ok(tsFiles.length >= 2);
  } finally {
    cleanup();
  }
});

test("scanFiles file has correct stats", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const files = await scanFiles(root, 10);
    const mainFile = files.find((f) => f.relativePath === "src/main.ts");
    assert.ok(mainFile);
    assert.ok(mainFile.size > 0);
    assert.ok(mainFile.lines > 0);
    assert.ok(mainFile.modifiedAt.length > 0);
  } finally {
    cleanup();
  }
});
