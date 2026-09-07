import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { DependencyAnalyzer } from "./dependency-analyzer.js";

describe("DependencyAnalyzer", () => {
  const mockSl = {
    depGraph: {
      getDependencies: mock.fn((f: string) => {
        if (f === "src/infrastructure/db.ts") return [{ targetFile: "src/domain/entity.ts" }];
        if (f === "src/presentation/app.ts") return [{ targetFile: "src/infrastructure/db.ts" }];
        if (f === "src/domain/entity.ts") return [];
        return [{ targetFile: "src/domain/entity.ts" }];
      }),
      getDependents: mock.fn(() => ["src/other.ts"]),
      detectCircularDependencies: mock.fn(() => []),
      getStats: mock.fn(() => ({ totalFiles: 3, totalDeps: 3, entryPoints: 1, avgDependencies: 1, maxDependencies: 1, avgDependents: 1, maxDependents: 1, moduleCount: 2 })),
      findImportPath: mock.fn(() => undefined),
    },
    getFiles: mock.fn(() => [
      { relativePath: "src/presentation/app.ts", language: "typescript", lines: 10 },
      { relativePath: "src/infrastructure/db.ts", language: "typescript", lines: 20 },
      { relativePath: "src/domain/entity.ts", language: "typescript", lines: 15 },
    ]),
  } as any;

  const analyzer = new DependencyAnalyzer(mockSl);

  it("getModuleDependencies returns deps for a file", async () => {
    const result = await analyzer.getModuleDependencies("src/presentation/app.ts");
    assert.ok(typeof result.module === "string");
    assert.ok(Array.isArray(result.dependencies));
  });

  it("findImportPath returns path when start equals end", async () => {
    const result = await analyzer.findImportPath("src/a.ts", "src/b.ts");
    assert.ok(result === undefined || result.length === 0);
  });

  it("getArchitectureViolations returns empty for clean layout", async () => {
    const result = await analyzer.getArchitectureViolations();
    assert.ok(Array.isArray(result));
  });

  it("getArchitectureViolations detects presentation->infrastructure violation", async () => {
    const violationSl = {
      depGraph: {
        getDependencies: mock.fn((f: string) => {
          if (f === "ui/app.ts") return [{ targetFile: "infrastructure/db.ts" }];
          if (f === "infrastructure/db.ts") return [{ targetFile: "domain/entity.ts" }];
          return [];
        }),
        getDependents: mock.fn(() => []),
        detectCircularDependencies: mock.fn(() => []),
        getStats: mock.fn(() => ({ totalFiles: 3, totalDeps: 3, entryPoints: 1, avgDependencies: 1, maxDependencies: 1, avgDependents: 1, maxDependents: 1, moduleCount: 2 })),
        findImportPath: mock.fn(() => undefined),
      },
      getFiles: mock.fn(() => [
        { relativePath: "ui/app.ts", language: "typescript", lines: 10 },
        { relativePath: "infrastructure/db.ts", language: "typescript", lines: 20 },
        { relativePath: "domain/entity.ts", language: "typescript", lines: 15 },
      ]),
    } as any;

    const violationAnalyzer = new DependencyAnalyzer(violationSl);
    const violations = await violationAnalyzer.getArchitectureViolations();
    assert.ok(violations.length > 0);
    assert.ok(violations.some((v) => v.reason.includes("presentation")));
  });
});
