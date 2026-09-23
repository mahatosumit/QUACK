import type { LoopBudget } from "../agent-loop/contract.js";
import type { QuackError, QuackResult } from "../core/types.js";
import type { TaskGraph } from "../engine/types.js";
import type { MissionOrigin, Task } from "./task.js";

/** Product modes are policy inputs; they never select a separate runtime. */
export type MissionMode = "build" | "plan" | "review" | "mission";

/** Execution strategies admitted by the canonical runtime. */
export type MissionEngine = "dag" | "governed";

export type MissionExecutionState =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT"
  | "INTERRUPTED";

export interface MissionRoutingPreference {
  readonly providerId?: string;
  readonly model?: string;
  readonly capability?: "fast" | "cheap" | "reasoning" | "coding" | "vision" | "local";
  readonly localOnly?: boolean;
}

/**
 * Canonical mission entry contract shared by CLI, API, SDK, desktop, and
 * gateway adapters. Capabilities remain declarations only; the broker is the
 * sole authority that can approve their use.
 */
export interface MissionRequest {
  readonly objective: string;
  readonly actor?: string;
  readonly missionId?: string;
  readonly origin?: MissionOrigin;
  readonly engine?: MissionEngine;
  readonly mode?: MissionMode;
  /** Execution identity for delegated/specialist work. */
  readonly agentId?: string;
  /** Optional policy profile; profiles modify policy, never runtime ownership. */
  readonly profileId?: string;
  readonly skillId?: string;
  readonly permissions?: readonly string[];
  readonly constraints?: readonly string[];
  readonly verificationCriteria?: readonly string[];
  readonly routing?: MissionRoutingPreference;
  readonly budget?: Partial<LoopBudget>;
  /** Trusted prepared graph; execution still passes through broker and verification. */
  readonly precompiledGraph?: TaskGraph;
  readonly signal?: AbortSignal;
  readonly deadline?: string;
}

/** Request passed to a trusted engine adapter after runtime normalization. */
export interface ResolvedMissionRequest extends MissionRequest {
  readonly objective: string;
  readonly actor: string;
  readonly missionId: string;
  readonly origin: MissionOrigin;
  readonly engine: MissionEngine;
  readonly mode: MissionMode;
  readonly constraints: readonly string[];
  readonly permissions: readonly string[];
  readonly verificationCriteria: readonly string[];
}

/** Provider-neutral result returned by every runtime execution strategy. */
export interface MissionExecution {
  readonly missionId: string;
  readonly executionId: string;
  readonly engine: MissionEngine;
  readonly mode: MissionMode;
  readonly state: MissionExecutionState;
  readonly iterations: number;
  readonly taskId?: string;
  readonly task?: Task;
  readonly error?: QuackError;
}

/**
 * Trusted composition adapter for an execution strategy. Registration grants
 * no capabilities and must not bypass the runtime's broker-backed surfaces.
 */
export interface MissionEngineAdapter {
  readonly engine: Exclude<MissionEngine, "dag">;
  execute(request: ResolvedMissionRequest): Promise<QuackResult<MissionExecution>>;
}

export const MISSION_MODES: readonly MissionMode[] = ["build", "plan", "review", "mission"];

export function isMissionMode(value: unknown): value is MissionMode {
  return typeof value === "string" && (MISSION_MODES as readonly string[]).includes(value);
}
