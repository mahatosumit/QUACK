import { atomicWriteFile, isMissingFile } from "../core/utils.js";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type QuackEvent } from "../events/event-bus.js";

export interface AuditLog {
  append(event: QuackEvent): Promise<void>;
  readAll(): Promise<QuackEvent[]>;
}

export class InMemoryAuditLog implements AuditLog {
  private readonly events: QuackEvent[] = [];

  async append(event: QuackEvent): Promise<void> {
    this.events.push(event);
  }

  async readAll(): Promise<QuackEvent[]> {
    return [...this.events];
  }
}

export class JsonlAuditLog implements AuditLog {
  // ponytail: single-process write chain; concurrent appends interleave
  // read-modify-write and silently drop events (fire-and-forget emits race).
  // Cross-process audit lives in the sqlite ledger.
  private appendQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  append(event: QuackEvent): Promise<void> {
    const operation = this.appendQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const existing = await this.readRaw();
      const next = `${existing}${JSON.stringify(event)}\n`;
      await atomicWriteFile(this.filePath, next);
    });
    this.appendQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async readAll(): Promise<QuackEvent[]> {
    const raw = await this.readRaw();
    const events: QuackEvent[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as QuackEvent);
      } catch {
        // skip malformed lines
      }
    }
    return events;
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return "";
      throw error;
    }
  }
}


