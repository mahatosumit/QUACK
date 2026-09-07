import { createHash } from "node:crypto";
import { createId, type JsonObject, type JsonValue, type QuackResult } from "../core/types.js";
import { TaskGraphBuilder } from "../engine/task-graph.js";
import { type RetryPolicy, type TaskGraph, type WorkflowState } from "../engine/types.js";
import { type Permission } from "../security/permissions.js";
import {
  type ToolInvocation,
  type ToolInvocationExecutor,
  type ToolMetadata,
  type ToolRegistry,
} from "../tools/tool.js";
import {
  type PortableSkillExecutionDefinition,
  type PortableSkillStep,
  type PortableToolInvocation,
  type SkillDefinition,
  type SkillInput,
  type SkillRecord,
  type SkillResult,
} from "./types.js";

export const PORTABLE_SKILL_EXECUTION_SCHEMA_VERSION = 1;

export interface SkillSandboxPolicy {
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxRetriesPerStep: number;
  readonly timeoutMs: number;
  readonly maxPollMs: number;
}

export interface SkillSandboxRuntimeDependencies {
  readonly tools: ToolRegistry;
  readonly executeTool?: ToolInvocationExecutor;
  readonly executeGraph?: (graph: TaskGraph, context: { readonly sessionId: string; readonly skillId: string; readonly deadline: string }) => Promise<QuackResult<WorkflowState>>;
  readonly allowedPermissions?: readonly Permission[];
  readonly policy?: Partial<SkillSandboxPolicy>;
}

export interface SkillSandboxValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const DEFAULT_POLICY: SkillSandboxPolicy = {
  maxSteps: 8,
  maxToolCalls: 12,
  maxRetriesPerStep: 1,
  timeoutMs: 5_000,
  maxPollMs: 10_000,
};

const NO_RETRY: RetryPolicy = { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 };

export class DurableSkillSandboxRuntime {
  private readonly policy: SkillSandboxPolicy;

  constructor(private readonly deps: SkillSandboxRuntimeDependencies) {
    this.policy = { ...DEFAULT_POLICY, ...(deps.policy ?? {}) };
  }

  validate(definition: SkillDefinition, record?: SkillRecord): SkillSandboxValidation {
    const portable = definition.portableExecution;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!portable) {
      return { valid: false, errors: ["Skill does not define portable execution."], warnings };
    }
    if (portable.schemaVersion !== PORTABLE_SKILL_EXECUTION_SCHEMA_VERSION) {
      errors.push(`Unsupported portable execution schema ${portable.schemaVersion}.`);
    }
    if (record && record.fingerprint && record.fingerprint !== portableSkillArtifactFingerprint(definition)) {
      errors.push(`Skill ${definition.manifest.id}@${definition.manifest.version} fingerprint does not match its portable execution artifact.`);
    }
    if (record && !["active", "candidate"].includes(record.status)) {
      errors.push(`Skill lifecycle ${record.status} is not executable.`);
    }
    for (const compatibility of portable.compiledAgainstTools ?? []) {
      const tool = this.deps.tools.get(compatibility.toolId);
      if (!tool.ok) {
        errors.push(`Compiled tool ${compatibility.toolId} is no longer registered; skill requires recompile.`);
        continue;
      }
      const currentFingerprint = toolMetadataFingerprint(tool.data.describe());
      if (currentFingerprint !== compatibility.metadataFingerprint) {
        errors.push(`Compiled tool ${compatibility.toolId} metadata changed; skill requires recompile.`);
      }
    }

    const limits = effectivePolicy(this.policy, portable);
    if (portable.steps.length === 0) errors.push("Portable execution requires at least one step.");
    if (portable.steps.length > limits.maxSteps) errors.push(`Portable execution has ${portable.steps.length} steps; max is ${limits.maxSteps}.`);

