import { type JsonObject } from "../core/types.js";
import { type Permission } from "../security/permissions.js";

/**
 * Represents a tool call that can be made by the brain during execution.
 */
export interface ToolUse {
  readonly toolId: string;
  readonly input: JsonObject;
  readonly reason: string;
}

/**
 * Represents a tool result after execution.
 */
export interface ToolResult {
  readonly toolId: string;
  readonly output: JsonObject;
  readonly success: boolean;
  readonly error?: string;
}

/**
 * Represents a provider choice made by the brain.
 */
export interface ProviderChoice {
  readonly providerId: string;
  readonly model: string;
  readonly reason: string;
  readonly estimatedCost?: number;
  readonly estimatedLatencyMs?: number;
}

/**
 * Context for memory retrieval during brain operations.
 */
export interface MemoryContext {
  readonly workingMemory: readonly string[];
  readonly relevantHistory: readonly string[];
  readonly workspaceNotes: readonly string[];
}

/**
 * States the brain can be in during execution.
 */
export type BrainState =
  | "idle"
  | "planning"
  | "reasoning"
  | "executing"
  | "reflecting"
  | "retrying"
  | "completing"
  | "failed";
