import test from "node:test";
import assert from "node:assert/strict";
import { SymbolDatabase } from "./symbol-database.js";
import { type SymbolInfo, type SymbolKind } from "../types.js";

function makeSymbol(overrides: Partial<SymbolInfo> & { name: string }): SymbolInfo {
  return {
    id: "sym_test",
    kind: "function" as SymbolKind,
    language: "typescript",
    filePath: "src/test.ts",
    line: 1,
    column: 0,
    endLine: 1,
    endColumn: 10,
    isExported: false,
    isAsync: false,
    modifiers: [],
    metadata: {},
    ...overrides,
  };
}

test("SymbolDatabase insert and getByName", async () => {
  const db = new SymbolDatabase();
  const sym = makeSymbol({ name: "myFunc", filePath: "src/test.ts" });
  db.insert(sym);

  const results = await db.getByName("myFunc");
  assert.equal(results.length, 1);
  assert.equal(results[0].name, "myFunc");
  assert.equal(results[0].filePath, "src/test.ts");
});

test("SymbolDatabase getByName returns empty for missing", async () => {
  const db = new SymbolDatabase();
  const results = await db.getByName("nonexistent");
  assert.deepEqual(results, []);
});

test("SymbolDatabase getByKind", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "fn1", kind: "function" }));
  db.insert(makeSymbol({ name: "cls1", kind: "class" }));
  db.insert(makeSymbol({ name: "fn2", kind: "function" }));

  const fns = await db.getByKind("function");
  assert.equal(fns.length, 2);

  const classes = await db.getByKind("class");
  assert.equal(classes.length, 1);

  const vars = await db.getByKind("variable");
  assert.equal(vars.length, 0);
});

test("SymbolDatabase getByFile", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "a", filePath: "src/a.ts" }));
  db.insert(makeSymbol({ name: "b", filePath: "src/b.ts" }));
  db.insert(makeSymbol({ name: "c", filePath: "src/a.ts" }));

  const aSyms = await db.getByFile("src/a.ts");
  assert.equal(aSyms.length, 2);

  const bSyms = await db.getByFile("src/b.ts");
  assert.equal(bSyms.length, 1);
});

test("SymbolDatabase fuzzySearch matches substrings", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "calculateTotal" }));
  db.insert(makeSymbol({ name: "calculateAverage" }));
  db.insert(makeSymbol({ name: "getUser" }));

  const results = await db.fuzzySearch("calc");
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.score > 0));
});

test("SymbolDatabase fuzzySearch returns score-ordered results", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "exactMatch" }));
  db.insert(makeSymbol({ name: "exactMatchToo" }));

  const results = await db.fuzzySearch("exact");
  assert.equal(results.length, 2);
  assert.ok(results[0].score >= results[1].score);
});

test("SymbolDatabase fuzzySearch returns empty on no match", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "foo" }));
  const results = await db.fuzzySearch("zzzzz");
  assert.equal(results.length, 0);
});

test("SymbolDatabase removeFile removes all symbols from file", async () => {
  const db = new SymbolDatabase();
  db.insert(makeSymbol({ name: "a", filePath: "src/a.ts" }));
  db.insert(makeSymbol({ name: "b", filePath: "src/a.ts" }));
  db.insert(makeSymbol({ name: "c", filePath: "src/b.ts" }));
  assert.equal((await db.getByFile("src/a.ts")).length, 2);

  db.removeFile("src/a.ts");
  assert.equal((await db.getByFile("src/a.ts")).length, 0);
  assert.equal((await db.getByFile("src/b.ts")).length, 1);
});

test("SymbolDatabase stats", async () => {
  const db = new SymbolDatabase();
  const emptyStats = await db.stats();
  assert.equal(emptyStats.totalSymbols, 0);

  db.insert(makeSymbol({ name: "fn", kind: "function" }));
  db.insert(makeSymbol({ name: "cls", kind: "class" }));

  const stats = await db.stats();
  assert.equal(stats.totalSymbols, 2);
  assert.equal(stats.topFiles.length, 1);
  assert.equal(stats.byKind["function"], 1);
  assert.equal(stats.byKind["class"], 1);
});
