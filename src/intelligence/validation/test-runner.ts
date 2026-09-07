import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type TestFile, type TestCase, type TestRunResult, type TestFailure, type TestFramework } from "../types.js";
import { type FileInfo } from "../types.js";
import { detectLanguage } from "../languages/language-detector.js";
import { childProcessEnvironment, executeProcess, resolveNodeCliArgv } from "../../platform/process.js";

export interface TestRunnerConfig {
  readonly workspaceRoot: string;
  readonly defaultTimeoutMs: number;
}

/**
 * TestRunner discovers and executes test suites across multiple frameworks.
 */
export class TestRunner {
  constructor(private readonly config: TestRunnerConfig) {}

  async discoverTests(files: readonly FileInfo[]): Promise<TestFile[]> {
    const testFiles: TestFile[] = [];

    for (const file of files) {
      const framework = this.detectFramework(file);
      if (framework === "unknown") continue;

      try {
        const content = readFileSync(file.path, "utf-8");
        const tests = this.extractTestCases(content, framework);
        testFiles.push({
          path: file.path,
          framework,
          tests,
          language: file.language,
        });
      } catch { continue; }
    }

    return testFiles;
  }

  async runTests(testFiles: readonly TestFile[]): Promise<TestRunResult> {
    // Determine framework from test files
    const frameworks = new Set(testFiles.map((t) => t.framework));
    const allResults: TestRunResult[] = [];

    for (const framework of frameworks) {
      const result = await this.runFrameworkTests(framework, testFiles.filter((t) => t.framework === framework));
      allResults.push(result);
    }

    return this.mergeResults(allResults);
  }

  /**
   * Run all discoverable tests in the workspace.
   */
  async runAllTests(): Promise<TestRunResult> {
    const result = await this.runFrameworkTests("node:test", []);
    return result;
  }

  private detectFramework(file: FileInfo): TestFramework {
    const name = file.relativePath.toLowerCase();
    if (name.includes("vitest")) return "vitest";
    if (name.includes("jest")) return "jest";
    if (name.endsWith(".test.ts") || name.endsWith(".test.js") || name.endsWith(".spec.ts")) return "node:test";
    if (file.language === "python" && (name.startsWith("test_") || name.endsWith("_test.py"))) return "pytest";
    if (file.language === "rust" && name.endsWith("_test.rs")) return "cargo-test";
    if (file.language === "go" && name.endsWith("_test.go")) return "go-test";
    return "unknown";
  }

