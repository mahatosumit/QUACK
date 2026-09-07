import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SymbolDatabase } from "../symbols/symbol-database.js";
import { SemanticSearch } from "./semantic-search.js";
import { InMemoryKnowledgeGraphStore } from "../../memory/knowledge-graph.js";
import { InMemoryMemoryStore } from "../../memory/memory.js";

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "main.ts"), `export function hello() { return "world"; }\n`);
  writeFileSync(join(root, "src", "utils.ts"), `export function add(a: number, b: number) { return a + b; }\n`);
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("SemanticSearch textSearch finds matching files", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const kg = new InMemoryKnowledgeGraphStore();
    const mem = new InMemoryMemoryStore();
    const search = new SemanticSearch(root, db, kg, mem);

    const results = await search.search({ mode: "text", query: "hello" });
    assert.ok(results.length >= 1);
    assert.ok(results.some((r) => r.file.includes("main.ts")));
  } finally {
    cleanup();
  }
});

test("SemanticSearch regexSearch", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const kg = new InMemoryKnowledgeGraphStore();
    const mem = new InMemoryMemoryStore();
    const search = new SemanticSearch(root, db, kg, mem);

    const results = await search.search({ mode: "regex", query: "export\\s+function" });
    assert.ok(results.length >= 1);
  } finally {
    cleanup();
  }
});

test("SemanticSearch fileSearch finds by filename", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const kg = new InMemoryKnowledgeGraphStore();
    const mem = new InMemoryMemoryStore();
    const search = new SemanticSearch(root, db, kg, mem);

    const results = await search.search({ mode: "file", query: "main.ts" });
    assert.ok(results.length >= 1);
    assert.ok(results[0].file.endsWith("main.ts"));
  } finally {
    cleanup();
  }
});

test("SemanticSearch returns empty for no match", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const kg = new InMemoryKnowledgeGraphStore();
    const mem = new InMemoryMemoryStore();
    const search = new SemanticSearch(root, db, kg, mem);

    const results = await search.search({ mode: "text", query: "zzzz_notfound_xxxx" });
    assert.equal(results.length, 0);
  } finally {
    cleanup();
  }
});

test("SemanticSearch respects language filter", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const db = new SymbolDatabase();
    const kg = new InMemoryKnowledgeGraphStore();
    const mem = new InMemoryMemoryStore();
    const search = new SemanticSearch(root, db, kg, mem);

    const results = await search.search({ mode: "text", query: "function", language: "typescript" });
    assert.ok(results.length >= 1);
  } finally {
    cleanup();
  }
});
