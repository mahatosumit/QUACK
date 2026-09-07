import { createId } from "../../core/types.js";
import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type ReviewReport, type ReviewFinding, type ReviewCategory, type ReviewSeverity } from "../types.js";
import { ArchitectureReviewer } from "./reviewers/architecture-reviewer.js";
import { SecurityReviewer } from "./reviewers/security-reviewer.js";
import { PerformanceReviewer } from "./reviewers/performance-reviewer.js";
import { StyleReviewer } from "./reviewers/style-reviewer.js";
import { CorrectnessReviewer } from "./reviewers/correctness-reviewer.js";

export class ReviewSystem {
  private reviewers = [
    new ArchitectureReviewer(),
    new SecurityReviewer(),
    new PerformanceReviewer(),
    new StyleReviewer(),
    new CorrectnessReviewer(),
  ];

  constructor(private readonly sl: SemanticLayer) {}

  async review(target: string): Promise<ReviewReport> {
    const content = await this.readFile(target);
    if (!content) {
      return {
        target,
        findings: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        score: 10,
        passed: true,
        recommendations: ["File not found or unreadable."],
      };
    }

    const files = this.sl.getFiles();
    const fileInfo = files.find((f) => f.relativePath === target || f.path === target);

    const allFindings: ReviewFinding[] = [];
    for (const reviewer of this.reviewers) {
      const findings = await reviewer.review(content, target, fileInfo?.language ?? "unknown");
      allFindings.push(...findings);
    }

    return this.buildReport(target, allFindings);
  }

  async reviewPatch(patchId: string): Promise<ReviewReport> {
    const patch = this.sl.patches.listAppliedPatches().find((p) => p.id === patchId);
    if (!patch) {
      return {
        target: patchId,
        findings: [],
        summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
        score: 10,
        passed: true,
        recommendations: ["Patch not found."],
      };
    }

    const allFindings: ReviewFinding[] = [];
    for (const pf of patch.files) {
      const patchedContent = await this.sl.patches.getPatchedContent(patchId, pf.path);
      if (!patchedContent) continue;

      for (const reviewer of this.reviewers) {
        const findings = await reviewer.review(patchedContent, pf.path, "unknown");
        allFindings.push(...findings);
      }
    }

    return this.buildReport(`patch:${patchId}`, allFindings);
  }

  private buildReport(target: string, findings: ReviewFinding[]): ReviewReport {
    const summary = {
      total: findings.length,
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      info: findings.filter((f) => f.severity === "info").length,
    };

    const criticalPenalty = summary.critical * 3 + summary.high * 1.5 + summary.medium * 0.5;
    const score = Math.max(0, Math.round(10 - criticalPenalty));
    const passed = summary.critical === 0 && summary.high <= 2;

    const recommendations = findings
      .filter((f) => f.severity === "critical" || f.severity === "high")
      .slice(0, 5)
      .map((f) => f.suggestion ?? f.message);

    return { target, findings, summary, score, passed, recommendations };
  }

  private async readFile(path: string): Promise<string | undefined> {
    try {
      const { readFile } = await import("node:fs/promises");
      return await readFile(path, "utf-8");
    } catch {
      return undefined;
    }
  }
}
