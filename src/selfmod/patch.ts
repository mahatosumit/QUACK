import { createHash } from "node:crypto";
import { ok, type QuackResult } from "../core/types.js";
import { type GitWorktreeManager } from "./worktree-manager.js";
import { type PatchArtifact } from "./types.js";

/**
 * Captures the worktree's committed diff against its pinned base commit as a
 * machine-readable, fingerprinted artifact (§17/§18). The diff is computed
 * once here; the same fingerprint must be re-checked bit-for-bit at
 * promotion time so an evaluated patch can never be silently regenerated.
 */
export async function capturePatch(
  git: GitWorktreeManager,
  relativeWorktreePath: string,
  baseCommit: string,
): Promise<QuackResult<PatchArtifact>> {
  const diffResult = await git.runGit(`diff ${baseCommit} --no-color`, relativeWorktreePath);
  if (!diffResult.ok) return diffResult;
  const diff = diffResult.data.stdout;

  const nameStatusResult = await git.runGit(`diff ${baseCommit} --name-status --no-color`, relativeWorktreePath);
  if (!nameStatusResult.ok) return nameStatusResult;

  const changedFiles: string[] = [];
  const addedFiles: string[] = [];
  const deletedFiles: string[] = [];
  for (const line of nameStatusResult.data.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [status, path] = line.split(/\s+/, 2);
    if (!path) continue;
    changedFiles.push(path);
    if (status.startsWith("A")) addedFiles.push(path);
    if (status.startsWith("D")) deletedFiles.push(path);
  }

  const numstatResult = await git.runGit(`diff ${baseCommit} --numstat --no-color`, relativeWorktreePath);
  if (!numstatResult.ok) return numstatResult;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstatResult.data.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [added, removed] = line.split(/\s+/, 2);
    insertions += Number.parseInt(added, 10) || 0;
    deletions += Number.parseInt(removed, 10) || 0;
  }

  const fingerprint = createHash("sha256").update(diff).digest("hex");

  return ok({
    baseCommit,
    changedFiles,
    addedFiles,
    deletedFiles,
    diff,
    insertions,
    deletions,
    fingerprint,
  });
}
