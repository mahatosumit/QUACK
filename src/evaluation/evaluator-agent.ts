import { createId, now, type IsoTimestamp, type JsonObject } from "../core/types.js";

/** Evaluation dimensions per quackos.md §12. */
export type EvaluationDimension = "correctness" | "security" | "performance" | "maintainability" | "cost";

export interface DimensionScore {
  dimension: EvaluationDimension;
  score: number;
  notes: string;
  failed?: boolean;
}

export interface QualityReport {
  readonly id: string;
  taskId?: string;
  agentId?: string;
  output: JsonObject;
  overallScore: number;
  dimensions: DimensionScore[];
  passed: boolean;
  blockingIssues: string[];
  recommendations: string[];
  createdAt: IsoTimestamp;
}

/** A pluggable scorer for one dimension. Each registered scorer is additive. */
export interface DimensionScorer {
  readonly dimension: EvaluationDimension;
  score(input: EvaluationInput): DimensionScore;
}

export interface EvaluationInput {
  output: JsonObject;
  taskId?: string;
  agentId?: string;
  taskIdAvailable?: boolean;
  cost?: number;
  latencyMs?: number;
  source?: string;
  metadata?: JsonObject;
}

/**
 * EvaluatorAgent — autonomously evaluates agent outputs against the five
 * quackos.md §12 dimensions and produces a QualityReport for memory update.
 * Default scorers are heuristic-only (no model dependency) and additive —
 * custom scorers may be registered to override or augment defaults.
 */
export class EvaluatorAgent {
  private readonly scorers = new Map<EvaluationDimension, DimensionScorer>();
  private readonly reports: QualityReport[] = [];
  private readonly threshold;

  constructor(opts: { threshold?: number } = {}) {
    this.threshold = opts.threshold ?? 0.7;
    this.registerDefaultScorers();
  }

  registerScorer(scorer: DimensionScorer): void {
    this.scorers.set(scorer.dimension, scorer);
  }

  /** Evaluate an output and produce a QualityReport. */
  evaluate(input: EvaluationInput): QualityReport {
    const dimensions: DimensionScore[] = [];
    const blocking: string[] = [];

    for (const dim of ["correctness", "security", "performance", "maintainability", "cost"] as EvaluationDimension[]) {
      const scorer = this.scorers.get(dim);
      const score = scorer ? scorer.score(input) : { dimension: dim, score: 1.0, notes: "no scorer registered" };
      dimensions.push(score);
      if (score.failed) blocking.push(`${dim}: ${score.notes}`);
    }

    const overallScore = dimensions.reduce((s, d) => s + d.score, 0) / dimensions.length;
    const passed = overallScore >= this.threshold && blocking.length === 0;
    const recommendations = this.buildRecommendations(dimensions);

    const report: QualityReport = {
      id: createId("eval"),
      taskId: input.taskId,
      agentId: input.agentId,
      output: input.output,
      overallScore,
      dimensions,
      passed,
      blockingIssues: blocking,
      recommendations,
      createdAt: now(),
    };
    this.reports.push(report);
    return report;
  }

  getReport(id: string): QualityReport | undefined {
    return this.reports.find((r) => r.id === id);
  }

  getReports(): readonly QualityReport[] {
    return this.reports;
  }

  getReportsForAgent(agentId: string): readonly QualityReport[] {
    return this.reports.filter((r) => r.agentId === agentId);
  }

  getReportsForTask(taskId: string): readonly QualityReport[] {
    return this.reports.filter((r) => r.taskId === taskId);
  }

  summarize(): { total: number; passed: number; failed: number; avgScore: number } {
    const total = this.reports.length;
    const passed = this.reports.filter((r) => r.passed).length;
    const avg = total > 0 ? this.reports.reduce((s, r) => s + r.overallScore, 0) / total : 0;
    return { total, passed, failed: total - passed, avgScore: avg };
  }

  clear(): void {
    this.reports.length = 0;
  }

  private registerDefaultScorers(): void {
    this.registerScorer({
      dimension: "correctness",
      score: (input) => {
        if (!input.taskIdAvailable) {
          return { dimension: "correctness", score: 0.5, notes: "task ID unavailable — unable to verify closure" };
        }
        return { dimension: "correctness", score: 1.0, notes: "closure marker present" };
      },
    });

    this.registerScorer({
      dimension: "security",
      score: (input) => {
        const flags: string[] = (input.output["securityFlags"] as string[] | undefined) ?? [];
        const leaked = JSON.stringify(input.output).toLowerCase();
        const secretsLeaked = /api[_-]?key|password|secret|token/i.test(leaked) && !!input.output["containsSecret"];
        if (secretsLeaked) {
          return { dimension: "security", score: 0.0, failed: true, notes: "secrets present in output" };
        }
        if (flags.includes("prompt-injection")) {
          return { dimension: "security", score: 0.2, notes: "prompt-injection flag" };
        }
        return { dimension: "security", score: 1.0, notes: "no secrets or injection flags" };
      },
    });

    this.registerScorer({
      dimension: "performance",
      score: (input) => {
        const latency = input.latencyMs ?? 0;
        if (latency > 60_000) return { dimension: "performance", score: 0.2, notes: `latency ${latency}ms exceeds 60s` };
        if (latency > 30_000) return { dimension: "performance", score: 0.6, notes: `latency ${latency}ms exceeds 30s` };
        if (latency > 10_000) return { dimension: "performance", score: 0.8, notes: `latency ${latency}ms exceeds 10s` };
        return { dimension: "performance", score: 1.0, notes: `latency ${latency}ms within tolerance` };
      },
    });

    this.registerScorer({
      dimension: "maintainability",
      score: (input) => {
        const size = JSON.stringify(input.output).length;
        if (size === 0) return { dimension: "maintainability", score: 0.0, notes: "empty output" };
        if (size > 100_000) return { dimension: "maintainability", score: 0.4, notes: "output exceeds 100KB" };
        return { dimension: "maintainability", score: 1.0, notes: "output size within bounds" };
      },
    });

    this.registerScorer({
      dimension: "cost",
      score: (input) => {
        const cost = input.cost ?? 0;
        if (cost > 1.0) return { dimension: "cost", score: 0.2, notes: `cost $${cost.toFixed(2)} exceeds $1.00` };
        if (cost > 0.5) return { dimension: "cost", score: 0.5, notes: `cost $${cost.toFixed(2)} exceeds $0.50` };
        return { dimension: "cost", score: 1.0, notes: `cost $${cost.toFixed(2)} within budget` };
      },
    });
  }

  private buildRecommendations(dimensions: readonly DimensionScore[]): string[] {
    const recs: string[] = [];
    for (const d of dimensions) {
      if (d.score < 0.5) {
        recs.push(`Improve ${d.dimension}: ${d.notes}`);
      }
    }
    return recs;
  }
}
