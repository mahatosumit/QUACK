import { type TestFailureAnalysis } from "../types.js";

export class TestAnalyzer {
  analyzeFailure(testName: string, error: string, stackTrace?: string): TestFailureAnalysis {
    const likelyCause = this.inferCause(error, stackTrace);
    const suggestion = this.suggestFix(likelyCause);

    const relatedFiles = stackTrace
      ? this.extractRelatedFiles(stackTrace)
      : undefined;

    return {
      testFile: "",
      testName,
      error,
      stackTrace,
      likelyCause,
      suggestedFix: suggestion,
      confidence: suggestion ? 0.6 : 0.3,
      relatedFiles,
    };
  }

  analyzeFailures(failures: Array<{ testName: string; error: string; stackTrace?: string }>): TestFailureAnalysis[] {
    return failures.map((f) => this.analyzeFailure(f.testName, f.error, f.stackTrace));
  }

  private inferCause(error: string, stackTrace?: string): string {
    const errorLower = error.toLowerCase();

    if (errorLower.includes("timeout")) {
      return "Test timeout — operation took longer than the configured timeout.";
    }
    if (errorLower.includes("assert") || errorLower.includes("expected")) {
      return "Assertion failure — actual value did not match expected value.";
    }
    if (errorLower.includes("undefined") || errorLower.includes("cannot read")) {
      return "Null/undefined reference — code attempted to access a property on undefined.";
    }
    if (errorLower.includes("not found") || errorLower.includes("cannot find") || errorLower.includes("module")) {
      return "Missing import or module — dependency not resolved.";
    }
    if (errorLower.includes("type") || errorLower.includes("not assignable")) {
      return "Type error — type mismatch in the code.";
    }
    if (errorLower.includes("network") || errorLower.includes("connect") || errorLower.includes("econnrefused")) {
      return "Network error — test environment may be missing required services.";
    }

    if (stackTrace) {
      const firstFrame = this.extractFirstCodeFrame(stackTrace);
      if (firstFrame) {
        return `Error in ${firstFrame.file} at line ${firstFrame.line}: ${error}`;
      }
    }

    return `Unclassified error: ${error.slice(0, 200)}`;
  }

  private suggestFix(cause: string): string | undefined {
    if (cause.includes("timeout")) return "Increase test timeout or optimize slow operations.";
    if (cause.includes("Assertion")) return "Verify the expected value is correct. Consider using snapshot testing for complex values.";
    if (cause.includes("undefined")) return "Add null checks or ensure the value is initialized before use.";
    if (cause.includes("Missing import")) return "Install missing dependencies or fix import paths.";
    if (cause.includes("Type error")) return "Fix type annotations or use type-safe patterns.";
    if (cause.includes("Network")) return "Ensure test services are running or mock external dependencies.";
    return undefined;
  }

  private extractRelatedFiles(stackTrace: string): string[] {
    const files: string[] = [];
    const fileRegex = /(?:at\s+(?:\w+\s+)?)?\(?(.+?\.(?:ts|js|tsx|jsx)):(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(stackTrace)) !== null) {
      files.push(match[1]);
    }
    return [...new Set(files)].slice(0, 5);
  }

  private extractFirstCodeFrame(stackTrace: string): { file: string; line: number } | undefined {
    const match = /(?:at\s+(?:\w+\s+)?)?\(?(.+?\.(?:ts|js|tsx|jsx)):(\d+)/.exec(stackTrace);
    if (!match) return undefined;
    return { file: match[1], line: parseInt(match[2], 10) };
  }
}
