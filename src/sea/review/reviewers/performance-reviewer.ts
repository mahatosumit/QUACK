import { type ReviewFinding } from "../../types.js";

export class PerformanceReviewer {
  private patterns: Array<{ regex: RegExp; severity: ReviewFinding["severity"]; message: string; suggestion: string }> = [
    { regex: /\.filter\(.*\)\.forEach\(/g, severity: "medium", message: "Chained filter().forEach() creates two iterations.", suggestion: "Use a single for...of loop or reduce()." },
    { regex: /\.map\(.*\)\.filter\(/g, severity: "low", message: "Chained map().filter() creates two iterations.", suggestion: "Use flatMap() or a single reduce()." },
    { regex: /for\s*\(.*\)\s*\{[^}]*for\s*\(/g, severity: "medium", message: "Nested for loops have O(n²) complexity.", suggestion: "Consider using a Map or Set for lookup to reduce to O(n)." },
    { regex: /JSON\.parse\(JSON\.stringify/g, severity: "low", message: "Deep clone via JSON.parse(JSON.stringify()) is slow and loses types.", suggestion: "Use structuredClone() or a dedicated clone utility." },
    { regex: /new\s+Promise\(/g, severity: "info", message: "Manual Promise construction — ensure no executor antipattern.", suggestion: "Prefer async/await and Promise.resolve()." },
    { regex: /\.sort\([^)]*\)/g, severity: "info", message: "Custom comparator sort — ensure the comparator is efficient.", suggestion: "For numeric sorts, use (a, b) => a - b." },
    { regex: /await\s+\w+\s*\(\s*await/g, severity: "medium", message: "Nested awaits block the event loop sequentially.", suggestion: "Use Promise.all() for independent async operations." },
  ];

  async review(content: string, filePath: string, _language: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const pattern of this.patterns) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        const lineNum = this.getLineNumber(content, match.index!);
        findings.push({
          id: `perf-${filePath}-${lineNum}`,
          category: "performance",
          severity: pattern.severity,
          file: filePath,
          line: lineNum,
          message: pattern.message,
          explanation: `${pattern.message} at line ${lineNum}.`,
          suggestion: pattern.suggestion,
          code: match[0].slice(0, 80),
        });
      }
    }

    return findings;
  }

  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }
}
