import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { ArchitectureAnalyzer } from "./architecture-analyzer.js";

describe("ArchitectureAnalyzer", () => {
  const mockSl = {
    getFiles: mock.fn(() => [
      { relativePath: "src/ui/App.tsx", language: "typescript", lines: 10 },
      { relativePath: "src/app/useCases.ts", language: "typescript", lines: 20 },
      { relativePath: "src/domain/entity.ts", language: "typescript", lines: 15 },
      { relativePath: "src/infra/db.ts", language: "typescript", lines: 30 },
    ]),
    depGraph: {
      getDependencies: mock.fn(() => []),
      getEntryPoints: mock.fn(() => []),
      getStats: mock.fn(() => ({})),
      getModuleGraph: mock.fn(() => ({})),
    },
  } as any;

  const analyzer = new ArchitectureAnalyzer(mockSl);

  it("detects layers from file paths", async () => {
    const result = await analyzer.analyze();
    const layerNames = result.architectureLayers.map((l) => l.layer);
    assert.ok(layerNames.includes("presentation"), `Expected presentation, got ${JSON.stringify(layerNames)}`);
    assert.ok(layerNames.includes("application"));
    assert.ok(layerNames.includes("domain"));
    assert.ok(layerNames.includes("infrastructure"));
  });

  it("returns fileCount and lineCount", async () => {
    const result = await analyzer.analyze();
    assert.equal(result.fileCount, 4);
    assert.equal(result.lineCount, 75);
  });
});

describe("ArchitectureAnalyzer - no layers", () => {
  it("returns unknown layer when no architectural keywords match", async () => {
    const flatSl = {
      getFiles: mock.fn(() => [
        { relativePath: "src/misc/util.ts", language: "typescript", lines: 10 },
        { relativePath: "src/misc/helper.ts", language: "typescript", lines: 20 },
      ]),
      depGraph: {
        getDependencies: mock.fn(() => []),
        getEntryPoints: mock.fn(() => []),
        getStats: mock.fn(() => ({})),
        getModuleGraph: mock.fn(() => ({})),
      },
    } as any;
    const analyzer = new ArchitectureAnalyzer(flatSl);
    const result = await analyzer.analyze();
    assert.equal(result.architectureLayers.length, 1);
    assert.equal(result.architectureLayers[0].layer, "unknown");
  });
});