    const stepIds = new Set<string>();
    let toolCallCount = 0;
    for (const step of portable.steps) {
      validateStepShape(step, errors);
      if (stepIds.has(step.id)) errors.push(`Duplicate step id ${step.id}.`);
      stepIds.add(step.id);
      if ((step.retryPolicy?.maxRetries ?? 0) > limits.maxRetriesPerStep) {
        errors.push(`Step ${step.id} retry count exceeds max ${limits.maxRetriesPerStep}.`);
      }
      if ((step.timeoutMs ?? limits.timeoutMs) > limits.timeoutMs) {
        errors.push(`Step ${step.id} timeout exceeds max ${limits.timeoutMs}ms.`);
      }
      toolCallCount += step.toolInvocations.length;
      for (const toolId of step.requiredTools) {
        const tool = this.deps.tools.get(toolId);
        if (!tool.ok) {
          errors.push(`Required tool ${toolId} is not registered.`);
          continue;
        }
        if (!definition.manifest.requiresTools.includes(toolId)) {
          errors.push(`Required tool ${toolId} is not declared by skill manifest.`);
        }
        for (const permission of tool.data.describe().permissions) {
          if (!definition.manifest.requiresPermissions.includes(permission)) {
            errors.push(`Tool ${toolId} requires undeclared permission ${permission}.`);
          }
          if (this.deps.allowedPermissions && !this.deps.allowedPermissions.includes(permission)) {
            errors.push(`Permission ${permission} is not satisfiable by current policy.`);
          }
        }
      }
      for (const invocation of step.toolInvocations) {
        if (!step.requiredTools.includes(invocation.toolId)) {
          errors.push(`Invocation ${invocation.toolId} is not declared in step ${step.id}.`);
        }
        if (!definition.manifest.requiresTools.includes(invocation.toolId)) {
          errors.push(`Invocation ${invocation.toolId} is not declared by skill manifest.`);
        }
        validatePortableInput(invocation.input, errors);
      }
      for (const dependency of step.dependencies ?? []) {
        if (!stepIds.has(dependency) && !portable.steps.some((candidate) => candidate.id === dependency)) {
          errors.push(`Step ${step.id} depends on missing step ${dependency}.`);
        }
      }
    }
    if (toolCallCount > limits.maxToolCalls) errors.push(`Portable execution has ${toolCallCount} tool calls; max is ${limits.maxToolCalls}.`);
    if (hasCycle(portable.steps)) errors.push("Portable execution dependency graph contains a cycle.");
    if (definition.manifest.requiresPermissions.some(isProhibitedPermission)) {
      errors.push("Portable skill manifest requests a prohibited permission.");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  compile(definition: SkillDefinition, input: SkillInput, record?: SkillRecord): TaskGraph {
    const validation = this.validate(definition, record);
    if (!validation.valid) {
      throw new Error(`Portable skill validation failed: ${validation.errors.join("; ")}`);
    }
    const portable = definition.portableExecution!;
    const limits = effectivePolicy(this.policy, portable);
    const builder = new TaskGraphBuilder({
      description: `Portable skill ${definition.manifest.id}@${definition.manifest.version}`,
      metadata: {
        skillId: definition.manifest.id,
        skillVersion: definition.manifest.version,
        fingerprint: portableSkillArtifactFingerprint(definition),
        portableSchemaVersion: portable.schemaVersion,
      },
    });

    for (const step of portable.steps) {
      builder.addNode(step.id, {
        description: step.description,
        dependencies: step.dependencies ?? [],
        tools: step.requiredTools,
        toolInvocations: step.toolInvocations.map((invocation) => ({
          toolId: invocation.toolId,
          input: resolvePortableInput(input, invocation.input),
          reason: invocation.reason,
        })),
        timeoutMs: step.timeoutMs ?? limits.timeoutMs,
        retryPolicy: step.retryPolicy ?? NO_RETRY,
      });
    }

    return builder.build();
  }

  async execute(definition: SkillDefinition, input: SkillInput, record?: SkillRecord): Promise<SkillResult> {
    const started = Date.now();
    const graph = this.compile(definition, input, record);
    if (!this.deps.executeGraph) return { ok: false, error: "Portable skill execution requires the canonical runtime graph executor.", durationMs: Date.now() - started };
    const result = await this.deps.executeGraph(graph, {
      sessionId: input.context.sessionId, skillId: definition.manifest.id,
      deadline: new Date(started + this.policy.maxPollMs).toISOString(),
    });
    if (!result.ok) return { ok: false, error: result.error.message, durationMs: Date.now() - started };
    const state = result.data;
    const workflowId = state.workflowId;
    const toolIds = Object.values(state.nodeResults).flatMap((result) => [...result.toolCalls]);
    const ok = state.status === "completed" && Object.values(state.nodeResults).every((result) => result.success);
    return {
      ok,
      data: {
        kind: "portable.skill.execution",
        skillId: definition.manifest.id,
        skillVersion: definition.manifest.version,
        fingerprint: portableSkillArtifactFingerprint(definition),
        portableSchemaVersion: definition.portableExecution?.schemaVersion ?? null,
        workflowId,
        status: state.status,
        executedToolIds: toolIds,
        nodeResults: state.nodeResults,
      },
      error: ok ? undefined : state.errors[0] ?? firstNodeError(state),
      durationMs: Date.now() - started,
    };
  }
}

export function portableSkillArtifactFingerprint(definition: SkillDefinition): string {
  return createHash("sha256").update(stableStringify({
    manifest: definition.manifest,
    portableExecution: definition.portableExecution ?? null,
  })).digest("hex");
}

export function toolMetadataFingerprint(metadata: ToolMetadata): string {
  return createHash("sha256").update(stableStringify(metadata)).digest("hex");
}

function effectivePolicy(policy: SkillSandboxPolicy, portable: PortableSkillExecutionDefinition): SkillSandboxPolicy {
  return {
    maxSteps: Math.min(portable.limits?.maxSteps ?? policy.maxSteps, policy.maxSteps),
    maxToolCalls: Math.min(portable.limits?.maxToolCalls ?? policy.maxToolCalls, policy.maxToolCalls),
    maxRetriesPerStep: Math.min(portable.limits?.maxRetriesPerStep ?? policy.maxRetriesPerStep, policy.maxRetriesPerStep),
    timeoutMs: Math.min(portable.limits?.timeoutMs ?? policy.timeoutMs, policy.timeoutMs),
    maxPollMs: policy.maxPollMs,
  };
}

function validateStepShape(step: PortableSkillStep, errors: string[]): void {
  if (!step.id.trim()) errors.push("Step id is required.");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(step.id)) errors.push(`Step id ${step.id} is not supported.`);
  if (!step.description.trim()) errors.push(`Step ${step.id} description is required.`);
  if (!Array.isArray(step.requiredTools)) errors.push(`Step ${step.id} requiredTools must be an array.`);
  if (!Array.isArray(step.toolInvocations)) errors.push(`Step ${step.id} toolInvocations must be an array.`);
}

