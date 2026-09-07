import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { DiscoveredSkill } from "./discovery.js";
import type { SkillRiskClass, SkillTrustModel } from "../universal.js";

/**
 * Persistent skill registry (ADR 0041).
 *
 * Metadata-only persistence following the canonical JSON-file store pattern
 * (atomic tmp+rename). Discovery records are never executable; installation
 * state transitions are explicit; content changes after installation move
 * the record to REVALIDATION_REQUIRED and the skill must never silently
 * execute modified content.
 */

export type SkillInstallationState =
  | "DISCOVERED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "INSTALLED"
  | "DISABLED"
  | "REVOKED"
  | "QUARANTINED"
  | "REVALIDATION_REQUIRED";

export interface SkillRecord {
  readonly skillId: string;
  readonly version: string;
  readonly source: string;
  readonly manifestHash: string;
  readonly contentHash: string;
  readonly trustLevel: SkillTrustModel;
  readonly riskLevel: SkillRiskClass;
  readonly permissions: readonly string[];
  readonly platformCompatibility: readonly string[];
  readonly installationState: SkillInstallationState;
  readonly verificationState: "UNVERIFIED" | "HASH_VERIFIED" | "FAILED";
  readonly lastValidated: string;
  readonly discoveredAt: string;
  readonly privacyDataClasses: readonly string[];
}

export interface SkillRegistryStore {
  load(): SkillRecord[];
  save(records: readonly SkillRecord[]): void;
}

export class InMemorySkillRegistryStore implements SkillRegistryStore {
  private records: SkillRecord[] = [];
  load(): SkillRecord[] { return [...this.records]; }
  save(records: readonly SkillRecord[]): void { this.records = [...records]; }
}

export class JsonFileSkillRegistryStore implements SkillRegistryStore {
  constructor(private readonly filePath: string) {}

  load(): SkillRecord[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { readonly version: number; readonly records: SkillRecord[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
      return parsed.records;
    } catch {
      return [];
    }
  }

  save(records: readonly SkillRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    // Synchronous atomic tmp+rename: the store's contract is sync, and a
    // floating async write here raced every subsequent load (records
    // "vanished" between save and the next read on a busy event loop).
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(tmpPath, JSON.stringify({ version: 1, records }, null, 2), "utf8");
      renameWithTransientRetrySync(tmpPath, this.filePath);
    } finally {
      try { rmSync(tmpPath, { force: true }); } catch { /* already renamed */ }
    }
  }
}

/** Windows EPERM/EBUSY-tolerant rename, matching atomicWriteFile semantics. */
function renameWithTransientRetrySync(source: string, destination: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 5 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      const until = Date.now() + 10 * (attempt + 1);
      while (Date.now() < until) { /* brief busy wait: sync contract */ }
    }
  }
}

export class DiscoveredSkillRegistry {
  constructor(private readonly store: SkillRegistryStore) {}

  list(): readonly SkillRecord[] {
    return this.store.load();
  }

  get(skillId: string): SkillRecord | undefined {
    return this.store.load().find(record => record.skillId === skillId);
  }

