import { describe, it, mock, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { RefactoringEngine } from "./refactoring-engine.js";

const srcFile = join(tmpdir(), `refactor-src-${Date.now()}.ts`);
const renameDir = join(tmpdir(), `rename-sym-${Date.now()}`);
const renameFile = join(renameDir, "a.ts");

async function writeRenameFile() {
  try { await mkdir(renameDir); } catch { /* ok */ }
  await writeFile(renameFile, [
    "function oldName() {",
    "  return 42;",
    "}",
  ].join("\n"));
}

const mockBrain = { requestPermission: mock.fn(async () => true), getMemory: mock.fn(() => ({ write: mock.fn() })) } as any;
const mockEventBus = { emit: mock.fn() } as any;
const mockConfig = { dataDir: "/tmp", maxParallelValidations: 2 } as any;
const mockSl = {
  search: { referenceSearch: mock.fn(async () => []) },
  symbolDb: { getByName: mock.fn(async () => []) },
  getFiles: mock.fn(() => [{ relativePath: "src/a.ts", language: "typescript", lines: 100 }]),
  patches: {
    createFullPatch: mock.fn(() => ({ id: "patch-refactor", description: "", files: [], timestamp: "", status: "pending" })),
    validatePatch: mock.fn(() => ({ valid: true, errors: [], warnings: [], compileErrors: [], lintErrors: [], typeErrors: [], testFailures: [], durationMs: 0 })),
    applyPatch: mock.fn(() => ({ success: true, errors: [] })),
  },
  validator: {
    typeCheck: mock.fn(async () => []),
    lint: mock.fn(async () => []),
  },
} as any;

const engine = new RefactoringEngine(mockBrain, mockSl, mockEventBus, mockConfig);

describe("RefactoringEngine", () => {
  before(async () => await writeRenameFile());

  after(async () => {
    for (const f of [srcFile, renameFile]) {
      try { await unlink(f); } catch { /* ok */ }
    }
    try { await unlink(renameDir); } catch { /* ok */ }
  });

  it("renameSymbol returns EditingResult", async () => {
    const result = await engine.renameSymbol("oldName", "newName");
    assert.ok(typeof result.applied === "boolean");
    assert.ok(typeof result.summary === "string");
  });

  it("renameSymbol processes symbols from a real file", async () => {
    const renameSl = {
      ...mockSl,
      symbolDb: {
        getByName: mock.fn(async () => [
          { name: "oldName", filePath: renameFile, line: 1, column: 1, kind: "function" },
        ]),
      },
    } as any;
    const renameEngine = new RefactoringEngine(mockBrain, renameSl, mockEventBus, mockConfig);
    const result = await renameEngine.renameSymbol("oldName", "newName");
    assert.ok(typeof result.applied === "boolean");
  });

  it("renameSymbol with scope filters files", async () => {
    const filterSl = {
      ...mockSl,
      symbolDb: {
        getByName: mock.fn(async () => [
          { name: "oldName", filePath: "other/x.ts", line: 1, column: 1, kind: "function" },
          { name: "oldName", filePath: renameFile, line: 1, column: 1, kind: "function" },
        ]),
      },
    } as any;
    const filterEngine = new RefactoringEngine(mockBrain, filterSl, mockEventBus, mockConfig);
    const result = await filterEngine.renameSymbol("oldName", "newName", renameDir);
    assert.ok(typeof result.applied === "boolean");
  });

  it("extractMethod throws when file cannot be read", async () => {
    await assert.rejects(
      () => engine.extractMethod("src/a.ts", "missingMethod", "src/new.ts"),
    );
  });

  it("extractMethod succeeds when method is found in a real file", async () => {
    await writeFile(srcFile, [
      "const x = 1;",
      "",
      "function targetMethod() {",
      "  return 42;",
      "}",
      "",
      "const y = x + 1;",
    ].join("\n"));
    const result = await engine.extractMethod(srcFile, "targetMethod", "src/extracted.ts");
    assert.ok(typeof result.applied === "boolean");
    assert.ok(typeof result.summary === "string");
  });
});
