import { type PatchArtifact, type TestIntegrityFinding } from "./types.js";

const TEST_FILE_PATTERN = /\.test\.(ts|js)$/;
const CONFIG_FILES = new Set(["package.json", "tsconfig.json"]);

/**
 * Heuristic-only test/config-gaming detector (§25). These are signals for a
 * human reviewer, never proof that a green suite is trustworthy.
 */
export function checkTestIntegrity(patch: PatchArtifact): TestIntegrityFinding[] {
  const findings: TestIntegrityFinding[] = [];
  const fileDiffs = splitByFile(patch.diff);

  for (const file of patch.deletedFiles) {
    if (TEST_FILE_PATTERN.test(file)) {
      findings.push({ file, kind: "test_deleted", detail: `Test file ${file} was deleted by this patch.` });
    }
  }

  for (const [file, body] of fileDiffs) {
    if (TEST_FILE_PATTERN.test(file)) {
      const addedSkip = countAddedMatches(body, /\.(skip|todo)\s*\(/);
      const addedOnly = countAddedMatches(body, /\.only\s*\(/);
      if (addedSkip > 0) findings.push({ file, kind: "skip", detail: `Adds ${addedSkip} .skip()/.todo() call(s) to a test file.` });
      if (addedOnly > 0) findings.push({ file, kind: "only", detail: `Adds ${addedOnly} .only() call(s), which narrows test discovery.` });

      const removedAsserts = countRemovedMatches(body, /\bassert\b/);
      const addedAsserts = countAddedMatches(body, /\bassert\b/);
      if (removedAsserts > addedAsserts) {
        findings.push({
          file,
          kind: "assertion_weakened",
          detail: `Removes ${removedAsserts} assertion(s) while only adding ${addedAsserts}.`,
        });
      }
    }

    if (CONFIG_FILES.has(file)) {
      if (/^\+.*"(test|typecheck|build|pretest)"\s*:/m.test(body)) {
        findings.push({ file, kind: "test_script_changed", detail: `Modifies a test/build/typecheck script entry in ${file}.` });
      } else if (/^\+/m.test(body)) {
        findings.push({ file, kind: "config_changed", detail: `Modifies verification-relevant configuration file ${file}.` });
      }
    }
  }

  return findings;
}

function splitByFile(diff: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  const parts = diff.split(/^diff --git /m).slice(1);
  for (const part of parts) {
    const headerMatch = part.match(/a\/(\S+) b\/(\S+)/);
    const file = headerMatch ? headerMatch[2] : undefined;
    if (file) sections.set(file, part);
  }
  return sections;
}

function countAddedMatches(diffBody: string, pattern: RegExp): number {
  return countLineMatches(diffBody, "+", pattern);
}

function countRemovedMatches(diffBody: string, pattern: RegExp): number {
  return countLineMatches(diffBody, "-", pattern);
}

function countLineMatches(diffBody: string, prefix: "+" | "-", pattern: RegExp): number {
  let count = 0;
  for (const line of diffBody.split("\n")) {
    if (!line.startsWith(prefix) || line.startsWith(`${prefix}${prefix}${prefix}`)) continue;
    if (pattern.test(line)) count++;
  }
  return count;
}
