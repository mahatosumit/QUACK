import { type SemanticLayer } from "../../intelligence/semantic-layer.js";
import { type EditOperation, type EditingPlan } from "../types.js";

export class IncrementalEditor {
  constructor(private readonly sl: SemanticLayer) {}

  async plan(goal: string, operations: EditOperation[]): Promise<EditingPlan> {
    const affectedFiles = [...new Set(operations.map((op) => op.path))];

    const symbolChecks: string[] = [];
    for (const op of operations) {
      const symbols = await this.sl.symbolDb.getByFile(op.path);
      for (const s of symbols) {
        symbolChecks.push(`${s.name} in ${s.filePath}`);
      }
    }

    const hasConflicts = await this.detectConflicts(operations);
    const permissions = this.identifyPermissions(operations);
    const risk = this.assessRisk(operations);

    return {
      goal,
      operations,
      affectedFiles,
      riskAssessment: risk,
      requiresReview: risk !== "low" || hasConflicts,
      requiredPermissions: permissions,
    };
  }

  async generateDiff(original: string, modified: string): Promise<string> {
    const origLines = original.split("\n");
    const modLines = modified.split("\n");
    const hunks: string[] = [];

    let i = 0;
    while (i < origLines.length || i < modLines.length) {
      if (origLines[i] !== modLines[i]) {
        const start = i;
        while (i < origLines.length || i < modLines.length) {
          if (origLines[i] !== modLines[i]) {
            i++;
          } else {
            break;
          }
        }
        const orig = origLines.slice(start, i);
        const mod = modLines.slice(start, i);
        hunks.push(
          `@@ -${start + 1},${orig.length} +${start + 1},${mod.length} @@\n` +
          orig.map((l) => `-${l}`).join("\n") + "\n" +
          mod.map((l) => `+${l}`).join("\n"),
        );
      }
      i++;
    }

    return hunks.join("\n\n");
  }

  private async detectConflicts(operations: EditOperation[]): Promise<boolean> {
    const fileOps = new Map<string, EditOperation[]>();
    for (const op of operations) {
      const existing = fileOps.get(op.path) ?? [];
      existing.push(op);
      fileOps.set(op.path, existing);
    }
    for (const [, ops] of fileOps) {
      if (ops.length > 1) return true;
    }
    return false;
  }

  private identifyPermissions(operations: EditOperation[]): string[] {
    const perms = new Set<string>();
    perms.add("workspace.read");
    for (const op of operations) {
      if (op.path) perms.add("workspace.write");
    }
    return [...perms];
  }

  private assessRisk(operations: EditOperation[]): EditingPlan["riskAssessment"] {
    const fileCount = new Set(operations.map((o) => o.path)).size;
    const maxChanges = Math.max(...operations.map((o) => Math.abs(o.newContent.length - o.originalContent.length)));

    if (fileCount > 10 || maxChanges > 5000) return "critical";
    if (fileCount > 5 || maxChanges > 1000) return "high";
    if (fileCount > 2 || maxChanges > 200) return "medium";
    return "low";
  }
}
