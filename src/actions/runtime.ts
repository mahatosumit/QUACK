import { createId, now, type JsonObject } from "../core/types.js";
import {
  QUACK_CONTRACT_VERSION,
  type ActionDescriptorV1,
  type ActionProviderV1,
  type ActionRequestV1,
  type ActionResultV1,
  type EvidenceRecordV1,
  type ExecutionContextV1,
} from "../contracts/index.js";
import { type CompanyExecutionPrincipal } from "../company/runtime.js";
import {
  InMemoryActionExecutionLedger,
  createPlannedActionRecord,
  hashActionResult,
  isAmbiguous,
  transitionActionRecord,
  type ActionExecutionLedger,
  type ActionExecutionRecord,
} from "./ledger.js";

export interface ActionPermissionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface ActionApprovalDecision {
  readonly approved: boolean;
  readonly actor: string;
  readonly reason: string;
  readonly approvalId?: string;
}

export interface ActionRuntimeDependencies {
  readonly validateExecutionContext?: (context: ActionExecutionContext) => Promise<ActionPermissionDecision> | ActionPermissionDecision;
  readonly decidePermission: (permission: string, descriptor: ActionDescriptorV1, context: ActionExecutionContext, request: ActionRequestV1) => Promise<ActionPermissionDecision>;
  /** Synchronous authority check immediately before provider dispatch; must not request approval. */
  readonly revalidateAuthority?: (descriptor: ActionDescriptorV1, context: ActionExecutionContext, request: ActionRequestV1) => ActionPermissionDecision;
  readonly requestApproval?: (descriptor: ActionDescriptorV1, request: ActionRequestV1, context: ExecutionContextV1) => Promise<ActionApprovalDecision>;
  readonly recordEvidence?: (evidence: EvidenceRecordV1) => Promise<void> | void;
  readonly audit?: (event: ActionAuditEvent) => Promise<void> | void;
  readonly ledger?: ActionExecutionLedger;
}

export interface ActionExecutionContext extends ExecutionContextV1 {
  readonly companyPrincipal?: CompanyExecutionPrincipal;
}

export interface ActionAuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly providerId: string;
  readonly actionId: string;
  readonly phase: "REQUESTED" | "DENIED" | "APPROVED" | "STARTED" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly riskClass: ActionDescriptorV1["riskClass"];
  readonly message: string;
}

export class ActionProviderRegistry {
  private readonly providers = new Map<string, ActionProviderV1>();

  register(provider: ActionProviderV1): void {
    const metadata = provider.metadata();
    if (metadata.contractVersion !== QUACK_CONTRACT_VERSION) throw new Error(`Unsupported action contract ${metadata.contractVersion}.`);
    if (this.providers.has(metadata.providerId)) throw new Error(`Action provider ${metadata.providerId} is already registered.`);
    this.providers.set(metadata.providerId, provider);
  }

  remove(providerId: string): boolean { return this.providers.delete(providerId); }
  get(providerId: string): ActionProviderV1 | undefined { return this.providers.get(providerId); }
  list(): readonly ActionProviderV1[] { return [...this.providers.values()]; }

  async discoverActions(): Promise<readonly ActionDescriptorV1[]> {
    return (await Promise.all(this.list().map((provider) => provider.discoverActions()))).flat();
  }
}

/** Default-deny action runtime with validation, permission, approval, evidence and audit gates. */
export class ActionRuntime {
  private readonly active = new Map<string, { readonly provider: ActionProviderV1; readonly controller: AbortController }>();
  private readonly ledger: ActionExecutionLedger;

  constructor(
    private readonly registry: ActionProviderRegistry,
    private readonly dependencies: ActionRuntimeDependencies,
  ) { this.ledger = dependencies.ledger ?? new InMemoryActionExecutionLedger(); }

