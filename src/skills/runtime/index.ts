import type { QuackRuntime } from "../../runtime/runtime.js";
import { createId, errorToJson, fail, now, ok, type JsonObject, type QuackError, type QuackResult } from "../../core/types.js";
import { type EventBus } from "../../events/event-bus.js";
import {
  buildToolCapabilityRequest,
  capabilityIdForPermission,
  type CapabilityBroker,
  type CapabilityDecision,
} from "../../security/capability-broker.js";
import { type Permission } from "../../security/permissions.js";
import { type ToolRegistry } from "../../tools/tool.js";
import { DurableSkillSandboxRuntime, type SkillSandboxPolicy } from "../sandbox-runtime.js";
import { SkillRegistry } from "../registry.js";
import {
  type PortableSkillExecutionDefinition,
  type PortableSkillStep,
  type SkillCategory,
  type SkillDefinition,
  type SkillExecutionLimits,
  type SkillInput,
  type SkillRecord,
  type SkillResult,
  type SkillTrustLevel,
  type SkillValidation,
} from "../types.js";

export interface SkillRuntimeManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly trustLevel: SkillTrustLevel;
  readonly requiredCapabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly inputSchema: JsonObject;
  readonly outputSchema: JsonObject;
  readonly executionLimits: Required<SkillExecutionLimits>;
  readonly category?: SkillCategory;
  readonly tags?: readonly string[];
  readonly workflow: {
    readonly steps: readonly PortableSkillStep[];
  };
}

export interface SkillRuntimeExecuteOptions {
  readonly missionId?: string;
  readonly agentId?: string;
  readonly actor?: string;
  readonly allowCandidate?: boolean;
}

export interface SkillRuntimeDependencies {
  readonly registry: SkillRegistry;
  readonly tools: ToolRegistry;
  readonly capabilityBroker: CapabilityBroker;
  readonly executeGraph?: QuackRuntime["executeGraph"];
  readonly executeTool: (
    toolId: string,
    input: JsonObject,
    options: { readonly taskId: string; readonly actor?: string; readonly missionId?: string; readonly agentId?: string; readonly skillId?: string },
  ) => Promise<QuackResult<JsonObject>>;
  readonly eventBus: EventBus;
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly policy?: Partial<SkillSandboxPolicy>;
}

export interface SkillRuntimeValidation extends SkillValidation {
  readonly requiredPermissions: readonly Permission[];
  readonly resolvedCapabilities: readonly string[];
}

export class SkillRuntime {
  constructor(private readonly deps: SkillRuntimeDependencies) {}

  async loadSkillManifest(manifest: SkillRuntimeManifest): Promise<QuackResult<SkillDefinition>> {
    const validation = this.validateManifest(manifest);
    if (!validation.valid) {
      await this.deps.eventBus.emit("skill.failed", {
        skillId: manifest.id ?? "unknown",
        version: manifest.version ?? null,
        phase: "load",
        errors: validation.errors,
      }, { actor: "skill-runtime" });
      return fail({
        code: "skill_runtime.invalid_manifest",
        message: validation.errors.join("; "),
        category: "validation",
        recoverable: true,
      });
    }

    const definition = this.definitionFromManifest(manifest, validation.requiredPermissions);
    this.deps.registry.register(definition, manifest.trustLevel === "builtin" ? "builtin" : "imported", "inactive", {
      portableExecution: definition.portableExecution,
      setDefault: false,
    });

    await this.deps.eventBus.emit("skill.loaded", {
      skillId: manifest.id,
      version: manifest.version,
      trustLevel: manifest.trustLevel,
      allowedTools: [...manifest.allowedTools],
      requiredCapabilities: [...manifest.requiredCapabilities],
    }, { actor: "skill-runtime" });

    return ok(definition);
  }

