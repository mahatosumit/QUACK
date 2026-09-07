import { type ReviewFinding } from "../../types.js";

export class StyleReviewer {
  async review(content: string, filePath: string, _language: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    const lines = content.split("\n");

    // Long lines
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 120) {
        findings.push({
          id: `style-${filePath}-${i + 1}-longline`,
          category: "style",
          severity: "low",
          file: filePath,
          line: i + 1,
          message: "Line exceeds 120 characters.",
          explanation: `Line ${i + 1} has ${lines[i].length} characters. Long lines reduce readability.`,
          suggestion: "Break the line into multiple lines or extract expressions into variables.",
          code: lines[i].slice(0, 120),
        });
        if (findings.length >= 5) break;
      }
    }

    // Trailing whitespace
    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      if (/\s+$/.test(lines[i])) {
        findings.push({
          id: `style-${filePath}-${i + 1}-trailingspace`,
          category: "style",
          severity: "info",
          file: filePath,
          line: i + 1,
          message: "Trailing whitespace detected.",
          explanation: `Line ${i + 1} has trailing whitespace.`,
          suggestion: "Remove trailing whitespace or configure your editor to strip it automatically.",
        });
        break;
      }
    }

    // Missing blank line at end
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      findings.push({
        id: `style-${filePath}-eof`,
        category: "style",
        severity: "info",
        file: filePath,
        line: lines.length,
        message: "File does not end with a blank line.",
        explanation: "POSIX standard requires files to end with a newline.",
        suggestion: "Add a trailing newline at the end of the file.",
      });
    }

    // Large functions (heuristic: function with >50 lines)
    let inFunction = false;
    let fnStart = 0;
    let fnBraceCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/\b(function|def|method)\b/.test(lines[i]) && /\{/.test(lines[i])) {
        inFunction = true;
        fnStart = i;
        fnBraceCount = 1;
      } else if (inFunction) {
        fnBraceCount += (lines[i].match(/\{/g) ?? []).length;
        fnBraceCount -= (lines[i].match(/\}/g) ?? []).length;
        if (fnBraceCount <= 0) {
          const fnLength = i - fnStart;
          if (fnLength > 50) {
            findings.push({
              id: `style-${filePath}-${fnStart + 1}-largefn`,
              category: "style",
              severity: "medium",
              file: filePath,
              line: fnStart + 1,
              message: `Function is ${fnLength} lines long. Consider refactoring.`,
              explanation: `Function starting at line ${fnStart + 1} spans ${fnLength} lines.`,
              suggestion: "Break the function into smaller focused functions.",
            });
          }
          inFunction = false;
        }
      }
    }

    return findings;
  }
}
