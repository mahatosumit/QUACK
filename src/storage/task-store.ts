import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Task } from "../runtime/task.js";

export interface TaskStore {
  save(task: Task): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  list(): Promise<Task[]>;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();

  async save(task: Task): Promise<Task> {
    const snapshot = structuredClone(task);
    this.tasks.set(snapshot.id, snapshot);
    return structuredClone(snapshot);
  }

  async get(id: string): Promise<Task | undefined> {
    return structuredClone(this.tasks.get(id));
  }

  async list(): Promise<Task[]> {
    return structuredClone([...this.tasks.values()]);
  }
}

export class JsonFileTaskStore implements TaskStore {
  private loadPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private tasks = new Map<string, Task>();

  constructor(private readonly filePath: string) {}

  async save(task: Task): Promise<Task> {
    const snapshot = structuredClone(task);
    const operation = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      const next = new Map(this.tasks);
      next.set(snapshot.id, snapshot);
      await this.flush(next);
      this.tasks = next;
      return structuredClone(snapshot);
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async get(id: string): Promise<Task | undefined> {
    await this.ensureLoaded();
    return structuredClone(this.tasks.get(id));
  }

  async list(): Promise<Task[]> {
    await this.ensureLoaded();
    return structuredClone([...this.tasks.values()]);
  }

  private ensureLoaded(): Promise<void> {
    return this.loadPromise ??= this.load();
  }

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || (parsed.version !== undefined && parsed.version !== 1) || !Array.isArray(parsed.tasks)) {
      throw new Error("Invalid task store envelope or unsupported version");
    }
    const tasks = new Map<string, Task>();
    for (const task of parsed.tasks) {
      if (!isTask(task) || tasks.has(task.id)) throw new Error("Invalid or duplicate persisted task");
      tasks.set(task.id, task);
    }
    this.tasks = tasks;
  }

  private async flush(tasks: Map<string, Task>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await atomicWriteFile(this.filePath, JSON.stringify({ version: 1, tasks: [...tasks.values()] }, null, 2));
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTask(value: unknown): value is Task {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0
    && typeof value.goal === "string"
    && typeof value.status === "string" && ["created", "planned", "running", "completed", "failed"].includes(value.status)
    && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
    && Array.isArray(value.plan) && value.plan.every((step: unknown) => isRecord(step)
      && typeof step.id === "string" && typeof step.title === "string"
      && typeof step.status === "string" && ["pending", "running", "completed", "failed"].includes(step.status))
    && (value.result === undefined || isRecord(value.result))
    && (value.error === undefined || isRecord(value.error))
    && (value.origin === undefined || (typeof value.origin === "string"
      && ["user", "cli", "api", "sdk", "desktop", "improvement", "system"].includes(value.origin)));
}
