import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { TestAnalyzer } from "./test-analyzer.js";

describe("TestAnalyzer", () => {
  const analyzer = new TestAnalyzer();

  it("analyzeFailure returns analysis with likelyCause", async () => {
    const result = analyzer.analyzeFailure("test1", "AssertionError: expected 1 to equal 2");
    assert.ok(result.likelyCause.includes("Assertion"));
    assert.equal(result.testName, "test1");
  });

  it("analyzeFailure detects type errors", async () => {
    const result = analyzer.analyzeFailure("test2", "TypeError: Cannot read property of undefined");
    assert.ok(result.likelyCause.includes("undefined"));
    assert.ok(result.suggestedFix !== undefined);
  });
});