  async execute(providerId: string, request: ActionRequestV1, context: ActionExecutionContext): Promise<ActionResultV1> {
    const contextDecision = await this.dependencies.validateExecutionContext?.(context);
    if (contextDecision && !contextDecision.allowed) return denied(providerId, request.actionId, context.executionId, contextDecision.reason);
    const provider = this.registry.get(providerId);
    if (!provider) return denied(providerId, request.actionId, context.executionId, "Action provider is not registered.");
    const descriptor = (await provider.discoverActions(context)).find((candidate) => candidate.id === request.actionId);
    if (!descriptor) return denied(providerId, request.actionId, context.executionId, "Action is not registered by the provider.");
    await this.audit(descriptor, context, "REQUESTED", "Action request received.");

    const validation = validateJsonSchema(request.input, descriptor.inputSchema);
    if (validation) {
      await this.audit(descriptor, context, "DENIED", validation);
      return denied(providerId, request.actionId, context.executionId, validation);
    }
    if (request.dryRun && !descriptor.supportsDryRun) {
      const reason = "Action does not support dry-run.";
      await this.audit(descriptor, context, "DENIED", reason);
      return denied(providerId, request.actionId, context.executionId, reason);
    }

    if (descriptor.requiredPermissions.length === 0 || descriptor.requiredPermissions.some(permission => !permission.trim())) {
      const reason = "Executable actions must declare capability permissions; missing authority fails closed.";
      await this.audit(descriptor, context, "DENIED", reason);
      return denied(providerId, request.actionId, context.executionId, reason);
    }
    for (const permission of descriptor.requiredPermissions) {
      const decision = await this.dependencies.decidePermission(permission, descriptor, context, request);
      if (!decision.allowed) {
        await this.audit(descriptor, context, "DENIED", `Permission ${permission} denied: ${decision.reason}`);
        return denied(providerId, request.actionId, context.executionId, decision.reason);
      }
    }

    if (!descriptor.idempotent && descriptor.sideEffect !== "read" && !request.idempotencyKey) {
      const reason = "Non-idempotent write actions require an idempotency key.";
      await this.audit(descriptor, context, "DENIED", reason);
      return denied(providerId, request.actionId, context.executionId, reason);
    }
    let ledgerRecord = createPlannedActionRecord(descriptor, request, context.executionId, context.missionId);
    if (request.idempotencyKey) {
      const existing = await this.ledger.findByIdempotency(providerId, request.actionId, request.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== ledgerRecord.requestHash) {
          const reason = "Idempotency key was already used for a different action request.";
          await this.audit(descriptor, context, "DENIED", reason);
          return denied(providerId, request.actionId, context.executionId, reason);
        }
        const recovered = await this.recoverExisting(provider, descriptor, request, context, existing);
        if (recovered) return recovered;
        ledgerRecord = transitionActionRecord(existing, "PLANNED", { lastError: undefined, completedAt: undefined });
      }
    }
    await this.ledger.save(ledgerRecord);

    if (requiresApproval(descriptor)) {
      ledgerRecord = transitionActionRecord(ledgerRecord, "AWAITING_APPROVAL");
      await this.ledger.save(ledgerRecord);
      if (!this.dependencies.requestApproval) {
        const reason = "Action requires approval but no approver is configured.";
        await this.ledger.save(transitionActionRecord(ledgerRecord, "FAILED", { lastError: reason, completedAt: now() }));
        await this.audit(descriptor, context, "DENIED", reason);
        return denied(providerId, request.actionId, context.executionId, reason);
      }
      const approval = await this.dependencies.requestApproval(descriptor, request, context);
      if (!approval.approved) {
        await this.ledger.save(transitionActionRecord(ledgerRecord, "CANCELLED", { approvalId: approval.approvalId, lastError: approval.reason, completedAt: now() }));
        await this.audit(descriptor, context, "DENIED", `Approval denied by ${approval.actor}: ${approval.reason}`);
        return denied(providerId, request.actionId, context.executionId, approval.reason);
      }
      ledgerRecord = transitionActionRecord(ledgerRecord, "APPROVED", { approvalId: approval.approvalId });
      await this.ledger.save(ledgerRecord);
      await this.audit(descriptor, context, "APPROVED", `Approved by ${approval.actor}.`);
    }

