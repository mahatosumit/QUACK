import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { TestIntelligence } from "./test-intelligence.js";

describe("TestIntelligence", () => {
  const mockTestRunner = {
    discoverTests: mock.fn(async () => [
      { path: "src/a.test.ts", framework: "node-test", tests: [{ name: "should work", line: 10, isAsync: false, tags: [] }], language: "typescript" },
      { path: "src/b.test.ts", framework: "node-test", tests: [{ name: "should pass", line: 20, isAsync: false, tags: [] }], language: "typescript" },
    ]),
    runTests: mock.fn(async () => ({ framework: "node-test", total: 2, passed: 2, failed: 0, skipped: 0, durationMs: 100, failures: [] })),
  } as any;

  const mockSl = {
    testRunner: mockTestRunner,
    getFiles: mock.fn(() => []),
  } as any;

  const ti = new TestIntelligence(mockSl);

  it("selectAndRun returns a test selection", async () => {
    const result = await ti.selectAndRun("test something");
    assert.ok(result.allTests.length > 0);
    assert.ok(result.selectedForRun.length > 0);
    assert.ok(typeof result.estimatedRunTimeMs === "number");
  });

  it("runAffected returns a test run result", async () => {
    const result = await ti.runAffected(["src/a.ts"]);
    assert.ok(typeof result.total === "number");
    assert.ok(typeof result.passed === "number");
  });
});
