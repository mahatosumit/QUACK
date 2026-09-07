import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicWriteFile, isMissingFile } from "../core/utils.js";
import { createId, now, type IsoTimestamp, type JsonObject, type QuackResult, ok, fail } from "../core/types.js";

export type MemoryItemType = "mission.short_term" | "knowledge.long_term" | "skill.execution" | "user.preference";
export type MemoryOperation = "read" | "write";

export interface MemoryAccessPolicy {
  readonly visibility: "private" | "mission" | "global";
  readonly allowedMissionIds?: readonly string[];
  readonly allowedAgents?: readonly string[];
  readonly requiredCapabilities?: readonly string[];
}

export interface MemoryItem {
  readonly id: string;
  readonly type: MemoryItemType;
  readonly source: string;
  readonly timestamp: IsoTimestamp;
  readonly confidence: number;
  readonly accessPolicy: MemoryAccessPolicy;
  readonly relatedMission?: string;
  readonly content: string;
  readonly metadata: JsonObject;
}

export interface MemoryAccessContext {
  readonly actor: string;
  readonly missionId?: string;
  readonly agentId?: string;
  readonly capabilities?: readonly string[];
}

export interface MemoryStoreInput {
  readonly type: MemoryItemType;
  readonly source: string;
  readonly confidence: number;
  readonly accessPolicy: MemoryAccessPolicy;
  readonly relatedMission?: string;
  readonly content: string;
  readonly metadata?: JsonObject;
}

export interface MemoryQuery {
  readonly type?: MemoryItemType;
  readonly text?: string;
  readonly missionId?: string;
  readonly limit?: number;
}

export interface MemoryStorageAdapter {
  save(item: MemoryItem): Promise<void>;
  list(): Promise<MemoryItem[]>;
}

export class InMemoryStorageAdapter implements MemoryStorageAdapter {
  private readonly items: MemoryItem[] = [];

  async save(item: MemoryItem): Promise<void> {
    this.items.push(clone(item));
  }

  async list(): Promise<MemoryItem[]> {
    return this.items.map(clone);
  }
}

export class JsonFileMemoryStorageAdapter implements MemoryStorageAdapter {
  private loaded = false;
  private readonly items: MemoryItem[] = [];

  constructor(private readonly filePath: string) {}

  async save(item: MemoryItem): Promise<void> {
    await this.ensureLoaded();
    this.items.push(clone(item));
    await mkdir(dirname(this.filePath), { recursive: true });
    await atomicWriteFile(this.filePath, JSON.stringify({ version: 1, items: this.items }, null, 2));
  }

  async list(): Promise<MemoryItem[]> {
    await this.ensureLoaded();
    return this.items.map(clone);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as { readonly items?: readonly MemoryItem[] };
      for (const item of parsed.items ?? []) {
        if (isMemoryItem(item)) this.items.push(clone(item));
      }
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }
}

export class MemoryPolicy {
  canAccess(item: MemoryItem | MemoryStoreInput, context: MemoryAccessContext, operation: MemoryOperation): QuackResult<void> {
    const policy = item.accessPolicy;
    if (policy.allowedAgents && context.agentId && !policy.allowedAgents.includes(context.agentId)) {
      return deny(`Agent ${context.agentId} is not allowed to ${operation} this memory item.`);
    }
    if (policy.allowedAgents && !context.agentId) {
      return deny(`Agent identity is required to ${operation} this memory item.`);
    }
    if (policy.requiredCapabilities?.length) {
      const available = new Set(context.capabilities ?? []);
      const missing = policy.requiredCapabilities.find((capability) => !available.has(capability));
      if (missing) return deny(`Missing memory capability ${missing}.`);
    }
    if (policy.visibility === "private") {
      if (!item.relatedMission || context.missionId !== item.relatedMission) {
        return deny("Private memory is only available to its related mission.");
      }
    }
    if (policy.visibility === "mission") {
      const allowedMissionIds = policy.allowedMissionIds ?? (item.relatedMission ? [item.relatedMission] : []);
      if (allowedMissionIds.length > 0 && (!context.missionId || !allowedMissionIds.includes(context.missionId))) {
        return deny("Mission memory access is isolated to allowed missions.");
      }
    }
    return ok(undefined);
  }
}

export class RetrievalEngine {
  constructor(
    private readonly storage: MemoryStorageAdapter,
    private readonly policy: MemoryPolicy,
  ) {}

  async retrieve(query: MemoryQuery, context: MemoryAccessContext): Promise<MemoryItem[]> {
    const normalized = query.text?.toLowerCase();
    const items = await this.storage.list();
    const matches = items
      .filter((item) => query.type ? item.type === query.type : true)
      .filter((item) => query.missionId ? item.relatedMission === query.missionId : true)
      .filter((item) => normalized ? item.content.toLowerCase().includes(normalized) : true)
      .filter((item) => this.policy.canAccess(item, context, "read").ok)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return matches.slice(0, query.limit ?? 20);
  }
}

export class MemoryManager {
  readonly retrieval: RetrievalEngine;

  constructor(
    private readonly storage: MemoryStorageAdapter,
    private readonly policy = new MemoryPolicy(),
  ) {
    this.retrieval = new RetrievalEngine(storage, policy);
  }

  async store(input: MemoryStoreInput, context: MemoryAccessContext): Promise<QuackResult<MemoryItem>> {
    const decision = this.policy.canAccess(input, context, "write");
    if (!decision.ok) return decision;
    const item: MemoryItem = {
      id: createId("mem"),
      type: input.type,
      source: input.source,
      timestamp: now(),
      confidence: clampConfidence(input.confidence),
      accessPolicy: clone(input.accessPolicy),
      relatedMission: input.relatedMission,
      content: input.content,
      metadata: input.metadata ?? {},
    };
    await this.storage.save(item);
    return ok(item);
  }

  retrieve(query: MemoryQuery, context: MemoryAccessContext): Promise<MemoryItem[]> {
    return this.retrieval.retrieve(query, context);
  }
}

export function createMemoryManager(filePath?: string): MemoryManager {
  return new MemoryManager(filePath ? new JsonFileMemoryStorageAdapter(filePath) : new InMemoryStorageAdapter());
}

function deny(message: string): QuackResult<void> {
  return fail({
    code: "memory.access_denied",
    message,
    category: "permission",
    recoverable: true,
  });
}

function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(1, confidence));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMemoryItem(value: unknown): value is MemoryItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item["id"] === "string" &&
    typeof item["type"] === "string" &&
    typeof item["source"] === "string" &&
    typeof item["timestamp"] === "string" &&
    typeof item["confidence"] === "number" &&
    typeof item["content"] === "string" &&
    typeof item["accessPolicy"] === "object" &&
    item["accessPolicy"] !== null;
}
