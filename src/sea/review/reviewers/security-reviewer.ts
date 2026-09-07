import { type ReviewFinding } from "../../types.js";

export class SecurityReviewer {
  private patterns: Array<{ regex: RegExp; severity: ReviewFinding["severity"]; message: string; suggestion: string }> = [
    { regex: /eval\s*\(/g, severity: "critical", message: "Use of eval() allows arbitrary code execution.", suggestion: "Replace eval() with safe alternatives like JSON.parse() or Function constructor." },
    { regex: /innerHTML\s*=/g, severity: "high", message: "Direct innerHTML assignment enables XSS attacks.", suggestion: "Use textContent or DOMPurify.sanitize() instead." },
    { regex: /exec(File)?\s*\(/g, severity: "critical", message: "Shell command execution can lead to command injection.", suggestion: "Use execFile() with non-shell mode or validate all inputs." },
    { regex: /process\.env/g, severity: "low", message: "Direct access to environment variables.", suggestion: "Use a typed config module that validates and exposes env vars." },
    { regex: /(password|secret|api_key|token)\s*[:=]\s*["'][^"']+["']/gi, severity: "critical", message: "Hardcoded credential detected.", suggestion: "Move secrets to environment variables or a secrets manager." },
    { regex: /new\s+Function\s*\(/g, severity: "high", message: "Dynamic function creation can lead to code injection.", suggestion: "Use predefined functions or lookup tables." },
    { regex: /(SELECT|UPDATE|DELETE|INSERT)\s+.*\$\{/gi, severity: "critical", message: "SQL injection risk: string interpolation in SQL query.", suggestion: "Use parameterized queries or an ORM." },
    { regex: /\.innerHTML\s*\+?=/g, severity: "high", message: "Unsafe HTML assignment.", suggestion: "Use document.createTextNode() or a template engine with auto-escaping." },
  ];

  async review(content: string, filePath: string, _language: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const pattern of this.patterns) {
      const matches = content.matchAll(pattern.regex);
      for (const match of matches) {
        const lineNum = this.getLineNumber(content, match.index!);
        findings.push({
          id: `sec-${filePath}-${lineNum}`,
          category: "security",
          severity: pattern.severity,
          file: filePath,
          line: lineNum,
          message: pattern.message,
          explanation: `Found pattern: ${match[0].slice(0, 80)} at line ${lineNum}.`,
          suggestion: pattern.suggestion,
          code: match[0],
        });
      }
    }

    return findings;
  }

  private getLineNumber(content: string, index: number): number {
    return content.slice(0, index).split("\n").length;
  }
}
