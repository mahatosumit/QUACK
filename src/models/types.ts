export type ModelCapability =
  | "reasoning"
  | "coding"
  | "fast"
  | "careful"
  | "web"
  | "retrieval"
  | "balanced"
  | "ops"
  /** P9: embedding-capable models (ADR 0043). */
  | "embedding";

export interface ModelInfo {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly capabilities: readonly ModelCapability[];
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly latencyMs: number;
  readonly costPer1kInput: number;
  readonly costPer1kOutput: number;
  readonly status: "available" | "unavailable" | "error";
}

export interface RoutingPolicy {
  readonly id: string;
  readonly name: string;
  readonly strategy: "cost-first" | "fastest-first" | "capability-first" | "balanced" | "local-first";
}

export interface ModelAssignment {
  readonly task: string;
  readonly modelId: string;
  readonly policy: string;
}

export interface CostEstimate {
  readonly modelId: string;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
}

export interface ModelComparison {
  readonly models: readonly string[];
  readonly fastest: string | null;
  readonly cheapest: string | null;
  readonly mostCapable: string | null;
  readonly costRange: { min: number; max: number };
  readonly latencyRange: { min: number; max: number };
}
