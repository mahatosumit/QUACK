import { type ReviewFinding, type ReviewCategory } from "../../types.js";

export class ArchitectureReviewer {
  async review(content: string, filePath: string, _language: string): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];
    const lines = content.split("\n");

    // Check file length
    if (lines.length > 500) {
      findings.push(this.makeFinding(filePath, "architecture", "high",
        `File is ${lines.length} lines long. Consider splitting into smaller modules.`,
        "Break this file into focused modules of <300 lines each.",
      ));
    }

    // Check for deep nesting
    let maxDepth = 0;
    let currentDepth = 0;
    for (const line of lines) {
      const openCount = (line.match(/\{/g) ?? []).length;
      const closeCount = (line.match(/\}/g) ?? []).length;
      currentDepth += openCount - closeCount;
      maxDepth = Math.max(maxDepth, currentDepth);
    }
    if (maxDepth > 6) {
      findings.push(this.makeFinding(filePath, "architecture", "medium",
        `Maximum nesting depth is ${maxDepth}. Deep nesting reduces readability.`,
        "Extract nested blocks into named functions or methods.",
      ));
    }

    // Check for god object pattern (too many methods/properties)
    const methodCount = lines.filter((l) => /(async\s+)?(function|def|method)\s+\w+\s*[\(<]/.test(l)).length;
    const propertyCount = lines.filter((l) => /(this\.|self\.)\w+\s*=/.test(l)).length;
    if (methodCount > 20 || propertyCount > 30) {
      findings.push(this.makeFinding(filePath, "architecture", "medium",
        `Class has ${methodCount} methods and ${propertyCount} properties. Consider splitting responsibilities.`,
        "Apply Single Responsibility Principle: extract related methods into separate classes.",
      ));
    }

    return findings;
  }

  private makeFinding(file: string, category: ReviewCategory, severity: ReviewFinding["severity"], message: string, suggestion?: string): ReviewFinding {
    return {
      id: `arch-${file}-${category}-${severity}`,
      category,
      severity,
      file,
      message,
      explanation: message,
      suggestion,
    };
  }
}
