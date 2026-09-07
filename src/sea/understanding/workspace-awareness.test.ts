import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { WorkspaceAwareness } from "./workspace-awareness.js";

describe("WorkspaceAwareness", () => {
  const makeSl = (overrides = {}) => {
    const base = {
      getMetadata: mock.fn(() => ({
        totalFiles: 10,
        totalLines: 500,
        languages: {},
        lastIndexed: "2026-01-01T00:00:00.000Z",
        coverage: {},
        coveragePercentage: 0,
        errors: [],
        name: "proj",
        buildSystems: [],
      })),
      getFiles: mock.fn(() => [{ relativePath: "tsconfig.json", language: "json", lines: 20 }]),
      isIndexed: mock.fn(() => true),
      symbolDb: { stats: mock.fn(async () => ({ totalSymbols: 42 })) },
      validator: {
        typeCheck: mock.fn(async () => ["error TS2322"]),
        lint: mock.fn(async () => []),
      },
    };
    return { ...base, ...overrides } as any;
  };

  it("assess returns score based on errors", async () => {
    const wa = new WorkspaceAwareness(makeSl());
    const result = await wa.assess();
    assert.equal(result.score, 9);
    assert.equal(result.totalFiles, 1);
  });

  it("assess scores lower when not indexed", async () => {
    const wa = new WorkspaceAwareness(makeSl({ isIndexed: mock.fn(() => false) }));
    const result = await wa.assess();
    assert.equal(result.score, 6);
  });

  it("assess triggers eslint check when eslintrc file present", async () => {
    const sl = makeSl({
      getFiles: mock.fn(() => [
        { relativePath: "tsconfig.json", language: "json", lines: 20 },
        { relativePath: ".eslintrc.json", language: "json", lines: 5 },
      ]),
      validator: {
        typeCheck: mock.fn(async () => []),
        lint: mock.fn(async () => ["no-unused-vars"]),
      },
    });
    const wa = new WorkspaceAwareness(sl);
    const result = await wa.assess();
    assert.ok(result.lintErrors.includes("no-unused-vars"));
    assert.ok(result.recommendations.some((r) => r.includes("lint")));
  });
});
