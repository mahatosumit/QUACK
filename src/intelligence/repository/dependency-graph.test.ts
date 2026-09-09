import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { DependencyGraph } from "./dependency-graph.js";
import { type FileInfo } from "../types.js";

let counter = 0;
function createWorkspace(): { root: string; fileInfo: (rel: string) => FileInfo; cleanup: () => void } {
  const root = join(tmpdir(), `quack-dep-${randomUUID()}-${counter++}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  return {
    root,
    fileInfo: (rel: string): FileInfo => {
      // Platform-neutral: node:path join handles "/" on Windows and POSIX.
      const fullPath = join(root, rel);
      const content = readLinkContent(rel);
      writeFileSync(fullPath, content);
      return {
        path: fullPath,
        relativePath: rel,
        language: "typescript",
        size: Buffer.byteLength(content, "utf-8"),
        lines: content.split("\n").length,
        modifiedAt: new Date().toISOString(),
        isDirectory: false,
      };
    },
    cleanup: () => { try { rmSync(root, { recursive: true, force: true }); } catch {} },
  };
}

const fileContents = new Map<string, string>();

function setContent(rel: string, content: string): string {
  fileContents.set(rel, content);
  return rel;
}

function readLinkContent(rel: string): string {
  return fileContents.get(rel) ?? `export const x = 1;\n`;
}

test("DependencyGraph build extracts imports", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/main.ts", `import { helper } from "./helper.js";\nimport fs from "node:fs";\n`);
    setContent("src/helper.ts", `export const helper = () => {};\n`);
    const files = [ws.fileInfo("src/main.ts"), ws.fileInfo("src/helper.ts")];

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const deps = graph.getDependencies("src/main.ts");
    assert.equal(deps.length, 2);

    const helperDep = deps.find((d) => d.moduleSpecifier === "./helper.js");
    assert.ok(helperDep);
    assert.equal(helperDep?.isExternal, false);

    const fsDep = deps.find((d) => d.moduleSpecifier === "node:fs");
    assert.ok(fsDep);
    assert.equal(fsDep?.isExternal, true);
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph getDependents", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/a.ts", `import { b } from "./b";\nimport { c } from "./c";\n`);
    setContent("src/b.ts", `export const b = 1;\n`);
    setContent("src/c.ts", `export const c = 2;\n`);
    const files = [ws.fileInfo("src/a.ts"), ws.fileInfo("src/b.ts"), ws.fileInfo("src/c.ts")];

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const bDeps = graph.getDependents("src/b.ts");
    assert.equal(bDeps.length, 1);
    assert.equal(bDeps[0], "src/a.ts");
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph findImportPath finds shortest path", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/main.ts", `import { a } from "./a";\nimport { b } from "./b";\n`);
    setContent("src/a.ts", `import { c } from "./c";\n`);
    setContent("src/b.ts", `export const b = 1;\n`);
    setContent("src/c.ts", `import { d } from "./d";\n`);
    setContent("src/d.ts", `export const d = 1;\n`);
    const files = ["src/main.ts", "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"].map(ws.fileInfo);

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const path = graph.findImportPath("src/main.ts", "src/d.ts");
    assert.ok(path);
    assert.equal(path?.[0], "src/main.ts");
    assert.equal(path?.[path.length - 1], "src/d.ts");
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph findImportPath returns undefined when no path", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/main.ts", `import { a } from "./a";\n`);
    setContent("src/a.ts", `export const a = 1;\n`);
    setContent("src/unrelated.ts", `export const x = 1;\n`);
    const files = ["src/main.ts", "src/a.ts", "src/unrelated.ts"].map(ws.fileInfo);

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const path = graph.findImportPath("src/main.ts", "src/unrelated.ts");
    assert.equal(path, undefined);
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph detectCircularDependencies", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/a.ts", `import { b } from "./b";\n`);
    setContent("src/b.ts", `import { c } from "./c";\n`);
    setContent("src/c.ts", `import { a } from "./a";\n`);
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"].map(ws.fileInfo);

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const cycles = graph.detectCircularDependencies();
    assert.ok(cycles.length >= 1);
    assert.ok(cycles.some((cycle) => cycle.includes("src/a.ts") && cycle.includes("src/c.ts")));
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph getEntryPoints", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/main.ts", `import { a } from "./a";\n`);
    setContent("src/a.ts", `export const a = 1;\n`);
    const files = ["src/main.ts", "src/a.ts"].map(ws.fileInfo);

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const entryPoints = graph.getEntryPoints();
    assert.equal(entryPoints.length, 1);
    assert.equal(entryPoints[0], "src/main.ts");
  } finally {
    ws.cleanup();
  }
});

test("DependencyGraph getStats", async () => {
  const ws = createWorkspace();
  try {
    setContent("src/main.ts", `import { a } from "./a";\n`);
    setContent("src/a.ts", `export const a = 1;\n`);
    const files = ["src/main.ts", "src/a.ts"].map(ws.fileInfo);

    const graph = new DependencyGraph();
    graph.setWorkspaceRoot(ws.root);
    await graph.build(files);

    const stats = graph.getStats();
    assert.equal(stats.totalFiles, 2);
    assert.equal(stats.entryPoints, 1);
  } finally {
    ws.cleanup();
  }
});