function validatePortableInput(value: unknown, errors: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) validatePortableInput(item, errors);
    return;
  }
  if (!isPlainObject(value)) return;

  if ("$fromInput" in value) {
    if (Object.keys(value).length !== 1 || typeof value["$fromInput"] !== "string") {
      errors.push("$fromInput binding requires exactly one string field.");
    }
    return;
  }
  if ("$fromParameter" in value) {
    if (Object.keys(value).length !== 1 || typeof value["$fromParameter"] !== "string") {
      errors.push("$fromParameter binding requires exactly one string field.");
    }
    return;
  }
  if ("$fromNode" in value) {
    const keys = Object.keys(value);
    if (!keys.every((key) => key === "$fromNode" || key === "path") ||
      typeof value["$fromNode"] !== "string" ||
      ("path" in value && typeof value["path"] !== "string")) {
      errors.push("$fromNode binding requires string $fromNode and optional string path.");
    }
    return;
  }
  if (Object.keys(value).some((key) => key.startsWith("$"))) {
    errors.push(`Unsupported binding kind ${Object.keys(value).find((key) => key.startsWith("$"))}.`);
    return;
  }

  for (const nested of Object.values(value)) validatePortableInput(nested, errors);
}

function resolvePortableInput(input: SkillInput, value: unknown): JsonObject {
  const resolved = resolvePortableValue(input, value);
  if (!isPlainObject(resolved)) throw new Error("Resolved portable tool input must be a JSON object.");
  return resolved as JsonObject;
}

function resolvePortableValue(input: SkillInput, value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map((item) => resolvePortableValue(input, item));
  if (!isPlainObject(value)) return toJsonValue(value);
  if (typeof value["$fromInput"] === "string" && Object.keys(value).length === 1) {
    return cloneJsonValue(readInputPath(input, value["$fromInput"]));
  }
  if (typeof value["$fromParameter"] === "string" && Object.keys(value).length === 1) {
    const parameterValue = input.parameters[value["$fromParameter"]];
    if (parameterValue === undefined) throw new Error(`Missing portable skill parameter ${value["$fromParameter"]}.`);
    return cloneJsonValue(toJsonValue(parameterValue));
  }
  if (typeof value["$fromNode"] === "string") {
    return cloneJsonValue(value as JsonObject);
  }
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolvePortableValue(input, nested)])) as JsonObject;
}

function readInputPath(input: SkillInput, path: string): JsonValue {
  switch (path) {
    case "goal": return input.goal;
    case "context.workspaceRoot": return input.context.workspaceRoot;
    case "context.dataDir": return input.context.dataDir;
    case "context.sessionId": return input.context.sessionId;
    default: throw new Error(`Unsupported portable input binding ${path}.`);
  }
}

function hasCycle(steps: readonly PortableSkillStep[]): boolean {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (byId.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

function firstNodeError(state: WorkflowState): string | undefined {
  return Object.values(state.nodeResults).find((result) => !result.success)?.error;
}

function isProhibitedPermission(permission: string): boolean {
  return permission === "filesystem.write.external" ||
    permission === "secrets.read" ||
    permission === "secrets.write" ||
    permission === "plugin.install";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toJsonValue(nested)])) as JsonObject;
  throw new Error("Portable skill input bindings must resolve to JSON values.");
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortKeys(object[key])]));
}