  registerSkill(definition: SkillDefinition, status: "active" | "inactive" = "inactive"): QuackResult<SkillRecord> {
    const validation = this.validateDefinition(definition);
    if (!validation.valid) {
      return fail({
        code: "skill_runtime.invalid_definition",
        message: validation.errors.join("; "),
        category: "validation",
        recoverable: true,
      });
    }

    this.deps.registry.register(definition, "imported", status, {
      portableExecution: definition.portableExecution,
      setDefault: status === "active",
    });
    const record = this.deps.registry.getRecord(definition.manifest.id, definition.manifest.version);
    return record ? ok(record) : fail({
      code: "skill_runtime.registration_failed",
      message: `Skill ${definition.manifest.id}@${definition.manifest.version} was not registered.`,
      category: "runtime",
      recoverable: true,
    });
  }

  discoverSkill(query: string): SkillRecord[] {
    return this.deps.registry.search(query);
  }

  async validateSkill(id: string, version?: string): Promise<SkillRuntimeValidation> {
    const definition = this.deps.registry.get(id, version);
    if (!definition) {
      return { valid: false, errors: [`Skill '${id}' was not found.`], warnings: [], requiredPermissions: [], resolvedCapabilities: [] };
    }
    return this.validateDefinition(definition);
  }

  enableSkill(id: string, version?: string): QuackResult<SkillRecord> {
    const validationResult = this.validateRegisteredSkillSync(id, version);
    if (!validationResult.ok) return validationResult;
    this.deps.registry.updateStatus(id, "active", version);
    const record = this.deps.registry.getRecord(id, version);
    return record ? ok(record) : fail(notFoundError(id));
  }

  disableSkill(id: string, version?: string): QuackResult<SkillRecord> {
    const record = this.deps.registry.getRecord(id, version);
    if (!record) return fail(notFoundError(id));
    this.deps.registry.updateStatus(id, "inactive", version);
    return ok(this.deps.registry.getRecord(id, version)!);
  }

  async executeSkill(id: string, input: Omit<SkillInput, "context"> & { readonly context?: Partial<SkillInput["context"]> }, options: SkillRuntimeExecuteOptions = {}): Promise<SkillResult> {
    const started = Date.now();
    const taskId = createId("skillrun");
    const actor = options.actor ?? "skill-runtime";
    const definition = this.deps.registry.get(id);
    const record = this.deps.registry.getRecord(id);

    if (!definition || !record) {
      return this.failedResult(id, undefined, started, `Skill '${id}' was not found.`, actor, taskId);
    }
    if (!["active", "candidate"].includes(record.status) || (record.status === "candidate" && !options.allowCandidate)) {
      return this.failedResult(id, record.manifest.version, started, `Skill '${record.versionKey}' lifecycle ${record.status} is not executable.`, actor, taskId);
    }

    await this.deps.eventBus.emit("skill.started", {
      skillId: id,
      version: record.manifest.version,
      missionId: options.missionId ?? null,
      taskId,
    }, { taskId, actor });

    const validation = this.validateDefinition(definition);
    await this.deps.eventBus.emit("skill.validated", {
      skillId: id,
      version: record.manifest.version,
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      resolvedCapabilities: validation.resolvedCapabilities,
    }, { taskId, actor: "skill-runtime" });
    if (!validation.valid) {
      return this.failedResult(id, record.manifest.version, started, validation.errors.join("; "), actor, taskId);
    }

    const capability = await this.preflightCapabilities(definition, taskId, actor, options);
    if (!capability.ok) {
      return this.failedResult(id, record.manifest.version, started, capability.error.message, actor, taskId, capability.error);
    }

    const sandbox = new DurableSkillSandboxRuntime({
      tools: this.deps.tools,
      executeGraph: this.deps.executeGraph ? (graph, context) => this.deps.executeGraph!(graph, actor, { missionId: options.missionId, agentId: options.agentId, skillId: id, deadline: context.deadline }) : undefined,
      allowedPermissions: validation.requiredPermissions,
      policy: {
        ...this.deps.policy,
        maxSteps: definition.portableExecution?.limits?.maxSteps,
        maxToolCalls: definition.portableExecution?.limits?.maxToolCalls,
        maxRetriesPerStep: definition.portableExecution?.limits?.maxRetriesPerStep,
        timeoutMs: definition.portableExecution?.limits?.timeoutMs,
      },
      executeTool: async (invocation, context) => {
        if (!definition.manifest.allowedTools?.includes(invocation.toolId)) {
          return { toolId: invocation.toolId, success: false, error: `Tool ${invocation.toolId} is not allowed by skill ${id}.` };
        }
        const result = await this.deps.executeTool(invocation.toolId, invocation.input, {
          taskId: context.taskId,
          actor: context.actor,
          missionId: options.missionId,
          agentId: options.agentId,
          skillId: id,
        });
        return result.ok
          ? { toolId: invocation.toolId, success: true, output: result.data }
          : { toolId: invocation.toolId, success: false, error: result.error.message };
      },
    });

    try {
      const result = await sandbox.execute(definition, {
        goal: input.goal,
        parameters: input.parameters,
        context: {
          workspaceRoot: input.context?.workspaceRoot ?? this.deps.workspaceRoot,
          dataDir: input.context?.dataDir ?? this.deps.dataDir,
          sessionId: input.context?.sessionId ?? taskId,
        },
      }, record);
      const durationMs = Date.now() - started;
      this.deps.registry.recordUsage(id, durationMs, record.manifest.version);
      await this.deps.eventBus.emit(result.ok ? "skill.completed" : "skill.failed", {
        skillId: id,
        version: record.manifest.version,
        missionId: options.missionId ?? null,
        taskId,
        durationMs,
        ...(result.ok ? {} : { error: result.error ?? "Skill execution failed." }),
      }, { taskId, actor: result.ok ? "skill-runtime" : actor });
      return { ...result, durationMs };
    } catch (error) {
      return this.failedResult(id, record.manifest.version, started, error instanceof Error ? error.message : String(error), actor, taskId);
    }
  }

