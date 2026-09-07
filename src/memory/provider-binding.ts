import type { ExecutionContextV1 } from "../contracts/v1/contracts.js";
import { createId, type JsonObject, type QuackResult } from "../core/types.js";
import type { ContextFragment, MemoryProvider, MemoryProviderContext } from "../extensions/types.js";
import {
  capabilityIdForPermission, classifyPermissionAction, scopeForPermission,
  type CapabilityBroker, type CapabilityRequest,
} from "../security/capability-broker.js";
import type { Permission } from "../security/permissions.js";
import { MemoryPolicy, type MemoryAccessPolicy, type MemoryItem, type MemoryItemType, type MemoryQuery, type MemoryStoreInput } from "./os.js";
import {
  MemoryBindingError, type MemoryBindingIdentity, type MemoryOperationContext,
  type MemoryRecord, type MemoryScope, type MemoryStore,
} from "./memory.js";

export interface MemoryProviderBindingOptions {
  readonly provider: MemoryProvider;
  readonly capabilityBroker: CapabilityBroker;
  readonly namespace: string;
  readonly timeoutMs: number;
  readonly maxItems: number;
  readonly maxBytes: number;
}

export interface MemoryContextLoadRequest {
  readonly execution: ExecutionContextV1;
  readonly sessionId: string;
  readonly goal: string;
  readonly namespace: string;
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly maxTokens: number;
}

export class MemoryProviderBinding implements MemoryStore {
  readonly binding: MemoryBindingIdentity;
  private readonly policy = new MemoryPolicy();

  constructor(private readonly options: MemoryProviderBindingOptions) {
    if (!options.namespace.trim() || !Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0
      || !Number.isInteger(options.maxItems) || options.maxItems <= 0
      || !Number.isInteger(options.maxBytes) || options.maxBytes <= 0) {
      throw new MemoryBindingError("memory.binding_invalid", "Memory provider bounds must be positive integers.");
    }
    if (typeof options.provider.store !== "function" || typeof options.provider.retrieve !== "function") {
      throw new MemoryBindingError("memory.operation_unsupported", "The configured memory provider must support read and write operations.");
    }
    this.binding = Object.freeze({ providerId: options.provider.id, providerVersion: options.provider.version,
      namespace: options.namespace });
  }

