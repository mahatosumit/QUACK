import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrivacyFirewall } from "./privacy.js";
import { DiscoveredSkillRegistry, type SkillRecord } from "./registry.js";
import { classifySkillRisk, type SkillRiskClass, type UniversalSkillKind } from "../universal.js";
import { resolveInsideRoot } from "../../platform/paths.js";

/**
 * AI-assisted external skill search (ADR 0041, quarantine-first).
 *
 * Remote skill content is UNTRUSTED. The acquisition pipeline is:
 * fetch → quarantine directory → static inspection → manifest extraction →
 * capability analysis → risk classification → registry policy decision →
 * optional user approval. Nothing is installed or executed by search. The
 * skill author can never redefine QUACK security policy: every declared
 * permission is re-derived through QUACK's own classifier, and the
 * PrivacyFirewall screens manifest content before anything is persisted
 * beyond the quarantine record.
 */

export interface ExternalSkillCandidate {
  readonly skillId: string;
  readonly name: string;
  readonly version: string;
  readonly sourceUrl: string;
  readonly license?: string;
  readonly repository?: string;
  readonly manifest: Record<string, unknown>;
}

export interface QuarantinedSkill {
  readonly candidate: ExternalSkillCandidate;
  readonly quarantinePath: string;
  readonly contentHash: string;
  readonly manifestHash: string;
  readonly riskClass: SkillRiskClass;
  readonly permissions: readonly string[];
  /** Static-inspection findings: suspicious constructs found in the manifest. */
  readonly findings: readonly SecurityFinding[];
  readonly privacyDecision: "ALLOW" | "REDACT" | "DENY";
}

export interface SecurityFinding {
  readonly severity: "BLOCKER" | "WARNING";
  readonly kind: string;
  readonly detail: string;
}

/** Suspicious constructs a remote manifest may carry. */
const MANIFEST_INSPECTION_RULES: ReadonlyArray<{ readonly kind: string; readonly severity: SecurityFinding["severity"]; readonly test: RegExp }> = [
  { kind: "shell-injection", severity: "BLOCKER", test: /\b(?:rm\s+-rf|mkfs|dd\s+if=|chmod\s+777|curl[^"]*\|\s*(?:sh|bash)|wget[^"]*\|\s*(?:sh|bash))\b/i },
  { kind: "prompt-injection", severity: "BLOCKER", test: /ignore (?:all )?(?:previous|prior) instructions|disregard (?:your )?(?:system|safety) (?:prompt|instructions)|you are now/i },
  { kind: "credential-harvest", severity: "BLOCKER", test: /(?:read|send|upload|exfiltrate).{0,40}(?:\.env|ssh|credentials|cookies|passwords|keychain)/i },
  { kind: "hidden-network", severity: "WARNING", test: /\b(?:webhook|callback|beacon|telemetry endpoint)\b/i },
  { kind: "elevated-shell", severity: "WARNING", test: /\b(?:sudo|runas|powershell -enc|cmd \/c)\b/i },
];

export class QuarantineFirstSkillSearch {
  private readonly firewall = new PrivacyFirewall();

  constructor(private readonly registry: DiscoveredSkillRegistry) {}

  /**
   * Quarantine a fetched remote skill for static inspection. The manifest
   * content is written into an isolated quarantine directory and NEVER
   * executed. Inspection findings, risk, and privacy all feed the registry
   * decision; the caller (or user) decides on approval separately.
   */
  async quarantine(candidate: ExternalSkillCandidate, options: { readonly fetchManifest?: (url: string) => Promise<string> } = {}): Promise<QuarantinedSkill> {
    // Fetch (or use caller-provided content) — content lands in quarantine only.
    let raw: string;
    if (options.fetchManifest) {
      raw = await options.fetchManifest(candidate.sourceUrl);
    } else {
      raw = JSON.stringify(candidate.manifest);
    }

    const findings: SecurityFinding[] = [];
    for (const rule of MANIFEST_INSPECTION_RULES) {
      if (rule.test.test(raw)) {
        findings.push({ severity: rule.severity, kind: rule.kind, detail: `Manifest matches ${rule.kind} pattern.` });
      }
    }

    const privacy = this.firewall.evaluate(candidate.manifest as never as import("../../core/types.js").JsonObject);
    const permissions = Array.isArray(candidate.manifest["requiresPermissions"])
      ? candidate.manifest["requiresPermissions"] as string[] : [];
    const riskClass = classifySkillRisk({
      permissions,
      filesystemRequirements: asStrings(candidate.manifest["filesystemRequirements"]),
      networkRequirements: asStrings(candidate.manifest["networkRequirements"]),
      secretRequirements: asStrings(candidate.manifest["secretRequirements"]),
    });

    const quarantineRoot = await mkdtemp(join(tmpdir(), "quack-quarantine-"));
    const skillDir = join(quarantineRoot, sanitizeId(candidate.skillId));
    await mkdir(skillDir, { recursive: true });
    const containment = resolveInsideRoot(quarantineRoot, skillDir);
    if (!containment.allowed) throw new Error("Quarantine path escape — refusing to write.");
    const manifestPath = join(skillDir, "skill.json");
    await writeFile(manifestPath, raw, "utf8");

    const quarantined: QuarantinedSkill = {
      candidate,
      quarantinePath: manifestPath,
      contentHash: createHash("sha256").update(raw, "utf8").digest("hex"),
      manifestHash: createHash("sha256").update(JSON.stringify(candidate.manifest)).digest("hex"),
      riskClass,
      permissions,
      findings,
      privacyDecision: privacy.decision,
    };
    return quarantined;
  }

