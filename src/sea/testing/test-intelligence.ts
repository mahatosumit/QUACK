import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type TestFile, type TestCase, type TestRunResult, type TestFailure } from "../../intelligence/types.js";
import { type TestSelection } from "../types.js";

export class TestIntelligence {
  constructor(private readonly sl: SemanticLayer) {}

  async selectAndRun(goal: string): Promise<TestSelection> {
    const testRunner = this.sl.testRunner;
    const files = this.sl.getFiles();
    const testFiles = await testRunner.discoverTests(files);

    const allTestPaths = testFiles.map((tf) => tf.path);
    const affectedTests = this.findAffectedTests(goal, testFiles);
    const strategy = affectedTests.length > 0 ? "affected" : "smart";

    const selected = strategy === "affected"
      ? affectedTests
      : testFiles.slice(0, Math.min(5, testFiles.length));

    return {
      allTests: allTestPaths,
      affectedTests: affectedTests.map((tf) => tf.path),
      selectedForRun: selected.map((tf) => tf.path),
      selectionStrategy: strategy,
      estimatedRunTimeMs: selected.length * 5000,
    };
  }

  private findAffectedTests(goal: string, testFiles: readonly TestFile[]): TestFile[] {
    const lower = goal.toLowerCase();
    return testFiles.filter((tf) => {
      const path = tf.path.toLowerCase();
      if (lower.includes(path.replace(/\\/g, "/").split("/").pop() ?? "")) return true;
      return tf.tests.some((tc) => {
        const name = tc.name.toLowerCase();
        return lower.split(" ").some((word) => word.length > 3 && name.includes(word));
      });
    });
  }

  async runAffected(modifiedFiles: readonly string[]): Promise<TestRunResult> {
    const testRunner = this.sl.testRunner;
    const files = this.sl.getFiles();
    const allTestFiles = await testRunner.discoverTests(files);

    const affectedTestFiles = allTestFiles.filter((tf) =>
      modifiedFiles.some((mf) => {
        const rel = mf.replace(/\\/g, "/");
        return tf.path.includes(rel.replace(/\.\w+$/, ""));
      }),
    );

    if (affectedTestFiles.length === 0) {
      return { framework: "unknown", total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, failures: [] };
    }

    return testRunner.runTests(affectedTestFiles);
  }
}
