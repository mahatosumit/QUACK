import { createHash } from "node:crypto";
import { now, type IsoTimestamp, type JsonObject, type JsonValue } from "../core/types.js";
import type { ActionDescriptorV1, ActionRequestV1, ActionResultV1 } from "../contracts/index.js";

export type ActionExecutionState =
  | "PLANNED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN_EXTERNAL_STATE"
  | "RECONCILING"
  | "CANCELLED";

export interface ActionExecutionRecord {
  readonly executionId: string;
  readonly missionId: string;
  readonly actionProvider: string;
  readonly actionName: string;
  readonly idempotencyKey?: string;
  readonly requestHash: string;
  readonly riskLevel: ActionDescriptorV1["riskClass"];
  readonly approvalId?: string;
  readonly state: ActionExecutionState;
  readonly startedAt?: IsoTimestamp;
  readonly completedAt?: IsoTimestamp;
  readonly externalReference?: string;
  readonly resultHash?: string;
  readonly reconciliationState?: string;
  readonly lastError?: string;
  readonly result?: ActionResultV1;
  readonly updatedAt: IsoTimestamp;
}

export interface ActionExecutionLedger {
  save(record: ActionExecutionRecord): Promise<ActionExecutionRecord>;
  get(executionId: string): Promise<ActionExecutionRecord | undefined>;
  findByIdempotency(providerId: string, actionId: string, idempotencyKey: string): Promise<ActionExecutionRecord | undefined>;
  list(limit?: number): Promise<readonly ActionExecutionRecord[]>;
  listAmbiguous(): Promise<readonly ActionExecutionRecord[]>;
}

export class InMemoryActionExecutionLedger implements ActionExecutionLedger {
  private readonly records = new Map<string, ActionExecutionRecord>();

  async save(record: ActionExecutionRecord): Promise<ActionExecutionRecord> {
    const stored = clone(record);
    this.records.set(record.executionId, stored);
    return clone(stored);
  }

  async get(executionId: string): Promise<ActionExecutionRecord | undefined> {
    const record = this.records.get(executionId);
    return record ? clone(record) : undefined;
  }

  async findByIdempotency(providerId: string, actionId: string, idempotencyKey: string): Promise<ActionExecutionRecord | undefined> {
    const match = [...this.records.values()].find((record) =>
      record.actionProvider === providerId && record.actionName === actionId && record.idempotencyKey === idempotencyKey);
    return match ? clone(match) : undefined;
  }

  async listAmbiguous(): Promise<readonly ActionExecutionRecord[]> {
    return [...this.records.values()].filter((record) => isAmbiguous(record.state)).map(clone);
  }

  async list(limit = 100): Promise<readonly ActionExecutionRecord[]> {
    return [...this.records.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(clone);
  }
}

export function createPlannedActionRecord(
  descriptor: ActionDescriptorV1,
  request: ActionRequestV1,
  executionId: string,
  missionId: string,
): ActionExecutionRecord {
  return {
    executionId,
    missionId,
    actionProvider: descriptor.providerId,
    actionName: descriptor.id,
    idempotencyKey: request.idempotencyKey,
    requestHash: hashJson({ actionId: request.actionId, input: request.input, dryRun: request.dryRun ?? false }),
    riskLevel: descriptor.riskClass,
    state: "PLANNED",
    updatedAt: now(),
  };
}

export function transitionActionRecord(
  record: ActionExecutionRecord,
  state: ActionExecutionState,
  changes: Partial<Omit<ActionExecutionRecord, "executionId" | "state" | "updatedAt">> = {},
): ActionExecutionRecord {
  return { ...record, ...changes, state, updatedAt: now() };
}

export function hashActionResult(result: ActionResultV1): string { return hashJson(result as unknown as JsonValue); }
export function isAmbiguous(state: ActionExecutionState): boolean {
  return state === "EXECUTING" || state === "UNKNOWN_EXTERNAL_STATE" || state === "RECONCILING";
}

function hashJson(value: JsonValue): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key]!)}`).join(",")}}`;
  return JSON.stringify(value);
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
