import { createId, now, type JsonObject } from "../core/types.js";
import { type Checkpoint, type CheckpointStore, type WorkflowState, type TaskNodeResult, type JournalEntry } from "./types.js";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.id, structuredClone(checkpoint));
  }

  async load(id: string): Promise<Checkpoint | undefined> {
    return structuredClone(this.checkpoints.get(id));
  }

  async list(workflowId: string): Promise<Checkpoint[]> {
    return structuredClone([...this.checkpoints.values()])
      .filter((c) => c.workflowId === workflowId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async delete(id: string): Promise<boolean> {
    return this.checkpoints.delete(id);
  }

  async prune(workflowId: string, keep: number): Promise<number> {
    validateKeep(keep);
    const all = await this.list(workflowId);
    if (all.length <= keep) return 0;
    const toRemove = all.slice(0, all.length - keep);
    for (const c of toRemove) this.checkpoints.delete(c.id);
    return toRemove.length;
  }
}

export class JsonFileCheckpointStore implements CheckpointStore {
  private loadPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private checkpoints = new Map<string, Checkpoint>();

  constructor(private readonly filePath: string) {}

  async save(checkpoint: Checkpoint): Promise<void> {
    const snapshot = structuredClone(checkpoint);
    await this.mutate((next) => { next.set(snapshot.id, snapshot); });
  }

  async load(id: string): Promise<Checkpoint | undefined> {
    await this.ensureLoaded();
    return structuredClone(this.checkpoints.get(id));
  }

  async list(workflowId: string): Promise<Checkpoint[]> {
    await this.ensureLoaded();
    return structuredClone([...this.checkpoints.values()]
      .filter((c) => c.workflowId === workflowId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate((next) => next.delete(id));
  }

  async prune(workflowId: string, keep: number): Promise<number> {
    validateKeep(keep);
    return this.mutate((next) => {
      const all = [...next.values()].filter((c) => c.workflowId === workflowId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const toRemove = all.slice(0, Math.max(0, all.length - keep));
      for (const checkpoint of toRemove) next.delete(checkpoint.id);
      return toRemove.length;
    });
  }

  private mutate<T>(update: (next: Map<string, Checkpoint>) => T): Promise<T> {
    const operation = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      const next = new Map(this.checkpoints);
      const result = update(next);
      if (next.size === this.checkpoints.size && [...next].every(([id, checkpoint]) => this.checkpoints.get(id) === checkpoint)) return result;
      await mkdir(dirname(this.filePath), { recursive: true });
      await atomicWriteFile(this.filePath, JSON.stringify({ version: 1, checkpoints: [...next.values()] }, null, 2));
      this.checkpoints = next;
      return result;
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private ensureLoaded(): Promise<void> {
    return this.loadPromise ??= this.read();
  }

  private async read(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || (parsed.version !== undefined && parsed.version !== 1) || !Array.isArray(parsed.checkpoints)) {
      throw new Error("Invalid checkpoint store envelope or unsupported version");
    }
    const next = new Map<string, Checkpoint>();
    for (const checkpoint of parsed.checkpoints) {
      if (!isCheckpoint(checkpoint) || next.has(checkpoint.id)) throw new Error("Invalid or duplicate persisted checkpoint");
      next.set(checkpoint.id, checkpoint);
    }
    this.checkpoints = next;
  }
}

function validateKeep(keep: number): void {
  if (!Number.isInteger(keep) || keep < 0) throw new Error("Checkpoint retention must be a non-negative integer");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDate(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isResult(value: unknown): boolean {
  return isRecord(value) && typeof value.success === "boolean" && isStrings(value.toolCalls)
    && typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0
    && (value.error === undefined || typeof value.error === "string")
    && (value.output === undefined || isRecord(value.output));
}

const nodeStatuses = ["pending", "ready", "running", "completed", "failed", "skipped", "cancelled", "paused", "retrying"];

function isCheckpoint(value: unknown): value is Checkpoint {
  if (!isRecord(value) || ![value.id, value.workflowId, value.sessionId, value.planId].every((id) => typeof id === "string" && id.length > 0)
    || !isDate(value.timestamp) || !isRecord(value.metadata) || !isRecord(value.nodeResults)
    || !Object.values(value.nodeResults).every(isResult) || !Array.isArray(value.journalSinceLastCheckpoint)
    || !value.journalSinceLastCheckpoint.every((entry: unknown) => isRecord(entry)
      && [entry.id, entry.workflowId, entry.sessionId, entry.type].every((field) => typeof field === "string")
      && isDate(entry.timestamp) && isRecord(entry.data))
    || (value.memorySnapshot !== undefined && !isRecord(value.memorySnapshot))) return false;
  const state = value.workflowState;
  if (!isRecord(state) || state.workflowId !== value.workflowId || state.sessionId !== value.sessionId || state.planId !== value.planId
    || typeof state.status !== "string" || !["created", "running", "paused", "completed", "failed", "cancelled", "partially_completed"].includes(state.status)
    || !isRecord(state.nodeStates) || !Object.values(state.nodeStates).every((status) => typeof status === "string" && nodeStatuses.includes(status))
    || !isRecord(state.nodeResults) || !Object.values(state.nodeResults).every(isResult)
    || ![state.readyQueue, state.runningNodes, state.completedNodes, state.failedNodes, state.skippedNodes, state.errors].every(isStrings)
    || typeof state.progress !== "number" || !Number.isFinite(state.progress)) return false;
  const graph = state.taskGraph;
  return isRecord(graph) && typeof graph.id === "string" && typeof graph.description === "string"
    && isDate(graph.createdAt) && isDate(graph.updatedAt) && isRecord(graph.metadata)
    && Array.isArray(graph.edges) && graph.edges.every((edge: unknown) => isRecord(edge) && typeof edge.from === "string" && typeof edge.to === "string")
    && Array.isArray(graph.nodes) && graph.nodes.every((node: unknown) => isRecord(node)
      && typeof node.id === "string" && typeof node.description === "string" && isStrings(node.dependencies)
      && isStrings(node.requiredTools) && typeof node.status === "string" && nodeStatuses.includes(node.status)
      && typeof node.priority === "string" && ["critical", "high", "medium", "low"].includes(node.priority)
      && [node.estimatedCost, node.estimatedDurationMs, node.timeoutMs, node.retryCount].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
      && isRecord(node.retryPolicy) && typeof node.retryPolicy.backoff === "string"
      && ["fixed", "linear", "exponential", "jitter"].includes(node.retryPolicy.backoff)
      && [node.retryPolicy.maxRetries, node.retryPolicy.baseDelayMs, node.retryPolicy.maxDelayMs].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0));
}
export class CheckpointManager {
  private checkpointCount = 0;

  constructor(
    private readonly store: CheckpointStore,
    private readonly maxCheckpointsPerWorkflow: number = 10,
  ) {}

  async create(
    workflowId: string,
    sessionId: string,
    planId: string,
    workflowState: WorkflowState,
    nodeResults: Record<string, TaskNodeResult>,
    journalSinceLastCheckpoint: JournalEntry[],
    memorySnapshot?: JsonObject,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: createId("ckpt"),
      workflowId,
      sessionId,
      planId,
      timestamp: now(),
      workflowState,
      nodeResults,
      journalSinceLastCheckpoint,
      memorySnapshot,
      metadata: { index: ++this.checkpointCount },
    };

    await this.store.save(checkpoint);
    await this.store.prune(workflowId, this.maxCheckpointsPerWorkflow);
    return checkpoint;
  }

  async restore(checkpointId: string): Promise<Checkpoint | undefined> {
    return this.store.load(checkpointId);
  }

  async list(workflowId: string): Promise<Checkpoint[]> {
    return this.store.list(workflowId);
  }

  async getLatest(workflowId: string): Promise<Checkpoint | undefined> {
    const all = await this.list(workflowId);
    return all.length > 0 ? all[all.length - 1] : undefined;
  }
}

