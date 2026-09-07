import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { RepositoryUnderstanding } from "./repository-understanding.js";

describe("RepositoryUnderstanding", () => {
  const mockSl = {
    getFiles: mock.fn(() => [
      { relativePath: "src/a.ts", language: "typescript", lines: 50 },
      { relativePath: "src/b.ts", language: "typescript", lines: 50 },
    ]),
    symbolDb: { getByFile: mock.fn(async () => []) },
    depGraph: { getDependencies: mock.fn(() => []), getEntryPoints: mock.fn(() => []), getStats: mock.fn(() => ({})), getModuleGraph: mock.fn(() => ({})) },
    search: mock.fn(async () => []),
    getMetadata: mock.fn(() => ({
      name: "test-proj",
      totalFiles: 2,
      totalLines: 100,
      languages: { typescript: 2 },
      lastIndexed: "2026-01-01T00:00:00.000Z",
      coverage: {},
      coveragePercentage: 0,
      errors: [],
      buildSystems: [],
    })),
  } as any;

  const ru = new RepositoryUnderstanding(mockSl);

  it("summarize returns languages, fileCount, lineCount", async () => {
    const result = await ru.summarize();
    assert.ok(result.languages.includes("typescript"));
    assert.equal(result.fileCount, 2);
    assert.equal(result.lineCount, 100);
  });
});
