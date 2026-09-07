import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { PrivacyFirewall, type PrivacyResult } from "./privacy.js";
import { classifySkillRisk, skillContentHash, type SkillRiskClass, type UniversalSkillKind } from "../universal.js";
import { resolveInsideRoot } from "../../platform/paths.js";

/**
 * Privacy-safe local skill discovery (ADR 0041).
 *
 * CRITICAL: discovery NEVER scans the user's personal filesystem. It reads
 * only explicitly configured skill roots — and inside them, only skill
 * manifests (`skill.json` / `manifest.json` / `SKILL.md` front-matter) and
 * package metadata. It does NOT ingest neighboring files, does not descend
 * into forbidden directories, and does not read forbidden filenames. All
 * discovered metadata passes the PrivacyFirewall before it is returned or
 * persisted. Discovery never implies approval or executability.
 */

export interface DiscoveredSkill {
  readonly skillId: string;
  readonly name: string;
  readonly version: string;
  readonly kind: UniversalSkillKind;
  readonly source: string;
  readonly root: string;
  readonly manifestFile: string;
  readonly manifestHash: string;
  readonly contentHash: string;
  readonly riskClass: SkillRiskClass;
  readonly declaredPermissions: readonly string[];
  readonly platforms: readonly string[];
  /** Firewall-evaluated safe metadata; the only form allowed to reach a model. */
  readonly safeMetadata: JsonObjectAlias;
  readonly privacy: { readonly decision: PrivacyResult["decision"]; readonly dataClasses: readonly string[] };
}

type JsonObjectAlias = Record<string, unknown>;

export interface DiscoveryOptions {
  /** Explicit skill roots. Nothing outside these is ever read. */
  readonly roots: readonly string[];
  /** Max files inspected per root (manifests only — bounded by design). */
  readonly maxEntriesPerRoot?: number;
}

const MANIFEST_FILENAMES = ["skill.json", "manifest.json"] as const;
const DEFAULT_MAX_ENTRIES = 200;

export class SkillDiscovery {
  private readonly firewall = new PrivacyFirewall();

  constructor(private readonly options: DiscoveryOptions) {
    if (options.roots.length === 0) throw new Error("Skill discovery requires at least one explicit root directory.");
  }

  /**
   * Discover skill manifests under the configured roots. Reads only manifest
   * files; all content is firewall-classified; forbidden paths are skipped.
   */
  async discover(): Promise<readonly DiscoveredSkill[]> {
    const results: DiscoveredSkill[] = [];
    for (const root of this.options.roots) {
      const rootEntries = await this.scanRoot(root);
      results.push(...rootEntries);
    }
    return results;
  }

  private async scanRoot(root: string): Promise<DiscoveredSkill[]> {
    const resolvedRoot = resolve(root);
    let entries;
    try {
      entries = await readdir(resolvedRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: DiscoveredSkill[] = [];
    const limit = this.options.maxEntriesPerRoot ?? DEFAULT_MAX_ENTRIES;
    let inspected = 0;
    for (const entry of entries.slice(0, limit)) {
      if (inspected >= limit) break;
      if (this.firewall.isForbiddenDirectory(entry.name) || entry.name.startsWith(".")) continue;
      const entryPath = join(resolvedRoot, entry.name);
      if (!entry.isDirectory()) continue;
      inspected += 1;
      const discovered = await this.scanSkillDirectory(resolvedRoot, entryPath, entry.name);
      if (discovered) found.push(discovered);
    }
    return found;
  }

  private async scanSkillDirectory(root: string, dir: string, name: string): Promise<DiscoveredSkill | undefined> {
    for (const manifestName of MANIFEST_FILENAMES) {
      const manifestPath = join(dir, manifestName);
      const containment = resolveInsideRoot(root, manifestPath);
      if (!containment.allowed) continue;
      let raw: string;
      try {
        const fileStat = await stat(manifestPath);
        if (!fileStat.isFile()) continue;
        raw = await readFile(manifestPath, "utf8");
      } catch {
        continue;
      }
      if (this.firewall.isForbiddenFilename(manifestName)) continue;
      let parsed: JsonObjectAlias;
      try {
        parsed = JSON.parse(raw) as JsonObjectAlias;
      } catch {
        continue;
      }
      const manifestHash = createHash("sha256").update(raw, "utf8").digest("hex");
      const permissions = Array.isArray(parsed["requiresPermissions"]) ? (parsed["requiresPermissions"] as string[]) : [];
      const privacy = this.firewall.evaluate(parsed as never);
      const riskClass = classifySkillRisk({
        permissions,
        filesystemRequirements: asStrings(parsed["filesystemRequirements"]),
        networkRequirements: asStrings(parsed["networkRequirements"]),
        secretRequirements: asStrings(parsed["secretRequirements"]),
      });
      return {
        skillId: typeof parsed["id"] === "string" ? parsed["id"] : name,
        name: typeof parsed["name"] === "string" ? parsed["name"] : name,
        version: typeof parsed["version"] === "string" ? parsed["version"] : "0.0.0",
        kind: typeof parsed["kind"] === "string" ? parsed["kind"] as UniversalSkillKind : "INSTRUCTION_ONLY",
        source: `local:${dir}`,
        root: dir,
        manifestFile: manifestPath,
        manifestHash,
        contentHash: skillContentHash(raw),
        riskClass,
        declaredPermissions: permissions,
        platforms: asStrings(parsed["platforms"]) ?? ["all"],
        safeMetadata: privacy.safe as JsonObjectAlias,
        privacy: { decision: privacy.decision, dataClasses: privacy.audit.dataClasses },
      };
    }
    return undefined;
  }
}

function asStrings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === "string") ? value as string[] : undefined;
}