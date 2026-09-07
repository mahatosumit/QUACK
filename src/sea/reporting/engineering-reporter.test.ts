import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { EngineeringReporter } from "./engineering-reporter.js";

describe("EngineeringReporter", () => {
  const mockSl = {
    getFiles: mock.fn(() => [
      { relativePath: "src/a.ts", language: "typescript", lines: 100 },
      { relativePath: "src/large.ts", language: "typescript", lines: 600 },
    ]),
    getMetadata: mock.fn(() => ({
      totalFiles: 2,
      totalLines: 150,
      languages: ["typescript"],
      lastIndexed: "2026-01-01T00:00:00.000Z",
      coverage: { "src/a.ts": { statements: 80, branches: 70, functions: 85, lines: 80 } },
      coveragePercentage: 80,
      errors: [{ file: "a.ts", line: 1, message: "err", severity: "error" as const }],
      name: "proj",
      buildSystems: ["tsc"],
    })),
    testRunner: {
      discoverTests: mock.fn(async () => [
        { path: "src/a.test.ts", framework: "node-test", tests: [{ name: "test1", line: 5, isAsync: false, tags: [] }], language: "typescript" },
        { path: "src/b.test.ts", framework: "node-test", tests: [{ name: "test2", line: 10, isAsync: false, tags: [] }], language: "typescript" },
      ]),
    },
    depGraph: {
      getStats: mock.fn(() => ({ totalFiles: 2, totalDeps: 3, entryPoints: 1, avgDependencies: 1.5, maxDependencies: 2, avgDependents: 1, maxDependents: 2, moduleCount: 2 })),
      getModuleGraph: mock.fn(() => ({ moduleA: ["moduleB"], moduleB: [] })),
      detectCircularDependencies: mock.fn(() => [["moduleA", "moduleB", "moduleA"]]),
      getEntryPoints: mock.fn(() => ["src/main.ts"]),
    },
    symbolDb: { stats: mock.fn(async () => ({ totalSymbols: 50, byKind: { function: 30, class: 10, interface: 10 }, byLanguage: { typescript: 50 }, topFiles: [{ path: "src/a.ts", count: 20 }] })) },
    isIndexed: mock.fn(() => true),
  } as any;

  const reporter = new EngineeringReporter(mockSl);

  it("generate creates an architecture report", async () => {
    const report = await reporter.generate("architecture");
    assert.equal(report.type, "architecture");
    assert.ok(report.sections.length > 0);
  });

  it("generate creates a test report", async () => {
    const report = await reporter.generate("test");
    assert.equal(report.type, "test");
  });

  it("generate creates a workspace-health report", async () => {
    const report = await reporter.generate("workspace-health");
    assert.equal(report.type, "workspace-health");
  });

  it("generate creates a dependencies report", async () => {
    const report = await reporter.generate("dependencies");
    assert.equal(report.type, "dependencies");
    assert.ok(report.summary.includes("dependency edges"));
  });

  it("generate creates a technical-debt report", async () => {
    const report = await reporter.generate("technical-debt");
    assert.equal(report.type, "technical-debt");
    assert.ok(report.summary.includes("large files"));
  });

  it("generate falls back to architecture for unknown type", async () => {
    const report = await reporter.generate("unknown" as any);
    assert.equal(report.type, "architecture");
  });

  it("dependency report includes circular dependency info", async () => {
    const report = await reporter.generate("dependencies");
    const circSec = report.sections.find((s) => s.title === "Circular Dependencies");
    assert.ok(circSec);
    assert.equal(circSec!.severity, "error");
  });

  it("architecture report includes recommendations for cycles", async () => {
    const report = await reporter.generate("architecture");
    assert.ok(report.recommendations.length > 0);
  });
});
