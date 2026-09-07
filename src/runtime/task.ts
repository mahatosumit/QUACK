import { type IsoTimestamp, type JsonObject } from "../core/types.js";

export type MissionOrigin = "user" | "cli" | "api" | "sdk" | "desktop" | "improvement" | "system";

export type TaskStatus = "created" | "planned" | "running" | "completed" | "failed";

export interface TaskStep {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "running" | "completed" | "failed";
}

export interface Task {
  readonly execution?: import("../engine/execution-recovery.js").ExecutionIdentity;
  readonly id: string;
  readonly goal: string;
  readonly status: TaskStatus;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly plan: readonly TaskStep[];
  readonly result?: JsonObject;
  readonly error?: JsonObject;
  /** Origin of the mission that created this task. Used for recursion guard. */
  readonly origin?: MissionOrigin;
}