  /**
   * Register a quarantined skill into the discovery registry. BLOCKER
   * findings or firewall DENY force QUARANTINED state; otherwise the record
   * enters REVIEW_REQUIRED (external skills are never auto-approved).
   */
  register(quarantined: QuarantinedSkill): SkillRecord {
    const blocked = quarantined.findings.some(finding => finding.severity === "BLOCKER");
    const records = this.registry.registerDiscovered([{
      skillId: quarantined.candidate.skillId,
      name: quarantined.candidate.name,
      version: quarantined.candidate.version,
      kind: (typeof quarantined.candidate.manifest["kind"] === "string"
        ? quarantined.candidate.manifest["kind"] : "INSTRUCTION_ONLY") as UniversalSkillKind,
      source: quarantined.candidate.sourceUrl,
      root: quarantined.quarantinePath,
      manifestFile: quarantined.quarantinePath,
      manifestHash: quarantined.manifestHash,
      contentHash: quarantined.contentHash,
      riskClass: quarantined.riskClass,
      declaredPermissions: quarantined.permissions,
      platforms: asStrings(quarantined.candidate.manifest["platforms"]) ?? ["all"],
      safeMetadata: this.firewall.evaluate(quarantined.candidate.manifest as never as import("../../core/types.js").JsonObject).safe as Record<string, unknown>,
      privacy: { decision: quarantined.privacyDecision, dataClasses: [] },
    }]);
    const record = records[0]!;
    if (blocked || quarantined.privacyDecision === "DENY") {
      return this.registry.quarantine(record.skillId, `Static inspection blockers: ${quarantined.findings.filter(f => f.severity === "BLOCKER").map(f => f.kind).join(", ") || "privacy denial"}`)!;
    }
    return record;
  }

  /** Search results are recommendations only — never installed by search. */
  static recommendation(candidate: ExternalSkillCandidate, quarantined: QuarantinedSkill): {
    readonly skillId: string; readonly source: string; readonly version: string;
    readonly license: string | undefined; readonly risk: SkillRiskClass;
    readonly permissions: readonly string[]; readonly findings: readonly SecurityFinding[];
    readonly recommendation: "RECOMMEND" | "REVIEW" | "BLOCK";
  } {
    const blocked = quarantined.findings.some(finding => finding.severity === "BLOCKER");
    return {
      skillId: candidate.skillId,
      source: candidate.sourceUrl,
      version: candidate.version,
      license: candidate.license,
      risk: quarantined.riskClass,
      permissions: quarantined.permissions,
      findings: quarantined.findings,
      recommendation: blocked ? "BLOCK" : quarantined.riskClass === "HIGH" ? "REVIEW" : "RECOMMEND",
    };
  }
}

/** Read a quarantined manifest back (for user inspection — no execution). */
export async function readQuarantinedManifest(quarantinePath: string): Promise<string> {
  return readFile(quarantinePath, "utf8");
}

/** List quarantine artifacts (audit surface). */
export async function listQuarantine(quarantineDir: string): Promise<readonly string[]> {
  try { return (await readdir(quarantineDir)).filter(name => name !== "skill.json"); }
  catch { return []; }
}

/** Destroy a quarantine directory (used when a candidate is rejected). */
export async function destroyQuarantine(quarantinePath: string): Promise<void> {
  const root = quarantinePath.split(/[\\/]/).slice(0, -2).join("/");
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
  await rm(quarantinePath, { recursive: true, force: true }).catch(() => undefined);
}

function asStrings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : undefined;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}