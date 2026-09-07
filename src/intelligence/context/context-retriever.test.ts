import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ContextRetriever } from "./context-retriever.js";
import { SymbolDatabase } from "../symbols/symbol-database.js";
import { InMemoryMemoryStore } from "../../memory/memory.js";
import { InMemoryKnowledgeGraphStore } from "../../memory/knowledge-graph.js";
import { type FileInfo } from "../types.js";

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), `export function hello() { return "world"; }`);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("ContextRetriever retrieveForGoal returns structured context", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const mem = new InMemoryMemoryStore();
    const kg = new InMemoryKnowledgeGraphStore();
    const retriever = new ContextRetriever(root, db, mem, kg);

    const files: FileInfo[] = [
      { path: join(root, "src", "main.ts"), relativePath: "src/main.ts", language: "typescript", size: 45, lines: 1, modifiedAt: new Date().toISOString(), isDirectory: false },
    ];

    const ctx = await retriever.retrieveForGoal("hello world", files);
    assert.equal(ctx.goal, "hello world");
    assert.ok(ctx.workspaceSummary.length > 0);
    assert.ok(Array.isArray(ctx.relevantFiles));
    assert.ok(Array.isArray(ctx.relevantSymbols));
    assert.ok(Array.isArray(ctx.memoryHits));
  } finally {
    cleanup();
  }
});

test("ContextRetriever getWorkspaceSnapshot", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const mem = new InMemoryMemoryStore();
    const retriever = new ContextRetriever(root, db, mem);

    const files: FileInfo[] = [
      { path: join(root, "src", "main.ts"), relativePath: "src/main.ts", language: "typescript", size: 45, lines: 1, modifiedAt: new Date().toISOString(), isDirectory: false },
    ];

    const snapshot = retriever.getWorkspaceSnapshot(files);
    assert.ok(snapshot.includes("src"));
    assert.ok(snapshot.includes("typescript"));
  } finally {
    cleanup();
  }
});

test("ContextRetriever handles empty workspace", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const mem = new InMemoryMemoryStore();
    const retriever = new ContextRetriever(root, db, mem);

    const ctx = await retriever.retrieveForGoal("test", []);
    assert.equal(ctx.relevantFiles.length, 0);
    assert.equal(ctx.relevantSymbols.length, 0);
    assert.ok(ctx.workspaceSummary.length > 0);
  } finally {
    cleanup();
  }
});