  validateManifest(manifest: SkillRuntimeManifest): SkillRuntimeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.id?.trim()) errors.push("Skill id is required.");
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id ?? "")) errors.push("Skill id must be stable kebab/dot/underscore text.");
    if (!manifest.name?.trim()) errors.push("Skill name is required.");
    if (!manifest.version?.trim()) errors.push("Skill version is required.");
    if (!manifest.description?.trim()) errors.push("Skill description is required.");
    if (!manifest.author?.trim()) errors.push("Skill author is required.");
    if (!["builtin", "trusted", "verified", "community", "experimental"].includes(manifest.trustLevel)) errors.push("Skill trust level is invalid.");
    if (!Array.isArray(manifest.requiredCapabilities) || manifest.requiredCapabilities.length === 0) errors.push("Skill requires at least one capability.");
    if (!Array.isArray(manifest.allowedTools) || manifest.allowedTools.length === 0) errors.push("Skill requires a non-empty tool allowlist.");
    if (!manifest.workflow || !Array.isArray(manifest.workflow.steps) || manifest.workflow.steps.length === 0) errors.push("Skill workflow requires at least one step.");
    const limits = manifest.executionLimits;
    if (!limits) {
      errors.push("Skill manifest requires executionLimits.");
    } else {
      if (!isPositiveInteger(limits.maxIterations)) errors.push("executionLimits.maxIterations must be a positive integer.");
      if (!isPositiveInteger(limits.maxToolCalls)) errors.push("executionLimits.maxToolCalls must be a positive integer.");
      if (!isPositiveInteger(limits.maxRetriesPerStep, true)) errors.push("executionLimits.maxRetriesPerStep must be a non-negative integer.");
      if (!isPositiveInteger(limits.timeoutMs)) errors.push("executionLimits.timeoutMs must be a positive integer.");
    }

    const requiredPermissions = permissionsForAllowedTools(this.deps.tools, manifest.allowedTools, errors);
    const resolvedCapabilities = requiredPermissions.map(capabilityIdForPermission);
    for (const capability of resolvedCapabilities) {
      if (!manifest.requiredCapabilities.includes(capability)) {
        errors.push(`Required capability ${capability} is missing from manifest.requiredCapabilities.`);
      }
    }

    const toolCallCount = (manifest.workflow?.steps ?? []).reduce((count, step) => count + step.toolInvocations.length, 0);
    if (limits && toolCallCount > limits.maxToolCalls) errors.push(`Workflow declares ${toolCallCount} tool calls; max is ${limits.maxToolCalls}.`);
    if (limits && (manifest.workflow?.steps.length ?? 0) > limits.maxIterations) errors.push(`Workflow declares ${manifest.workflow.steps.length} steps; max is ${limits.maxIterations}.`);
    for (const step of manifest.workflow?.steps ?? []) {
      for (const toolId of step.requiredTools) {
        if (!manifest.allowedTools.includes(toolId)) errors.push(`Step ${step.id} requires non-allowlisted tool ${toolId}.`);
      }
      for (const invocation of step.toolInvocations) {
        if (!manifest.allowedTools.includes(invocation.toolId)) errors.push(`Step ${step.id} invokes non-allowlisted tool ${invocation.toolId}.`);
      }
    }

    if (manifest.trustLevel === "experimental") warnings.push("Experimental skills should stay disabled until reviewed.");
    return { valid: errors.length === 0, errors, warnings, requiredPermissions, resolvedCapabilities };
  }

  validateDefinition(definition: SkillDefinition): SkillRuntimeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!definition.portableExecution) errors.push("Skill Runtime v1 only executes declarative portable workflows.");
    if (!definition.manifest.allowedTools || definition.manifest.allowedTools.length === 0) errors.push("Skill manifest requires allowedTools.");
    if (!definition.manifest.requiredCapabilities || definition.manifest.requiredCapabilities.length === 0) errors.push("Skill manifest requires requiredCapabilities.");
    if (!definition.manifest.executionLimits) errors.push("Skill manifest requires executionLimits.");

    const requiredPermissions = permissionsForAllowedTools(this.deps.tools, definition.manifest.allowedTools ?? definition.manifest.requiresTools, errors);
    const resolvedCapabilities = requiredPermissions.map(capabilityIdForPermission);
    for (const capability of resolvedCapabilities) {
      if (!(definition.manifest.requiredCapabilities ?? []).includes(capability)) {
        errors.push(`Required capability ${capability} is missing from manifest.`);
      }
    }
    for (const step of definition.portableExecution?.steps ?? []) {
      for (const invocation of step.toolInvocations) {
        if (!(definition.manifest.allowedTools ?? []).includes(invocation.toolId)) {
          errors.push(`Invocation ${invocation.toolId} is outside the skill tool allowlist.`);
        }
      }
    }
    return { valid: errors.length === 0, errors, warnings, requiredPermissions, resolvedCapabilities };
  }

  private async preflightCapabilities(
    definition: SkillDefinition,
    taskId: string,
    actor: string,
    options: SkillRuntimeExecuteOptions,
  ): Promise<QuackResult<readonly CapabilityDecision[]>> {
    const decisions: CapabilityDecision[] = [];
    for (const permission of definition.manifest.requiresPermissions) {
      const toolId = definition.manifest.allowedTools?.[0] ?? definition.manifest.requiresTools[0] ?? "unknown";
      const request = buildToolCapabilityRequest({
        taskId,
        missionId: options.missionId,
        agentId: options.agentId,
        skillId: definition.manifest.id,
        actor,
        toolId,
        permission,
        input: {},
        reason: `Skill ${definition.manifest.id}@${definition.manifest.version} requires ${permission}.`,
      });
      const decision = await this.deps.capabilityBroker.resolve(request);
      decisions.push(decision);
      const payload: JsonObject = {
        requestId: request.id,
        missionId: request.missionId ?? null,
        agentId: request.agentId ?? null,
        skillId: request.skillId ?? null,
        capabilityId: request.capabilityId,
        permission: request.permission ?? null,
        toolId: request.toolId ?? null,
        action: request.action,
        resource: request.resource as unknown as JsonObject,
        reason: decision.reason,
        timestamp: now(),
        decision: decision.granted ? "allowed" : "denied",
        granted: decision.granted,
        policyRef: decision.policyRef ?? null,
        grantId: decision.grantId ?? null,
      };
      await this.deps.eventBus.emit("capability.checked", payload, { taskId, actor: "security" });
      await this.deps.eventBus.emit(decision.granted ? "capability.allowed" : "capability.denied", payload, { taskId, actor: "security" });
      if (!decision.granted) {
        return fail(capabilityDeniedError(definition.manifest.id, definition.manifest.version, request.capabilityId, permission, decision.reason));
      }
    }
    return ok(decisions);
  }

  private definitionFromManifest(manifest: SkillRuntimeManifest, permissions: readonly Permission[]): SkillDefinition {
    const portable: PortableSkillExecutionDefinition = {
      schemaVersion: 1,
      steps: manifest.workflow.steps,
      limits: {
        maxSteps: manifest.executionLimits.maxIterations,
        maxToolCalls: manifest.executionLimits.maxToolCalls,
        maxRetriesPerStep: manifest.executionLimits.maxRetriesPerStep,
        timeoutMs: manifest.executionLimits.timeoutMs,
      },
    };
    return {
      manifest: {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        trustLevel: manifest.trustLevel,
        requiredCapabilities: [...manifest.requiredCapabilities],
        allowedTools: [...manifest.allowedTools],
        inputSchema: manifest.inputSchema,
        outputSchema: manifest.outputSchema,
        executionLimits: manifest.executionLimits,
        category: manifest.category ?? "custom",
        tags: manifest.tags ?? [],
        requiresPermissions: permissions,
        requiresTools: [...manifest.allowedTools],
        entry: "declarative.workflow",
      },
      portableExecution: portable,
      execute: async () => ({
        ok: false,
        error: "Skill Runtime v1 declarative skills must execute through SkillRuntime.executeSkill().",
        durationMs: 0,
      }),
    };
  }

  private validateRegisteredSkillSync(id: string, version?: string): QuackResult<SkillRecord> {
    const definition = this.deps.registry.get(id, version);
    const record = this.deps.registry.getRecord(id, version);
    if (!definition || !record) return fail(notFoundError(id));
    const validation = this.validateDefinition(definition);
    if (!validation.valid) {
      return fail({
        code: "skill_runtime.invalid_definition",
        message: validation.errors.join("; "),
        category: "validation",
        recoverable: true,
      });
    }
    return ok(record);
  }

  private async failedResult(
    skillId: string,
    version: string | undefined,
    started: number,
    message: string,
    actor: string,
    taskId: string,
    error?: QuackError,
  ): Promise<SkillResult> {
    const durationMs = Date.now() - started;
    await this.deps.eventBus.emit("skill.failed", {
      skillId,
      version: version ?? null,
      taskId,
      durationMs,
      error: error ? errorToJson(error) : { message },
    }, { taskId, actor });
    return { ok: false, error: message, durationMs };
  }
}

function permissionsForAllowedTools(tools: ToolRegistry, toolIds: readonly string[], errors: string[]): Permission[] {
  const permissions = new Set<Permission>();
  for (const toolId of toolIds) {
    const tool = tools.get(toolId);
    if (!tool.ok) {
      errors.push(`Allowed tool ${toolId} is not registered.`);
      continue;
    }
    for (const permission of tool.data.describe().permissions) permissions.add(permission);
  }
  return [...permissions].sort();
}

function isPositiveInteger(value: unknown, allowZero = false): boolean {
  return typeof value === "number" && Number.isInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function notFoundError(id: string): QuackError {
  return {
    code: "skill_runtime.not_found",
    message: `Skill '${id}' was not found.`,
    category: "runtime",
    recoverable: true,
  };
}

function capabilityDeniedError(skillId: string, version: string, capability: string, permission: Permission, reason: string): QuackError {
  return {
    code: "skill_runtime.capability_denied",
    message: `CapabilityDeniedError: skill ${skillId}@${version} cannot execute because ${capability} was denied.`,
    category: "permission",
    recoverable: true,
    context: {
      errorType: "CapabilityDeniedError",
      skillId,
      version,
      requiredCapability: capability,
      missingPermission: permission,
      reason,
    },
  };
}