  async write(record: Omit<MemoryRecord, "id" | "createdAt">, context?: MemoryOperationContext): Promise<MemoryRecord> {
    const operation = requireContext(context);
    const memoryClass = record.metadata["memoryClass"];
    if (memoryClass === "validated-knowledge" && typeof record.metadata["validationEvidenceId"] !== "string") {
      throw new MemoryBindingError("memory.knowledge_unvalidated", "Validated knowledge requires host validation evidence.");
    }
    const type: MemoryItemType = memoryClass === "experience" ? "skill.execution"
      : memoryClass === "validated-knowledge" ? "knowledge.long_term" : "mission.short_term";
    const accessPolicy: MemoryAccessPolicy = {
      visibility: "mission", allowedMissionIds: [operation.missionId], requiredCapabilities: ["permission.memory.write"],
    };
    const confidence = typeof record.metadata["confidence"] === "number" ? record.metadata["confidence"] : 1;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new MemoryBindingError("memory.input_invalid", "Memory confidence must be between zero and one.");
    }
    const input: MemoryStoreInput = deepFreeze({
      type, source: typeof record.metadata["source"] === "string" ? record.metadata["source"] : "runtime.memory",
      confidence,
      accessPolicy, relatedMission: operation.missionId, content: record.content,
      metadata: { ...record.metadata, memoryScope: record.scope, operationId: operation.operationId ?? createId("memory-operation") },
    });
    if (!isJsonObject(input.metadata) || Buffer.byteLength(JSON.stringify(input), "utf8") > this.options.maxBytes) {
      throw new MemoryBindingError("memory.input_too_large", "Memory provider write exceeded the configured byte limit.");
    }
    const providerContext = await this.authorizedContext("memory.write", operation, String(input.metadata?.["operationId"]));
    const result = await this.invoke(bounded => this.options.provider.store(input, bounded), providerContext, "write");
    const item = validateStoreResult(result, input, this.binding);
    return {
      id: item.id, scope: record.scope, content: item.content, createdAt: item.timestamp,
      metadata: cloneJson({ ...item.metadata, memoryProviderId: this.binding.providerId,
        memoryProviderVersion: this.binding.providerVersion, providerRecordId: item.id, providerSource: item.source }),
    };
  }

  async search(query: { readonly scope?: MemoryScope; readonly text?: string; readonly limit?: number }, context?: MemoryOperationContext): Promise<MemoryRecord[]> {
    const operation = requireContext(context);
    const items = await this.retrieveItems({ text: query.text, missionId: operation.missionId, limit: query.limit }, operation);
    return items
      .map(item => ({ id: item.id, scope: memoryScope(item), content: item.content, createdAt: item.timestamp,
        metadata: cloneJson({ ...item.metadata, memoryProviderId: this.binding.providerId,
          memoryProviderVersion: this.binding.providerVersion, providerRecordId: item.id, providerSource: item.source,
          memoryType: item.type, confidence: item.confidence }) }))
      .filter(record => query.scope ? record.scope === query.scope : true);
  }

  async loadContext(request: MemoryContextLoadRequest): Promise<ContextFragment[]> {
    const operation: MemoryOperationContext = {
      missionId: request.execution.missionId, taskId: request.execution.taskId,
      executionId: request.execution.executionId, sessionId: request.sessionId, actor: request.execution.actor,
      namespace: request.namespace, signal: request.execution.signal, deadline: request.execution.deadline,
      operationId: `memory-context:${request.execution.executionId}`,
    };
    const items = await this.retrieveItems({ text: request.goal, missionId: request.execution.missionId,
      limit: Math.min(request.maxItems, this.options.maxItems) }, operation);
    const fragments = items.map(item => ({
      id: `memory:${this.binding.providerId}:${item.id}`,
      namespace: request.namespace,
      content: cloneJson({ type: item.type, content: item.content, scope: memoryScope(item), timestamp: item.timestamp,
        confidence: item.confidence, accessPolicy: cloneJson(item.accessPolicy as unknown as JsonObject), metadata: item.metadata }),
      classification: classification(item.accessPolicy),
      provenance: { sourceId: this.binding.providerId, recordId: item.id, observedAt: item.timestamp },
      retention: "persistent" as const,
    })) satisfies ContextFragment[];
    const serialized = JSON.stringify(fragments);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const tokens = Math.ceil(serialized.length / 4);
    if (bytes > Math.min(request.maxBytes, this.options.maxBytes) || tokens > request.maxTokens) {
      throw new MemoryBindingError("memory.response_too_large", "Memory provider context exceeded the configured byte limit.");
    }
    return fragments;
  }

  async forget(id: string, context?: MemoryOperationContext): Promise<void> {
    if (!this.options.provider.forget) throw new MemoryBindingError("memory.operation_unsupported", "The configured memory provider does not support delete.");
    const operation = requireContext(context);
    const providerContext = await this.authorizedContext("memory.write", operation, operation.operationId ?? `memory-forget:${id}`);
    const result = await this.invoke(bounded => this.options.provider.forget!(id, bounded), providerContext, "delete");
    if (!isQuackResult(result) || !result.ok) throw new MemoryBindingError("memory.provider_write_failed", "Memory provider delete failed.");
  }

  private async retrieveItems(query: MemoryQuery, operation: MemoryOperationContext): Promise<MemoryItem[]> {
    const limit = Math.min(query.limit ?? this.options.maxItems, this.options.maxItems);
    if (!Number.isInteger(limit) || limit <= 0) throw new MemoryBindingError("memory.query_invalid", "Memory query limit must be a positive integer.");
    const providerContext = await this.authorizedContext("memory.read", operation, operation.operationId ?? createId("memory-query"));
    const providerQuery = deepFreeze({ ...query, missionId: operation.missionId, limit });
    const response = await this.invoke(bounded => this.options.provider.retrieve(providerQuery, bounded), providerContext, "read");
    if (!Array.isArray(response) || response.length > limit) {
      throw new MemoryBindingError("memory.provider_invalid_response", "Memory provider returned an invalid or oversized result list.");
    }
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > this.options.maxBytes) {
      throw new MemoryBindingError("memory.response_too_large", "Memory provider response exceeded the configured byte limit.");
    }
    const seen = new Set<string>();
    return response.map(value => {
      const item = validateItem(value, this.binding);
      if (seen.has(item.id)) throw new MemoryBindingError("memory.provider_invalid_response", "Memory provider returned duplicate record identities.");
      seen.add(item.id);
      const policy = this.policy.canAccess(item, { actor: operation.actor, missionId: operation.missionId,
        agentId: operation.agentId, capabilities: ["permission.memory.read"] }, "read");
      if (!policy.ok) throw new MemoryBindingError("memory.policy_denied", policy.error.message);
      return item;
    });
  }

  private async authorizedContext(permission: Permission, operation: MemoryOperationContext, operationId: string): Promise<MemoryProviderContext> {
    const request: CapabilityRequest = {
      id: createId("capability"), taskId: operation.taskId, missionId: operation.missionId,
      agentId: operation.agentId, skillId: operation.skillId, actor: operation.actor,
      capabilityId: capabilityIdForPermission(permission), permission,
      action: classifyPermissionAction(permission), resource: scopeForPermission(permission),
      reason: `${this.binding.providerId} requests ${permission}.`,
      context: { providerId: this.binding.providerId, operationId, namespace: operation.namespace ?? this.binding.namespace },
    };
    const decision = await this.options.capabilityBroker.resolve(request);
    if (!decision.granted) throw new MemoryBindingError("memory.policy_denied", decision.reason);
    const current = this.options.capabilityBroker.revalidateAuthority?.(request);
    if (current && !current.granted) throw new MemoryBindingError("memory.policy_denied", current.reason);
    return Object.freeze({ actor: operation.actor, missionId: operation.missionId, agentId: operation.agentId,
      capabilities: Object.freeze([capabilityIdForPermission(permission)]), namespace: operation.namespace ?? this.binding.namespace,
      sessionId: operation.sessionId, taskId: operation.taskId, executionId: operation.executionId,
      operationId, signal: operation.signal, deadline: operation.deadline });
  }

  private async invoke<T>(operation: (context: MemoryProviderContext) => Promise<T>, context: MemoryProviderContext, kind: "read" | "write" | "delete"): Promise<T> {
    if (context.signal?.aborted) throw new MemoryBindingError("memory.cancelled", "Memory provider operation was cancelled.");
    const deadlineMs = context.deadline ? Date.parse(context.deadline) : Infinity;
    if (!Number.isFinite(deadlineMs) && context.deadline) throw new MemoryBindingError("memory.deadline_invalid", "Memory provider deadline is invalid.");
    const timeoutMs = Math.min(this.options.timeoutMs, deadlineMs - Date.now());
    if (timeoutMs <= 0) throw new MemoryBindingError("memory.provider_timeout", "Memory provider deadline expired.");
    const controller = new AbortController();
    const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
    const boundedContext = Object.freeze({ ...context, signal,
      deadline: new Date(Date.now() + timeoutMs).toISOString() });
    let timer: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error(`Memory provider ${kind} timed out.`));
        reject(new MemoryBindingError("memory.provider_timeout", `Memory provider ${kind} timed out.`));
      }, timeoutMs);
      if (context.signal) {
        abortListener = () => reject(new MemoryBindingError("memory.cancelled", "Memory provider operation was cancelled."));
        context.signal.addEventListener("abort", abortListener, { once: true });
      }
    });
    try {
      return await Promise.race([Promise.resolve().then(() => operation(boundedContext)), interrupted]);
    } catch (error) {
      if (error instanceof MemoryBindingError) throw error;
      throw new MemoryBindingError("memory.provider_unavailable", `Memory provider ${kind} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (timer) clearTimeout(timer);
      if (abortListener && context.signal) context.signal.removeEventListener("abort", abortListener);
    }
  }
}

function requireContext(context: MemoryOperationContext | undefined): MemoryOperationContext {
  if (!context || !context.missionId?.trim() || !context.taskId?.trim() || !context.executionId?.trim()
    || !context.sessionId?.trim() || !context.actor?.trim()) {
    throw new MemoryBindingError("memory.context_required", "Configured memory providers require host execution context.");
  }
  return context;
}

function validateStoreResult(result: unknown, input: MemoryStoreInput, binding: MemoryBindingIdentity): MemoryItem {
  if (!isQuackResult(result)) throw new MemoryBindingError("memory.provider_invalid_response", "Memory provider returned a malformed write result.");
  if (!result.ok) throw new MemoryBindingError("memory.provider_write_failed", `Memory provider write failed: ${result.error.message}`);
  const item = validateItem(result.data, binding);
  if (item.type !== input.type || item.content !== input.content || item.relatedMission !== input.relatedMission
    || item.source !== input.source || item.confidence !== input.confidence
    || canonical(item.accessPolicy) !== canonical(input.accessPolicy) || canonical(item.metadata) !== canonical(input.metadata)) {
    throw new MemoryBindingError("memory.provider_identity_mutation", "Memory provider changed host-owned memory input or execution binding.");
  }
  return item;
}

function validateItem(value: unknown, binding: MemoryBindingIdentity): MemoryItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(binding);
  const item = value as MemoryItem;
  if (typeof item.id !== "string" || !item.id.trim() || typeof item.source !== "string" || !item.source.trim()
    || !["mission.short_term", "knowledge.long_term", "skill.execution", "user.preference"].includes(item.type)
    || typeof item.timestamp !== "string" || !Number.isFinite(Date.parse(item.timestamp))
    || typeof item.confidence !== "number" || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1
    || typeof item.content !== "string" || !validAccessPolicy(item.accessPolicy) || !isJsonObject(item.metadata)
    || (item.relatedMission !== undefined && (typeof item.relatedMission !== "string" || !item.relatedMission.trim()))) invalid(binding);
  return structuredClone(item);
}

function invalid(binding: MemoryBindingIdentity): never {
  throw new MemoryBindingError("memory.provider_invalid_response", `Memory provider ${binding.providerId} returned a malformed record.`);
}

function validAccessPolicy(value: unknown): value is MemoryAccessPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as MemoryAccessPolicy;
  return ["private", "mission", "global"].includes(policy.visibility)
    && validStrings(policy.allowedMissionIds) && validStrings(policy.allowedAgents) && validStrings(policy.requiredCapabilities);
}

function validStrings(value: readonly string[] | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.every(item => typeof item === "string" && item.trim()));
}

function isJsonObject(value: unknown): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value)) || (Array.isArray(value) && value.every(isJsonValue))
    || isJsonObject(value);
}

function isQuackResult(value: unknown): value is QuackResult<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { ok?: unknown }).ok !== "boolean") return false;
  const result = value as QuackResult<unknown>;
  return result.ok ? "data" in result : Boolean(result.error && typeof result.error.code === "string" && typeof result.error.message === "string");
}

function memoryScope(item: MemoryItem): MemoryScope {
  const scope = item.metadata["memoryScope"];
  return typeof scope === "string" && ["session", "task", "agent", "workspace", "project", "global"].includes(scope)
    ? scope as MemoryScope : item.relatedMission ? "task" : "global";
}

function classification(policy: MemoryAccessPolicy): ContextFragment["classification"] {
  return policy.visibility === "private" ? "restricted" : policy.visibility === "mission" ? "confidential" : "internal";
}

function cloneJson<T extends JsonObject>(value: T): T {
  if (!isJsonObject(value)) throw new MemoryBindingError("memory.provider_invalid_response", "Memory metadata is not JSON data.");
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