    const controller = new AbortController();
    const signal = combineSignals(context.signal, controller.signal);
    const executionContext: ExecutionContextV1 = { ...context, signal };
    this.active.set(context.executionId, { provider, controller });
    ledgerRecord = transitionActionRecord(ledgerRecord, "EXECUTING", { startedAt: now() });
    await this.ledger.save(ledgerRecord);
    await this.audit(descriptor, context, "STARTED", request.dryRun ? "Dry-run started." : "Action execution started.");
    try {
      const authority = this.dependencies.revalidateAuthority?.(descriptor, context, request);
      if (authority && !authority.allowed) {
        await this.ledger.save(transitionActionRecord(ledgerRecord, "FAILED", { lastError: authority.reason, completedAt: now() }));
        await this.audit(descriptor, context, "DENIED", authority.reason);
        return denied(providerId, request.actionId, context.executionId, authority.reason);
      }
      const result = await withTimeout(provider.execute(request, executionContext), descriptor.timeoutMs, controller);
      if (result.providerId !== providerId || result.actionId !== request.actionId) throw new Error("Action provider returned mismatched identity metadata.");
      const evidence = evidenceFor(descriptor, context, result);
      await this.dependencies.recordEvidence?.(evidence);
      const normalized: ActionResultV1 = { ...result, evidenceIds: [...result.evidenceIds, evidence.id] };
      const finalState = normalized.status === "SUCCEEDED" ? "SUCCEEDED" : normalized.status === "CANCELLED" ? "CANCELLED" : "FAILED";
      await this.ledger.save(transitionActionRecord(ledgerRecord, finalState, {
        completedAt: now(),
        result: normalized,
        resultHash: hashActionResult(normalized),
        externalReference: externalReference(normalized),
      }));
      await this.audit(descriptor, context, normalized.status === "SUCCEEDED" ? "SUCCEEDED" : normalized.status === "CANCELLED" ? "CANCELLED" : "FAILED", `Action completed with status ${normalized.status}.`);
      return normalized;
    } catch (error) {
      const cancelled = signal.aborted;
      const ambiguous = descriptor.sideEffect !== "read";
      await this.ledger.save(transitionActionRecord(ledgerRecord, ambiguous ? "UNKNOWN_EXTERNAL_STATE" : cancelled ? "CANCELLED" : "FAILED", {
        completedAt: ambiguous ? undefined : now(),
        reconciliationState: ambiguous ? "REQUIRED" : undefined,
        lastError: safeError(error),
      }));
      await this.audit(descriptor, context, cancelled ? "CANCELLED" : "FAILED", safeError(error));
      return {
        executionId: context.executionId,
        providerId,
        actionId: request.actionId,
        status: cancelled ? "CANCELLED" : "FAILED",
        output: { error: safeError(error) },
        evidenceIds: [],
      };
    } finally {
      this.active.delete(context.executionId);
    }
  }

  private async recoverExisting(
    provider: ActionProviderV1,
    descriptor: ActionDescriptorV1,
    request: ActionRequestV1,
    context: ExecutionContextV1,
    existing: ActionExecutionRecord,
  ): Promise<ActionResultV1 | undefined> {
    if (existing.state === "SUCCEEDED" && existing.result) {
      await this.audit(descriptor, context, "SUCCEEDED", `Returned durable result from execution ${existing.executionId}.`);
      return existing.result;
    }
    if (!isAmbiguous(existing.state)) return undefined;
    if (!provider.reconcile) {
      const reason = `Action ${existing.executionId} has ambiguous external state and the provider cannot reconcile it.`;
      await this.ledger.save(transitionActionRecord(existing, "UNKNOWN_EXTERNAL_STATE", { reconciliationState: "BLOCKED_PROVIDER_UNSUPPORTED", lastError: reason }));
      await this.audit(descriptor, context, "FAILED", reason);
      return { executionId: existing.executionId, providerId: descriptor.providerId, actionId: descriptor.id, status: "FAILED", output: { error: reason }, evidenceIds: [] };
    }
    const reconciling = transitionActionRecord(existing, "RECONCILING", { reconciliationState: "IN_PROGRESS" });
    await this.ledger.save(reconciling);
    try {
      const authority = this.dependencies.revalidateAuthority?.(descriptor, context, request);
      if (authority && !authority.allowed) {
        await this.ledger.save(transitionActionRecord(reconciling, "UNKNOWN_EXTERNAL_STATE", { reconciliationState: "REQUIRED", lastError: authority.reason }));
        return denied(descriptor.providerId, descriptor.id, context.executionId, authority.reason);
      }
      const result = await provider.reconcile(request, { ...context, executionId: existing.executionId });
      if (result.status === "SUCCEEDED") {
        await this.ledger.save(transitionActionRecord(reconciling, "SUCCEEDED", {
          completedAt: now(), result, resultHash: hashActionResult(result), reconciliationState: "CONFIRMED_SUCCEEDED",
          externalReference: externalReference(result),
        }));
        return result;
      }
      await this.ledger.save(transitionActionRecord(reconciling, "FAILED", {
        completedAt: now(), result, resultHash: hashActionResult(result), reconciliationState: "CONFIRMED_NOT_SUCCEEDED",
      }));
      return result;
    } catch (error) {
      const reason = safeError(error);
      await this.ledger.save(transitionActionRecord(reconciling, "UNKNOWN_EXTERNAL_STATE", { reconciliationState: "FAILED", lastError: reason }));
      return { executionId: existing.executionId, providerId: descriptor.providerId, actionId: descriptor.id, status: "FAILED", output: { error: reason }, evidenceIds: [] };
    }
  }

  async cancel(executionId: string): Promise<void> {
    const active = this.active.get(executionId);
    if (!active) return;
    active.controller.abort(new Error("Action cancelled."));
    await active.provider.cancel?.(executionId);
  }

  private async audit(descriptor: ActionDescriptorV1, context: ExecutionContextV1, phase: ActionAuditEvent["phase"], message: string): Promise<void> {
    await this.dependencies.audit?.({
      id: createId("action-audit"),
      timestamp: now(),
      missionId: context.missionId,
      executionId: context.executionId,
      providerId: descriptor.providerId,
      actionId: descriptor.id,
      phase,
      riskClass: descriptor.riskClass,
      message,
    });
  }
}

