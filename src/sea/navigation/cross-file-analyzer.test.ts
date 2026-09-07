import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { CrossFileAnalyzer } from "./cross-file-analyzer.js";

describe("CrossFileAnalyzer", () => {
  const mockSl = {
    depGraph: {
      getDependents: mock.fn((f: string) => {
        if (f === "src/a.ts") return ["b.ts", "c.ts"];
        if (f === "b.ts") return ["d.ts"];
        return [];
      }),
      getDependencies: mock.fn((f: string) => {
        if (f === "src/a.ts") return [{ targetFile: "src/lib.ts" }];
        return [];
      }),
      getModuleGraph: mock.fn(() => ({})),
    },
    search: {
      referenceSearch: mock.fn(async () => [{ file: "src/ref.ts", line: 1, column: 1, context: { before: [], after: [] } }]),
    },
  } as any;

  const analyzer = new CrossFileAnalyzer(mockSl);

  it("analyzeImpact finds transitive dependents and references", async () => {
    const result = await analyzer.analyzeImpact("foo", "src/a.ts");
    assert.ok(result.directDependents.includes("b.ts"));
    assert.ok(result.directDependents.includes("c.ts"));
    assert.ok(result.transitiveDependents.includes("d.ts"));
    assert.equal(result.riskLevel, "low");
  });

  it("analyzeImpact returns low risk for leaf symbol", async () => {
    const result = await analyzer.analyzeImpact("leaf", "src/leaf.ts");
    assert.equal(result.totalImpact, 1);
    assert.equal(result.riskLevel, "low");
  });

  it("findRelatedFiles returns deps and dependents for a file", async () => {
    const result = await analyzer.findRelatedFiles("src/a.ts");
    assert.ok(result.includes("src/lib.ts"));
    assert.ok(result.includes("b.ts"));
    assert.ok(result.includes("c.ts"));
  });
});
