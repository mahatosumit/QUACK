import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, relative, dirname, isAbsolute } from "node:path";
import { createId, now } from "../../core/types.js";
import { type Patch, type PatchFile, type PatchHunk, type PatchValidationResult } from "../types.js";
import { type EventBus } from "../../events/event-bus.js";

export interface PatchEngineOptions {
  readonly workspaceRoot: string;
  readonly backupDir?: string;
  readonly eventBus?: EventBus;
}

/**
 * PatchEngine provides safe file modification with validation, rollback, and
 * audit logging. The ExecutiveBrain must never write files directly — it must
 * use the PatchEngine.
 */
export class PatchEngine {
  private readonly appliedPatches = new Map<string, Patch>();
  private readonly backupDir: string;

  constructor(private readonly options: PatchEngineOptions) {
    this.backupDir = options.backupDir ?? resolve(options.workspaceRoot, ".quack", "patches");
  }

  /**
   * Generate a patch that transforms the original file into the new content.
   */
  async generatePatch(description: string, edits: Array<{ path: string; content: string }>): Promise<Patch> {
    const files: PatchFile[] = [];

    for (const edit of edits) {
      const fullPath = resolve(this.options.workspaceRoot, edit.path);
      const originalContent = existsSync(fullPath) ? await readFile(fullPath, "utf-8").catch(() => "") : "";
      const originalLines = originalContent.split("\n");
      const patchedLines = edit.content.split("\n");

      const hunks = this.computeHunks(originalLines, patchedLines);

      files.push({
        path: edit.path,
        originalContent,
        patchedContent: edit.content,
        hunks,
      });
    }

    return {
      id: createId("patch"),
      description,
      files,
      timestamp: now(),
      status: "pending",
    };
  }

  /**
   * Create a full-file replacement patch (simpler than diff-based).
   */
  async createFullPatch(description: string, edits: Array<{ path: string; content: string }>): Promise<Patch> {
    const files: PatchFile[] = [];
    for (const edit of edits) {
      const fullPath = resolve(this.options.workspaceRoot, edit.path);
      const originalContent = existsSync(fullPath) ? await readFile(fullPath, "utf-8").catch(() => "") : "";
      files.push({
        path: edit.path,
        originalContent,
        patchedContent: edit.content,
        hunks: [{
          startLine: 0,
          originalLines: originalContent.split("\n"),
          patchedLines: edit.content.split("\n"),
        }],
      });
    }

    return {
      id: createId("patch"),
      description,
      files,
      timestamp: now(),
      status: "pending",
    };
  }

  /**
   * Validate a patch by checking it can be applied and optionally running
   * external validators (compile, lint, typecheck).
   */
  async validatePatch(patch: Patch, validators?: Array<(patch: Patch) => Promise<string[]>>): Promise<PatchValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate file paths are within workspace
    for (const file of patch.files) {
      const fullPath = resolve(this.options.workspaceRoot, file.path);
      const rel = relative(this.options.workspaceRoot, fullPath);
      if (rel.startsWith("..")) {
        errors.push(`File ${file.path} is outside the workspace root`);
      }
    }

    // Run external validators
    if (validators) {
      for (const validator of validators) {
        try {
          const validatorErrors = await validator(patch);
          errors.push(...validatorErrors);
        } catch (error) {
          warnings.push(`Validator failed: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      compileErrors: [],
      lintErrors: [],
      typeErrors: [],
      testFailures: [],
      durationMs: 0,
    };
  }

  /** Rejects any patch path that resolves outside `workspaceRoot` (e.g. via `../` traversal). */
  private assertWithinWorkspace(filePath: string): string {
    const fullPath = resolve(this.options.workspaceRoot, filePath);
    const rel = relative(this.options.workspaceRoot, fullPath);
    if (rel === ".." || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`File path "${filePath}" resolves outside the workspace root; refusing to write.`);
    }
    return fullPath;
  }

  /**
   * Apply a validated patch to the workspace.
   * Creates backups before overwriting.
   */
  async applyPatch(patch: Patch): Promise<{ success: boolean; error?: string }> {
    try {
      // Reject any path escaping the workspace root before writing anything (fail closed, all-or-nothing).
      for (const file of patch.files) {
        this.assertWithinWorkspace(file.path);
      }

      // Create backup directory
      await mkdir(this.backupDir, { recursive: true });

      // Backup and apply each file
      for (const file of patch.files) {
        const fullPath = this.assertWithinWorkspace(file.path);

        // Create backup
        const backupPath = resolve(this.backupDir, `${patch.id}_${file.path.replace(/[/\\]/g, "_")}`);
        if (existsSync(fullPath)) {
          const backupContent = await readFile(fullPath, "utf-8");
          await mkdir(dirname(backupPath), { recursive: true });
          await writeFile(backupPath, backupContent, "utf-8");
        }

        // Write new content
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, file.patchedContent, "utf-8");
      }

      (patch as { status: string }).status = "applied";
      this.appliedPatches.set(patch.id, patch);

      await this.options.eventBus?.emit("task.completed", {
        action: "patch.applied",
        patchId: patch.id,
        files: patch.files.map((f) => f.path),
        description: patch.description,
      }, { actor: "patch-engine" });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error applying patch",
      };
    }
  }

  /**
   * Rollback a previously applied patch to its original state.
   */
  async rollbackPatch(patchId: string): Promise<{ success: boolean; error?: string }> {
    const patch = this.appliedPatches.get(patchId);
    if (!patch) return { success: false, error: `Patch ${patchId} not found or not applied` };

    try {
      for (const file of patch.files) {
        const backupPath = resolve(this.backupDir, `${patch.id}_${file.path.replace(/[/\\]/g, "_")}`);
        const fullPath = resolve(this.options.workspaceRoot, file.path);

        if (existsSync(backupPath)) {
          const backupContent = await readFile(backupPath, "utf-8");
          await writeFile(fullPath, backupContent, "utf-8");
        } else {
          // No backup means the file didn't exist before
          if (existsSync(fullPath)) {
            await unlink(fullPath);
          }
        }
      }

      (patch as { status: string }).status = "rolled_back";

      await this.options.eventBus?.emit("task.completed", {
        action: "patch.rolled_back",
        patchId,
      }, { actor: "patch-engine" });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error during rollback",
      };
    }
  }

  /**
   * Get the current content of a patched file.
   */
  async getPatchedContent(patchId: string, filePath: string): Promise<string | undefined> {
    const patch = this.appliedPatches.get(patchId);
    if (!patch) return undefined;
    return patch.files.find((f) => f.path === filePath)?.patchedContent;
  }

  listAppliedPatches(): readonly Patch[] {
    return [...this.appliedPatches.values()];
  }

  private computeHunks(original: readonly string[], patched: readonly string[]): PatchHunk[] {
    // Simple line-based diff: finds contiguous changed regions.
    const hunks: PatchHunk[] = [];
    let i = 0;

    while (i < original.length || i < patched.length) {
      if (original[i] === patched[i]) {
        i++;
        continue;
      }

      const startLine = i;
      const origLines: string[] = [];
      const patchedLines: string[] = [];

      while (i < original.length || i < patched.length) {
        if (original[i] === patched[i] && origLines.length > 0) break;
        if (i < original.length) origLines.push(original[i]);
        if (i < patched.length) patchedLines.push(patched[i]);
        i++;
        if (origLines.length > 50) break; // limit hunk size
      }

      hunks.push({
        startLine: startLine + 1,
        originalLines: origLines,
        patchedLines,
      });
    }

    return hunks;
  }
}