  private extractTestCases(content: string, framework: TestFramework): TestCase[] {
    const cases: TestCase[] = [];
    const lines = content.split("\n");

    switch (framework) {
      case "node:test": {
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/(?:test|it|describe)\s*\(\s*['"`]([^'"`]+)['"`]/);
          if (m) cases.push({
            name: m[1], line: i + 1,
            isAsync: lines[i].includes("async"),
            tags: [],
          });
        }
        break;
      }
      case "pytest": {
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^(?:async\s+)?def\s+(test_\w+)/);
          if (m) cases.push({
            name: m[1], line: i + 1,
            isAsync: lines[i].includes("async"),
            tags: [],
          });
        }
        break;
      }
      case "cargo-test": {
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/#\[test\]\s*\n\s*(?:fn\s+(\w+))/);
          if (m) cases.push({
            name: m[1], line: i + 1,
            isAsync: false,
            tags: [],
          });
        }
        break;
      }
    }

    return cases;
  }

  private async runFrameworkTests(framework: TestFramework, files: readonly TestFile[]): Promise<TestRunResult> {
    const startTime = Date.now();

    try {
      switch (framework) {
        case "node:test":
        case "vitest":
        case "jest": {
          const argv = this.detectTestArgv(framework);
          if (!argv) return { framework, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, failures: [] };
          const output = await this.runArgv(argv);
          return this.parseNodeTestOutput(output, framework);
        }
        case "pytest": {
          const output = await this.runArgv({ command: "python", args: ["-m", "pytest", "--tb=short", "-q"] });
          return this.parsePytestOutput(output);
        }
        case "cargo-test": {
          // Non-zero (incl. "no tests" targets) reports an empty run; the
          // original shell-echo masking is preserved as an explicit
          // empty-result instead of a swallowed exit code.
          const result = await this.runArgv({ command: "cargo", args: ["test", "--no-run"], allowFailure: true });
          void result;
          return { framework, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime, failures: [] };
        }
        default:
          return { framework, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, failures: [] };
      }
    } catch (error) {
      return {
        framework,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: Date.now() - startTime,
        failures: [{
          test: "framework",
          file: "unknown",
          line: 0,
          message: error instanceof Error ? error.message : "Unknown error",
        }],
      };
    }
  }

  /** Run one governed argv invocation and return merged stdout/stderr text. */
  private async runArgv(argv: { command: string; args: readonly string[]; allowFailure?: boolean }): Promise<string> {
    const result = await executeProcess({
      command: argv.command,
      args: argv.args,
      workingDirectory: this.config.workspaceRoot,
      environment: childProcessEnvironment(),
      timeoutMs: this.config.defaultTimeoutMs,
    });
    if (result.status !== "COMPLETED" || (result.exitCode !== 0 && !argv.allowFailure)) {
      throw new Error(`${argv.command} ${result.status} (exit ${result.exitCode ?? "null"})${result.stderr ? ": " + result.stderr.trim().slice(0, 500) : ""}`);
    }
    return result.stdout + (result.stderr ? "\n" + result.stderr : "");
  }

  /**
   * Resolve the test invocation for JS frameworks to argv. A package.json
   * `test` script is reused only when it is a plain `node --test …` prefix
   * (safe argv tail); vitest/jest fall back to the bundled tool through
   * npx. Shell scripts, operators, and globs are never executed.
   */
  private detectTestArgv(framework: TestFramework): { command: string; args: string[] } | undefined {
    const pkgPath = resolve(this.config.workspaceRoot, "package.json");
    if (!existsSync(pkgPath)) return undefined;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      const scripts = (pkg.scripts ?? {}) as Record<string, string>;
      const script = scripts.test;

      if (framework === "node:test") {
        if (typeof script === "string" && script.startsWith("node --test")) {
          const tail = script.slice("node --test".length).trim().split(/\s+/).filter(Boolean);
          // Strip POSIX-only quoted glob patterns; node --test accepts
          // directories/files, not shell globs.
          const targets = tail.filter((part) => !part.includes("*") && !part.includes("'") && !part.includes('"'));
          return { command: process.execPath, args: ["--test", ...(targets.length > 0 ? targets : [])] };
        }
        return { command: process.execPath, args: ["--test"] };
      }

      if (framework === "vitest" || framework === "jest") {
        const invocation = resolveNodeCliArgv("npx", [framework === "vitest" ? "vitest" : "jest", "run", "--reporter=verbose"]);
        if (!invocation) return undefined;
        return invocation;
      }

      return undefined;
    } catch { return undefined; }
  }

  private parseNodeTestOutput(output: string, framework: TestFramework): TestRunResult {
    const failures: TestFailure[] = [];
    let total = 0, passed = 0, failed = 0, skipped = 0;

    for (const line of output.split("\n")) {
      const pass = line.match(/^✔\s+(.+)/);
      const fail = line.match(/^✖\s+(.+)/);
      const skip = line.match(/^-|→|⊙|○\s+(.+)/);

      if (pass) { total++; passed++; }
      else if (fail) {
        total++; failed++;
        failures.push({ test: fail[1], file: "unknown", line: 0, message: line });
      }
      else if (skip) { total++; skipped++; }
    }

    return { framework, total, passed, failed, skipped, durationMs: 0, failures };
  }

  private parsePytestOutput(output: string): TestRunResult {
    const failures: TestFailure[] = [];
    let passed = 0, failed = 0, skipped = 0;

    for (const line of output.split("\n")) {
      const pass = line.match(/^(\S+)\s+\.+\s+passed/);
      const fail = line.match(/^(\S+)\s+\.+\s+FAILED/);
      const skip = line.match(/^(\S+)\s+\.+\s+skipped/);
      const errMatch = line.match(/^(.*):(\d+): (.*)/);

      if (pass) passed++;
      else if (fail) {
        failed++;
        failures.push({ test: fail[1], file: "unknown", line: 0, message: line });
      }
      else if (skip) skipped++;
      else if (errMatch) {
        failures.push({ test: "error", file: errMatch[1], line: Number(errMatch[2]), message: errMatch[3] });
      }
    }

    return {
      framework: "pytest",
      total: passed + failed + skipped,
      passed, failed, skipped,
      durationMs: 0,
      failures,
    };
  }

  private mergeResults(results: TestRunResult[]): TestRunResult {
    return {
      framework: "merged",
      total: results.reduce((s, r) => s + r.total, 0),
      passed: results.reduce((s, r) => s + r.passed, 0),
      failed: results.reduce((s, r) => s + r.failed, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0),
      durationMs: results.reduce((s, r) => s + r.durationMs, 0),
      failures: results.flatMap((r) => r.failures),
    };
  }
}
