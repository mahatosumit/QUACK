import { isMissingFile } from "../core/utils.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  constructor(private readonly filePath: string) {}

  async append(event: QuackEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const existing = await this.readRaw();
    const next = `${existing}${JSON.stringify(event)}\n`;
    await writeFile(this.filePath, next, "utf8");
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


