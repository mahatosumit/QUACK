import { type CodeChangeRisk, type MutationTargetClassification } from "./types.js";

/**
 * Hard-coded protected prefixes (§37 — derivable, but the safest deterministic
 * source of truth is an explicit list QUACK itself can never widen at runtime:
 * this module is not a mutation target callers can influence).
 */
const EVALUATOR_CRITICAL_PREFIXES: readonly string[] = [
  "src/cos/deterministic-evaluator.ts",
  "src/cos/objectives.ts",
  "src/selfmod/evaluator.ts",
];

const SECURITY_CRITICAL_PREFIXES: readonly string[] = [
  "src/security/",
  "src/tools/tool.ts",
  "src/tools/workspace-filesystem.ts",
  "src/tools/workspace-write.ts",
  "src/tools/terminal.ts",
  "src/skills/sandbox-runtime.ts",
];

const PROTECTED_CORE_PREFIXES: readonly string[] = [
  "src/selfmod/",
  "src/runtime/runtime.ts",
  "src/events/event-bus.ts",
  "src/adaptive/evidence-improvement-cycle.ts",
  "src/system/create-system.ts",
];

const CONFIGURATION_PREFIXES: readonly string[] = [
  "package.json",
  "tsconfig.json",
  ".quack/",
];

const TEST_SUFFIXES: readonly string[] = [".test.ts", ".test.js"];

export function classifyFile(relativePath: string): MutationTargetClassification {
  const path = relativePath.replace(/\\/g, "/");
  if (TEST_SUFFIXES.some((suffix) => path.endsWith(suffix))) return "TEST_ONLY";
  if (EVALUATOR_CRITICAL_PREFIXES.some((prefix) => path.startsWith(prefix))) return "EVALUATOR_CRITICAL";
  if (SECURITY_CRITICAL_PREFIXES.some((prefix) => path.startsWith(prefix))) return "SECURITY_CRITICAL";
  if (PROTECTED_CORE_PREFIXES.some((prefix) => path.startsWith(prefix))) return "PROTECTED_QUACK_CORE";
  if (CONFIGURATION_PREFIXES.some((prefix) => path.startsWith(prefix))) return "CONFIGURATION";
  if (path.startsWith("src/")) return path.startsWith("src/adaptive/") || path.startsWith("src/cos/") || path.startsWith("src/skills/")
    ? "QUACK_NONCRITICAL_EXTENSION"
    : "APPLICATION_CODE";
  return "APPLICATION_CODE";
}

/** Highest-severity classification wins across the whole change set. */
const SEVERITY_ORDER: readonly MutationTargetClassification[] = [
  "TEST_ONLY",
  "CONFIGURATION",
  "APPLICATION_CODE",
  "QUACK_NONCRITICAL_EXTENSION",
  "PROTECTED_QUACK_CORE",
  "SECURITY_CRITICAL",
  "EVALUATOR_CRITICAL",
];

export function classifyProposalScope(relativePaths: readonly string[]): MutationTargetClassification {
  let worst: MutationTargetClassification = "TEST_ONLY";
  for (const path of relativePaths) {
    const classification = classifyFile(path);
    if (SEVERITY_ORDER.indexOf(classification) > SEVERITY_ORDER.indexOf(worst)) worst = classification;
  }
  return worst;
}

export function isProtectedClassification(classification: MutationTargetClassification): boolean {
  return classification === "PROTECTED_QUACK_CORE" ||
    classification === "SECURITY_CRITICAL" ||
    classification === "EVALUATOR_CRITICAL";
}

export function riskForClassification(classification: MutationTargetClassification): CodeChangeRisk {
  if (isProtectedClassification(classification)) return "PROHIBITED_AUTONOMOUSLY";
  if (classification === "CONFIGURATION") return "REQUIRES_APPROVAL";
  return classification === "TEST_ONLY" || classification === "APPLICATION_CODE" || classification === "QUACK_NONCRITICAL_EXTENSION"
    ? "REQUIRES_APPROVAL"
    : "PROHIBITED_AUTONOMOUSLY";
}