  /**
   * Register discovery results. Discovery NEVER implies approval:
   * records enter as DISCOVERED, or REVIEW_REQUIRED when risk/trust demand
   * review. Existing records with changed content hashes move to
   * REVALIDATION_REQUIRED (including INSTALLED ones — modified content must
   * never silently keep its installation).
   */
  registerDiscovered(skills: readonly DiscoveredSkill[]): readonly SkillRecord[] {
    const now = new Date().toISOString();
    const existing = new Map(this.store.load().map(record => [record.skillId, record]));
    const results: SkillRecord[] = [];
    for (const skill of skills) {
      const prior = existing.get(skill.skillId);
      const contentChanged = prior !== undefined && prior.contentHash !== skill.contentHash;
      const trustLevel: SkillTrustModel = "UNVERIFIED";
      const reviewRequired = skill.riskClass === "HIGH"
        || skill.privacy.decision === "DENY"
        || (skill.declaredPermissions.some(permission => permission.startsWith("secrets.")));
      let installationState: SkillInstallationState;
      if (contentChanged) {
        installationState = "REVALIDATION_REQUIRED";
      } else if (prior && (prior.installationState === "INSTALLED" || prior.installationState === "APPROVED"
        || prior.installationState === "DISABLED")) {
        installationState = prior.installationState;
      } else {
        installationState = reviewRequired ? "REVIEW_REQUIRED" : "DISCOVERED";
      }
      const record: SkillRecord = {
        skillId: skill.skillId,
        version: skill.version,
        source: skill.source,
        manifestHash: skill.manifestHash,
        contentHash: skill.contentHash,
        trustLevel: prior && !contentChanged && prior.trustLevel !== "UNVERIFIED" ? prior.trustLevel : trustLevel,
        riskLevel: skill.riskClass,
        permissions: [...skill.declaredPermissions],
        platformCompatibility: [...skill.platforms],
        installationState,
        verificationState: contentChanged ? "UNVERIFIED" : prior?.verificationState ?? "UNVERIFIED",
        lastValidated: now,
        discoveredAt: prior?.discoveredAt ?? now,
        privacyDataClasses: [...skill.privacy.dataClasses],
      };
      results.push(record);
    }
    // Preserve records for skills not seen in this discovery pass.
    const seen = new Set(skills.map(skill => skill.skillId));
    const retained = this.store.load().filter(record => !seen.has(record.skillId));
    const merged = [...retained, ...results];
    this.store.save(merged);
    return results;
  }

  /** Explicit transition APIs; each is a no-op when the skill is absent. */
  approve(skillId: string): SkillRecord | undefined {
    return this.transition(skillId, record => {
      if (record.installationState === "QUARANTINED" || record.installationState === "REVOKED") {
        throw new Error(`Skill ${skillId} is ${record.installationState} and cannot be approved without explicit unquarantine.`);
      }
      return { ...record, installationState: "APPROVED" as const, trustLevel: "USER_APPROVED" as const };
    });
  }

  install(skillId: string): SkillRecord | undefined {
    return this.transition(skillId, record => {
      if (record.installationState !== "APPROVED" && record.installationState !== "INSTALLED") {
        throw new Error(`Skill ${skillId} must be approved before installation (state: ${record.installationState}).`);
      }
      return { ...record, installationState: "INSTALLED" as const, verificationState: "HASH_VERIFIED" as const };
    });
  }

  disable(skillId: string): SkillRecord | undefined {
    return this.transition(skillId, record => ({ ...record, installationState: "DISABLED" as const }));
  }

  revoke(skillId: string): SkillRecord | undefined {
    return this.transition(skillId, record => ({ ...record, installationState: "REVOKED" as const, trustLevel: "BLOCKED" as const }));
  }

  quarantine(skillId: string, reason: string): SkillRecord | undefined {
    return this.transition(skillId, record => ({
      ...record, installationState: "QUARANTINED" as const, trustLevel: "QUARANTINED" as const,
      verificationState: "FAILED" as const,
      quarantineReason: reason,
    } as SkillRecord & { quarantineReason: string }));
  }

  private transition(skillId: string, mutate: (record: SkillRecord) => SkillRecord): SkillRecord | undefined {
    const records = this.store.load();
    const index = records.findIndex(record => record.skillId === skillId);
    if (index === -1) return undefined;
    const updated = mutate(records[index]!);
    records[index] = updated;
    this.store.save(records);
    return updated;
  }
}

/** Verify a manifest's content hash matches the stored record. */
export function verifySkillRecordContent(record: SkillRecord, manifestContent: string): boolean {
  return createHash("sha256").update(manifestContent, "utf8").digest("hex") === record.contentHash;
}