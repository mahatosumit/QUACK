import { createId, now } from "../../core/types.js";
import { type AgentInstance, type AgentMessage, type AgentRole } from "../types.js";
import { type AgentCommunicationBus } from "../communication.js";

export interface AgentExecutionResult {
  status: "completed" | "failed";
  output: unknown;
  durationMs: number;
  error?: string;
  metrics?: Record<string, unknown>;
}

export abstract class BaseAgent {
  readonly id: string;
  readonly role: AgentRole;
  protected instance: AgentInstance;
  protected unsubscribe: (() => void) | null = null;

  constructor(
    instance: AgentInstance,
    protected readonly comms: AgentCommunicationBus,
  ) {
    this.instance = instance;
    this.id = instance.id;
    this.role = instance.role;
  }

  start(): void {
    this.unsubscribe = this.comms.subscribe(this.id, (msg) => {
      if (msg.type === "delegate" || msg.type === "request") {
        this.handleMessage(msg).catch((err) => {
          console.error(`[Agent ${this.role}] Failed to handle message:`, err);
        });
      }
    });
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  async execute(goal: string, context?: Record<string, unknown>): Promise<AgentExecutionResult> {
    const start = Date.now();
    try {
      const output = await this.run(goal, context ?? {});
      return {
        status: "completed",
        output,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: "failed",
        output: null,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  communicate(msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
    return this.comms.send(msg);
  }

  protected abstract run(goal: string, context: Record<string, unknown>): Promise<unknown>;

  private async handleMessage(msg: AgentMessage): Promise<void> {
    const payload = (msg.payload ?? {}) as Record<string, unknown>;
    const goal = (payload.goal as string) ?? msg.metadata?.topic ?? "unknown";
    const result = await this.execute(goal, payload.context as Record<string, unknown> | undefined);

    if (msg.type === "delegate") {
      this.comms.reply(msg, this.id, {
        taskId: payload.taskId,
        status: result.status,
        output: result.output,
        error: result.error,
        durationMs: result.durationMs,
      });
    } else if (msg.type === "request") {
      this.comms.reply(msg, this.id, {
        status: result.status,
        output: result.output,
        error: result.error,
      });
    }
  }
}
