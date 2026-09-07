import { createHash } from "node:crypto";
import type { JsonObject } from "../core/types.js";

/**
 * QUACK Universal Skill specification (ADR 0041).
 *
 * Extends the existing `SkillManifest` with the fields required for
 * universal, cross-platform, privacy-safe skill handling. A skill exists in
 * one of these kinds; instructions (SKILL.md prose) are untrusted input and
 * are never executed directly.
 */

export type UniversalSkillKind =
  | "INSTRUCTION_ONLY"
  | "TOOL"
  | "WORKFLOW"
  | "EXECUTABLE"
  | "PLUGIN"
  | "BROWSER"
  | "MCP"
  | "PROVIDER"
  | "COMPOSITE";

export type SkillRiskClass =
  | "LOW"    // read public documentation, parse local project files, format text, calculate
  | "MEDIUM" // filesystem write, network access, browser automation, package installation, subprocess
  | "HIGH";  // credentials, cookies, system administration, arbitrary shell, financial, destructive ops

export type SkillTrustModel =
  | "CORE"
  | "VERIFIED"
  | "USER_APPROVED"
  | "COMMUNITY"
  | "UNVERIFIED"
  | "QUARANTINED"
  | "BLOCKED";

export type SkillPlatformTag = "windows" | "linux" | "macos" | "all";

/** Additional universal fields layered on the existing manifest. */
export interface UniversalSkillFields {
  readonly kind: UniversalSkillKind;
  readonly source: string;
  readonly license?: string;
  readonly platforms: readonly SkillPlatformTag[];
  readonly networkRequirements: readonly string[];
  readonly filesystemRequirements: readonly string[];
  readonly secretRequirements: readonly string[];
  readonly riskClass: SkillRiskClass;
  readonly sandboxProfile: "IN_PROCESS" | "WORKER_PROCESS" | "CONTAINER_ISOLATED" | "FUTURE_STRONG_ISOLATION";
  readonly checksum?: string;
  readonly provenance?: { readonly sourceUrl?: string; readonly commit?: string; readonly contentHash?: string };
}

/**
 * Classify a skill's risk from its declared requirements. High-risk skills
 * must never silently activate; classification is derived from what the
 * skill requests, never from what it claims to be.
 */
export function classifySkillRisk(input: {
  readonly permissions: readonly string[];
  readonly filesystemRequirements?: readonly string[];
  readonly networkRequirements?: readonly string[];
  readonly secretRequirements?: readonly string[];
  readonly kind?: UniversalSkillKind;
}): SkillRiskClass {
  const high = (permission: string): boolean =>
    permission.startsWith("secrets.") || permission === "everything"
      || permission === "terminal.execute" && false;
  const declaresHigh = input.secretRequirements !== undefined && input.secretRequirements.length > 0
    || input.permissions.some(permission => permission.startsWith("secrets."));
  if (declaresHigh) return "HIGH";
  const medium = input.networkRequirements !== undefined && input.networkRequirements.length > 0
    || input.filesystemRequirements?.some(requirement => /write|delete|create/i.test(requirement)) === true
    || input.permissions.some(permission =>
      ["terminal.execute", "network.http", "network.websocket", "browser.control", "mcp.connect", "mcp.execute",
        "filesystem.write.external", "git.write", "external.write", "email.send", "plugin.install"].includes(permission));
  if (medium) return "MEDIUM";
  return "LOW";
}

/** High-risk skills must never activate silently: review is required for HIGH always. */
export function requiresReviewBeforeActivation(riskClass: SkillRiskClass, trust: SkillTrustModel): boolean {
  if (trust === "QUARANTINED" || trust === "BLOCKED" || trust === "UNVERIFIED") return true;
  return riskClass === "HIGH";
}

/** Content hash for supply-chain change detection. */
export function skillContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Manifest hash: canonical JSON over the manifest fields. */
export function skillManifestHash(manifest: JsonObject): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}