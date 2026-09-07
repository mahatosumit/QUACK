import { type ReviewFinding } from "../../types.js";

export class CorrectnessReviewer {
  private patterns: Array<{ regex: RegExp; severity: ReviewFinding["severity"]; message: string; suggestion: string }> = [
    { regex: /==\s*null/g, severity: "medium", message: "Loose equality with null (== null) also matches undefined.", suggestion: "Use === null or x == null && x !== undefined for explicit null check." },
    { regex: /!==\s*undefined\s*\|\|\s*\w+\s*!==\s*null/g, severity: "low", message: "Verbose null/undefined check pattern.", suggestion: "Use x ?? fallback or x != null (catches both null and undefined)." },
    { regex: /try\s*\{[^}]*\}\s*catch\s*\(\s*\)\s*\{[^}]*\}/g, severity: "medium", message: "Empty catch block silently swallows errors.", suggestion: "Always log or handle the error in catch blocks." },
    { regex: /\.push\(\.\.\./g, severity: "info", message: "Array push with spread creates a new array reference.", suggestion: "Use Array.prototype.concat() or a for...of loop." },
    { regex: /\+\s*""/g, severity: "low", message: "String coercion via + '' may hide type errors.", suggestion: "Use String() or template literals for explicit conversion." },
    { regex: /typeof\s+\w+\s*===?\s*["']undefined["']/g, severity: "info", message: "Explicit undefined type check.", suggestion: "Use === undefined for direct comparison when the variable is declared." },
    { regex: /\.forEach\s*\(\s*async/g, severity: "high", message: "async forEach does not await — promises fire and forget.", suggestion: "Use for...of with await, or Promise.all() with map()." },
    { regex: /new\s+Date\s*\(\s*["']\d{4}/g, severity: "medium", message: "Date constructor with string argument is browser-dependent.", suggestion: "Use Date.parse() or Unix timestamps for reliable date parsing." },
    { regex: /parseInt\s*\([^,)]*\)/g, severity: "medium", message: "parseInt() without radix defaults to base 10/16 depending on input.", suggestion: "Always provide radix: parseInt(value, 10)." },
  ];

  async review(content: string, filePath: string, _language: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const pattern of this.patterns) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        const lineNum = this.getLineNumber(content, match.index!);
        findings.push({
          id: `correct-${filePath}-${lineNum}`,
          category: "correctness",
          severity: pattern.severity,
          file: filePath,
          line: lineNum,
          message: pattern.message,
          explanation: `Pattern '${match[0].slice(0, 60)}' found at line ${lineNum}.`,
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
