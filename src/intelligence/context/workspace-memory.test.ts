import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkspaceMemory } from "./workspace-memory.js";
import { type Language } from "../types.js";

function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("WorkspaceMemory set and get", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    await mem.set("test-key", { foo: "bar" });
    const value = await mem.get("test-key");
    assert.deepEqual(value, { foo: "bar" });
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory get returns undefined for missing key", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    const value = await mem.get("nonexistent");
    assert.equal(value, undefined);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory delete removes key", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    await mem.set("temp", "value");
    assert.ok(await mem.get("temp"));
    await mem.delete("temp");
    assert.equal(await mem.get("temp"), undefined);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory clear removes all", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    await mem.set("a", 1);
    await mem.set("b", 2);
    await mem.clear();
    assert.equal(await mem.get("a"), undefined);
    assert.equal(await mem.get("b"), undefined);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory TTL expiration", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    await mem.set("ephemeral", "data", 1);
    await new Promise((r) => setTimeout(r, 10));
    const value = await mem.get("ephemeral");
    assert.equal(value, undefined);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory save and load workspace metadata", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    const languages: Language[] = ["typescript"];
    const metadata = {
      root: dir,
      name: "test-project",
      languages,
      buildSystems: ["npm"] as any,
      testFrameworks: ["node:test"] as any,
      fileCount: 10,
      totalLines: 100,
      directoryCount: 3,
      hasGit: false,
      lastIndexed: new Date().toISOString(),
      indexedFileCount: 5,
      totalSymbols: 20,
      totalDependencies: 3,
    };

    await mem.saveWorkspaceMetadata(metadata);
    const loaded = await mem.loadWorkspaceMetadata();
    assert.ok(loaded);
    assert.equal(loaded?.name, "test-project");
    assert.equal(loaded?.fileCount, 10);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory save and load symbol index", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    await mem.saveSymbolIndex({ "src/test.ts": 3 });
    const loaded = await mem.loadSymbolIndex();
    assert.ok(loaded);
    assert.equal(loaded?.["src/test.ts"], 3);
  } finally {
    cleanup();
  }
});

test("WorkspaceMemory save and load index state", async () => {
  const { dir, cleanup } = createTempDir();
  try {
    const mem = new WorkspaceMemory(dir);
    const state = { lastIndexed: new Date().toISOString(), fileCount: 5, totalLines: 100 };
    await mem.saveIndexState(state);
    const loaded = await mem.loadIndexState();
    assert.ok(loaded);
    assert.equal(loaded?.fileCount, 5);
  } finally {
    cleanup();
  }
});