function requiresApproval(descriptor: ActionDescriptorV1): boolean {
  if (descriptor.approval === "ALWAYS") return true;
  if (descriptor.approval === "NEVER") return false;
  return descriptor.riskClass !== "READ_ONLY" && descriptor.riskClass !== "LOW_RISK_WRITE";
}

function denied(providerId: string, actionId: string, executionId: string, reason: string): ActionResultV1 {
  return { executionId, providerId, actionId, status: "DENIED", output: { reason }, evidenceIds: [] };
}

function evidenceFor(descriptor: ActionDescriptorV1, context: ExecutionContextV1, result: ActionResultV1): EvidenceRecordV1 {
  return {
    contractVersion: QUACK_CONTRACT_VERSION,
    id: createId("evidence"),
    missionId: context.missionId,
    taskId: context.taskId,
    executionId: context.executionId,
    kind: "action",
    createdAt: now(),
    source: `${descriptor.providerId}:${descriptor.id}`,
    data: {
      status: result.status,
      output: result.output ?? null,
      dryRunSupported: descriptor.supportsDryRun,
      // Governed dispatch materialization (ADR 0036): the evidence cites the
      // operation identity, retry safety, and required permissions of the
      // executed provider operation so verification can attribute the effect.
      operationId: result.executionId,
      retrySafety: descriptor.sideEffect === "read" ? "READ_ONLY" as const
        : descriptor.sideEffect === "destructive" ? "DESTRUCTIVE" as const
        : descriptor.idempotent ? "IDEMPOTENT_WRITE" as const : "NON_IDEMPOTENT_WRITE" as const,
      requiredPermissions: [...descriptor.requiredPermissions],
      providerVersion: descriptor.contractVersion,
      namespace: descriptor.providerId,
    },
    redactions: [],
  };
}

/** Bounded JSON-schema subset used before any provider side effect occurs. */
export function validateJsonSchema(input: JsonObject, schema: JsonObject): string | undefined {
  if (schema["type"] !== undefined && schema["type"] !== "object") return "Action input schema root must be type object.";
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === "string" && input[key] === undefined) return `Required action input property ${key} is missing.`;
    }
  }
  const properties = schema["properties"];
  if (!isJsonObject(properties)) return undefined;
  for (const [key, value] of Object.entries(input)) {
    const property = properties[key];
    if (property === undefined && schema["additionalProperties"] === false) return `Unexpected action input property ${key}.`;
    if (!isJsonObject(property)) continue;
    const expected = property["type"];
    if (typeof expected === "string" && !matchesJsonType(value, expected)) return `Action input property ${key} must be ${expected}.`;
  }
  return undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function matchesJsonType(value: unknown, expected: string): boolean {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (expected === "integer") return typeof value === "number" && Number.isInteger(value);
  if (expected === "number") return typeof value === "number";
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function combineSignals(parent: AbortSignal | undefined, local: AbortSignal): AbortSignal {
  if (!parent) return local;
  return AbortSignal.any([parent, local]);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`Action timed out after ${timeoutMs}ms.`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(bearer|api[_-]?key|token|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function externalReference(result: ActionResultV1): string | undefined {
  const value = result.output?.["externalReference"] ?? result.output?.["id"];
  return typeof value === "string" ? value.slice(0, 500) : undefined;
}
