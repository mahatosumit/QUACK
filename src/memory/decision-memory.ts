import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";
import { isMissingFile } from "../core/utils.js";

/**
 * DecisionMemoryStore — persists WHY decisions were made (quackos.md §11).
 * Stores decisions/ and rationale/ acrioss two flat JSON files. Additive to the
 * existing DecisionEngine (in-memory) — this provides durability and search.
 *
 * Example record:
 *   { chosen: "PostgreSQL", reason: "Relational consistency required",
 *     impact: "Backend architecture", date: "2026-07-21" }
 */
export interface DecisionMemoryRecord {
  readonly id: string;
  chosen: string;
  reason: string;
  impact: string;
  date: IsoTimestamp;
  tags: string[];
  createdAt: IsoTimestamp;
}

export interface RationaleRecord {
  readonly id: string;
  decisionId: string;
  rationale: string;
  alternatives: { name: string; description: string }[];
  evidence: string[];
  createdAt: IsoTimestamp;
}

export class DecisionMemoryStore {
  private decisions: DecisionMemoryRecord[] = [];
  private rationales: RationaleRecord[] = [];
  private loaded = false;
  private readonly decisionsPath?: string;
  private readonly rationalePath?: string;

  constructor(dataDir?: string) {
    if (dataDir) {
      this.decisionsPath = join(dataDir, "decisions.json");
      this.rationalePath = join(dataDir, "rationale.json");
    }
  }

  async recordDecision(params: {
    chosen: string;
    reason: string;
    impact: string;
    tags?: string[];
  }): Promise<DecisionMemoryRecord> {
    await this.ensureLoaded();
    const record: DecisionMemoryRecord = {
      id: createId("dec"),
      chosen: params.chosen,
      reason: params.reason,
      impact: params.impact,
      date: now(),
      tags: params.tags ?? [],
      createdAt: now(),
    };
    this.decisions.push(record);
    await this.flush();
    return record;
  }

  async recordRationale(params: {
    decisionId: string;
    rationale: string;
    alternatives?: { name: string; description: string }[];
    evidence?: string[];
  }): Promise<RationaleRecord> {
    await this.ensureLoaded();
    const record: RationaleRecord = {
      id: createId("rat"),
      decisionId: params.decisionId,
      rationale: params.rationale,
      alternatives: params.alternatives ?? [],
      evidence: params.evidence ?? [],
      createdAt: now(),
    };
    this.rationales.push(record);
    await this.flush();
    return record;
  }

  getDecision(id: string): DecisionMemoryRecord | undefined {
    return this.decisions.find((d) => d.id === id);
  }

  getRationale(decisionId: string): RationaleRecord | undefined {
    return this.rationales.find((r) => r.decisionId === decisionId);
  }

  searchDecisions(query: string): DecisionMemoryRecord[] {
    const lower = query.toLowerCase();
    return this.decisions.filter((d) =>
      d.chosen.toLowerCase().includes(lower) ||
      d.reason.toLowerCase().includes(lower) ||
      d.impact.toLowerCase().includes(lower) ||
      d.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  getAllDecisions(): readonly DecisionMemoryRecord[] {
    return this.decisions;
  }

  getAllRationales(): readonly RationaleRecord[] {
    return this.rationales;
  }

  /** User control: delete. */
  async deleteDecision(id: string): Promise<boolean> {
    const idx = this.decisions.findIndex((d) => d.id === id);
    if (idx < 0) return false;
    this.decisions.splice(idx, 1);
    await this.flush();
    return true;
  }

  /** User control: export. */
  export(): { decisions: readonly DecisionMemoryRecord[]; rationales: readonly RationaleRecord[] } {
    return { decisions: this.decisions, rationales: this.rationales };
  }

  async clear(): Promise<void> {
    this.decisions = [];
    this.rationales = [];
    await this.flush();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.decisionsPath || !this.rationalePath) return;
    await this.loadFile(this.decisionsPath, "decisions");
    await this.loadFile(this.rationalePath, "rationales");
  }

  private async loadFile(path: string, kind: "decisions" | "rationales"): Promise<void> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as { records?: unknown[] };
      const arr = (parsed.records ?? []) as unknown;
      if (kind === "decisions") for (const r of (arr as readonly DecisionMemoryRecord[])) this.decisions.push(r);
      else for (const r of (arr as readonly RationaleRecord[])) this.rationales.push(r);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }

  private async flush(): Promise<void> {
    if (!this.decisionsPath || !this.rationalePath) return;
    await mkdir(dirname(this.decisionsPath), { recursive: true });
    await writeFile(this.decisionsPath, JSON.stringify({ records: this.decisions }, null, 2), "utf8");
    await writeFile(this.rationalePath, JSON.stringify({ records: this.rationales }, null, 2), "utf8");
  }
}
