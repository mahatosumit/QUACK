import { describe, it, mock, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SemanticNavigator } from "./semantic-navigator.js";

const testFile = join(tmpdir(), `semnav-test-${Date.now()}.ts`);

describe("SemanticNavigator", () => {
  const mockSl = {
    symbolDb: {
      getByName: mock.fn(async () => [
        { name: "foo", filePath: "src/a.ts", line: 5, column: 1, kind: "function" },
      ]),
    },
    search: {
      referenceSearch: mock.fn(async () => [
        { file: "src/b.ts", line: 10, column: 1, context: { before: ["// ref"], after: [""] } },
      ]),
    },
    lsp: {
      findDefinition: mock.fn(async () => ({ uri: testFile, line: 2 })),
    },
    getFiles: mock.fn(() => [{ relativePath: "src/a.ts", language: "typescript" }, { relativePath: "src/resolve.ts", language: "typescript" }]),
  } as any;

  const nav = new SemanticNavigator(mockSl);

  after(async () => {
    try { await unlink(testFile); } catch { /* ok */ }
  });

  it("findDefinition returns definition with symbol info", async () => {
    const result = await nav.findDefinition("foo", "src/a.ts");
    assert.ok(result !== undefined);
    assert.equal(result!.symbol, "foo");
    assert.equal(result!.file, "src/a.ts");
  });

  it("findDefinition returns undefined when symbol not found", async () => {
    const emptySl = {
      symbolDb: { getByName: mock.fn(async () => []) },
      search: { referenceSearch: mock.fn(async () => []) },
      lsp: { findDefinition: mock.fn(async () => undefined) },
      getFiles: mock.fn(() => []),
    } as any;
    const emptyNav = new SemanticNavigator(emptySl);
    const result = await emptyNav.findDefinition("missing", "src/x.ts");
    assert.equal(result, undefined);
  });

  it("findReferences returns reference locations", async () => {
    const result = await nav.findReferences("foo");
    assert.equal(result.symbol, "foo");
    assert.ok(result.totalCount > 0);
  });

  it("getCallHierarchy returns callers and callees", async () => {
    const result = await nav.getCallHierarchy("foo");
    assert.ok(result.callers.length > 0);
    assert.ok(result.callees.length === 0);
  });

  it("getCallHierarchy with empty symbol db returns empty callers and callees", async () => {
    await writeFile(testFile, "doSomething()\nconst x = 1;\n");
    const emptySl = {
      symbolDb: { getByName: mock.fn(async () => []) },
      search: { referenceSearch: mock.fn(async () => []) },
      lsp: { findDefinition: mock.fn(async () => undefined) },
      getFiles: mock.fn(() => [{ relativePath: "src/resolve.ts", language: "typescript" }]),
    } as any;
    const emptyNav = new SemanticNavigator(emptySl);
    const result = await emptyNav.getCallHierarchy("missing");
    assert.ok(result.callers.length === 0);
    assert.ok(result.callees.length === 0);
  });

  it("getCallHierarchy extracts called symbols from a real file", async () => {
    await writeFile(testFile, "function foo() {\n  bar()\n  baz()\n}\n");
    const realSl = {
      symbolDb: { getByName: mock.fn(async () => [
        { name: "foo", filePath: testFile, line: 1, column: 1, kind: "function" },
      ])},
      search: { referenceSearch: mock.fn(async () => [
        { file: "src/b.ts", line: 10, column: 1, context: { before: [], after: [""] } },
      ])},
      lsp: { findDefinition: mock.fn(async () => undefined) },
      getFiles: mock.fn(() => []),
    } as any;
    const realNav = new SemanticNavigator(realSl);
    const result = await realNav.getCallHierarchy("foo");
    assert.ok(result.callees.length > 0);
  });

  it("resolveSymbolAtLocation returns undefined for non-existent file", async () => {
    const result = await nav.resolveSymbolAtLocation("src/nonexistent.ts", 1, 1);
    assert.equal(result, undefined);
  });

  it("resolveSymbolAtLocation returns symbol name for a real file with definition", async () => {
    await writeFile(testFile, "myFunc()\nfunction myFunc() {\n  return x;\n}\n");
    const resolveSl = {
      symbolDb: { getByName: mock.fn(async () => []) },
      search: { referenceSearch: mock.fn(async () => []) },
      lsp: { findDefinition: mock.fn(async () => ({ uri: testFile, line: 2 })) },
      getFiles: mock.fn(() => [{ relativePath: "src/resolve.ts", language: "typescript" }]),
    } as any;
    const resolveNav = new SemanticNavigator(resolveSl);
    const result = await resolveNav.resolveSymbolAtLocation("src/resolve.ts", 2, 1);
    assert.equal(result, "myFunc");
  });

  it("resolveSymbolAtLocation falls back when lsp returns nothing", async () => {
    const noLspSl = {
      symbolDb: { getByName: mock.fn(async () => []) },
      search: { referenceSearch: mock.fn(async () => []) },
      lsp: { findDefinition: mock.fn(async () => undefined) },
      getFiles: mock.fn(() => [{ relativePath: "src/resolve.ts", language: "typescript" }]),
    } as any;
    const noLspNav = new SemanticNavigator(noLspSl);
    const result = await noLspNav.resolveSymbolAtLocation("src/resolve.ts", 1, 1);
    assert.equal(result, undefined);
  });
});
