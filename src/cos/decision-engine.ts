import { createId, now } from "../core/types.js";
import { type DecisionRecord, type CouncilSession } from "./types.js";

export class DecisionEngine {
  private decisions = new Map<string, DecisionRecord>();

  create(params: {
    problem: string;
    alternatives: { name: string; description: string; pros: string[]; cons: string[] }[];
    evidence?: string[];
    tradeoffs?: string[];
    risks?: string[];
    madeBy: string;
    participants?: string[];
    tags?: string[];
  }): DecisionRecord {
    const decision: DecisionRecord = {
      id: createId("dec"),
      problem: params.problem,
      alternatives: params.alternatives,
      evidence: params.evidence ?? [],
      tradeoffs: params.tradeoffs ?? [],
      risks: params.risks ?? [],
      decision: "",
      rationale: "",
      expectedOutcome: "",
      madeBy: params.madeBy,
      participants: params.participants ?? [],
      status: "pending",
      tags: params.tags ?? [],
      createdAt: now(),
    };
    this.decisions.set(decision.id, decision);
    return decision;
  }

  make(id: string, decision: string, rationale: string, expectedOutcome: string, voteResult?: string, councilId?: string): boolean {
    const record = this.decisions.get(id);
    if (!record || record.status !== "pending") return false;
    record.decision = decision;
    record.rationale = rationale;
    record.expectedOutcome = expectedOutcome;
    record.voteResult = voteResult;
    record.councilId = councilId;
    record.status = "made";
    return true;
  }

  implement(id: string): boolean {
    const record = this.decisions.get(id);
    if (!record) return false;
    record.status = "implemented";
    record.implementedAt = now();
    return true;
  }

  review(id: string, actualOutcome: string, tags?: string[]): boolean {
    const record = this.decisions.get(id);
    if (!record) return false;
    record.actualOutcome = actualOutcome;
    record.reviewDate = now();
    record.status = "reviewed";
    if (tags) record.tags = [...new Set([...record.tags, ...tags])];
    return true;
  }

  supersede(id: string): boolean {
    const record = this.decisions.get(id);
    if (!record) return false;
    record.status = "superseded";
    return true;
  }

  get(id: string): DecisionRecord | undefined {
    return this.decisions.get(id);
  }

  getAll(): DecisionRecord[] {
    return [...this.decisions.values()];
  }

  getByStatus(status: string): DecisionRecord[] {
    return this.getAll().filter((d) => d.status === status);
  }

  search(query: string): DecisionRecord[] {
    const lower = query.toLowerCase();
    return this.getAll().filter((d) =>
      d.problem.toLowerCase().includes(lower) ||
      d.decision.toLowerCase().includes(lower) ||
      d.tags.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  getStats(): { total: number; made: number; implemented: number; reviewed: number; superseded: number } {
    const all = this.getAll();
    return {
      total: all.length,
      made: all.filter((d) => d.status === "made").length,
      implemented: all.filter((d) => d.status === "implemented").length,
      reviewed: all.filter((d) => d.status === "reviewed").length,
      superseded: all.filter((d) => d.status === "superseded").length,
    };
  }

  clear(): void {
    this.decisions.clear();
  }
}
