import { resolve, sep, isAbsolute, dirname } from "node:path";
import { realpathSync, lstatSync, statSync } from "node:fs";

/**
 * QUACK path policy layer (ADR 0040).
 *
 * Every path that enters QUACK from a skill, tool input, provider, or
 * workflow must pass through these validators. The layer rejects:
 * - `..` traversal out of the authorized root
 * - absolute paths outside the root
 * - symlink and junction escapes (resolved realpath containment)
 * - Windows UNC paths (`\\server\share`), device paths (`\\.\`, `\\?\`),
 *   and alternate data streams (`file.txt:stream`)
 * - NUL bytes and non-string input
 *
 * Containment is ENFORCED against the resolved real path where the entry
 * exists, and against the lexical resolution where it does not (new-file
 * case): a symlink parent that resolves outside the root is rejected.
 */

export type PathPolicyDenial =
  | "NOT_A_STRING"
  | "CONTAINS_NUL"
  | "UNC_PATH"
  | "DEVICE_PATH"
  | "ALTERNATE_DATA_STREAM"
  | "NOT_ABSOLUTE_ROOT"
  | "TRAVERSAL_ESCAPE"
  | "SYMLINK_ESCAPE"
  | "RESOLVED_OUTSIDE_ROOT";

export interface PathPolicyResult {
  readonly allowed: boolean;
  /** The canonical resolved path when allowed. */
  readonly resolved?: string;
  readonly denial?: PathPolicyDenial;
}

/** Validate and resolve a path inside an absolute root. */
export function resolveInsideRoot(root: string, candidate: string): PathPolicyResult {
  if (typeof candidate !== "string" || candidate.length === 0) return { allowed: false, denial: "NOT_A_STRING" };
  if (candidate.includes("\0")) return { allowed: false, denial: "CONTAINS_NUL" };
  // Windows-specific dangerous prefixes must be rejected before any resolution.
  if (candidate.startsWith("\\\\.") || candidate.startsWith("//.") || candidate.startsWith("\\\\?") || candidate.startsWith("//?")) {
    return { allowed: false, denial: "DEVICE_PATH" };
  }
  if (candidate.startsWith("\\\\") || candidate.startsWith("//")) return { allowed: false, denial: "UNC_PATH" };
  // A single leading drive letter (Windows) is allowed; any other colon is an
  // alternate data stream or invalid stream syntax and is denied.
  const withoutDrive = candidate.replace(/^[A-Za-z]:/, "");
  if (withoutDrive.includes(":")) return { allowed: false, denial: "ALTERNATE_DATA_STREAM" };
  if (!isAbsolute(root)) return { allowed: false, denial: "NOT_ABSOLUTE_ROOT" };

  const resolvedRoot = safeRealpath(root) ?? resolve(root);
  const lexical = resolve(resolvedRoot, candidate);
  if (!containsLexically(resolvedRoot, lexical)) return { allowed: false, denial: "TRAVERSAL_ESCAPE" };

  // If the target (or any existing ancestor) is a symlink/junction, its real
  // path must stay inside the real root. Both sides are realpath'd so 8.3
  // short-path vs long-path spellings of the same directory compare equal.
  const realTarget = safeRealpath(lexical);
  if (realTarget !== undefined && !containsLexically(resolvedRoot, realTarget)) {
    return { allowed: false, denial: "SYMLINK_ESCAPE" };
  }
  if (realTarget === undefined) {
    // Walk existing ancestors up to (not past) the root: any symlinked
    // intermediate component that resolves outside the real root escapes.
    let current = dirname(lexical);
    while (containsLexically(resolvedRoot, current) && current !== dirname(resolvedRoot)) {
      const realAncestor = safeRealpath(current);
      if (realAncestor !== undefined && !containsLexically(resolvedRoot, realAncestor)) {
        return { allowed: false, denial: "SYMLINK_ESCAPE" };
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return { allowed: true, resolved: lexical };
}

function containsLexically(root: string, candidate: string): boolean {
  const normalizedRoot = stripTrailingSep(root);
  const normalizedCandidate = stripTrailingSep(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(normalizedRoot + sep);
}

function stripTrailingSep(path: string): string {
  if (path.length > 1 && (path.endsWith("/") || path.endsWith(sep))) {
    return path.slice(0, -1);
  }
  return path;
}

function safeRealpath(path: string): string | undefined {
  try {
    lstatSync(path);
    // Windows realpathSync returns `\\?\C:\...` device form; strip it so
    // lexical containment compares plain paths.
    return realpathSync(path).replace(/^\\\\\?\\/, "");
  } catch {
    return undefined;
  }
}

/** True when a directory path is an existing directory (no symlink check). */
export function isExistingDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/** True when the candidate is a symlink or junction. */
export function isSymlink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
