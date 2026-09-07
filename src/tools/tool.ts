import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
import { type Permission } from "../security/permissions.js";

export interface ToolMetadata {
  readonly retrySafety?: import("../engine/execution-recovery.js").RetrySafety;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
}

export interface ToolExecutionContext {
  readonly idempotencyKey?: string;
  readonly attemptId?: string;
  readonly signal?: AbortSignal;
  readonly deadline?: string;
  readonly taskId: string;
  readonly actor: string;
}

export interface ToolInvocation {
  readonly toolId: string;
  readonly input: JsonObject;
  readonly reason?: string;
}

export interface ToolInvocationExecutionContext extends ToolExecutionContext {
  readonly invocationIndex?: number;
  readonly nodeId?: string;
  readonly sessionId?: string;
}

export interface ToolInvocationOutcome {
  readonly toolId: string;
  readonly success: boolean;
  readonly output?: JsonObject;
  readonly error?: string;
}

export type ToolInvocationExecutor = (
  invocation: ToolInvocation,
  context: ToolInvocationExecutionContext,
) => Promise<ToolInvocationOutcome>;

export interface ToolResult<TOutput extends object = object> {
  readonly output: TOutput;
  readonly metrics?: JsonObject;
}

/**
 * A QUACK tool. TInput and TOutput are constrained to `object` rather than
 * `JsonObject` so that named interfaces (which do not carry an index
 * signature) can be used as the input/output types. The runtime serializes
 * tool I/O at the event-bus boundary; tool implementations are responsible
 * for ensuring their I/O is JSON-serializable.
 */
export interface QuackTool<TInput extends object = object, TOutput extends object = object> {
  readonly id: string;
  describe(): ToolMetadata;
  validateInput?(input: unknown): QuackResult<TInput>;
  execute(input: TInput, context: ToolExecutionContext): Promise<ToolResult<TOutput>>;
}

export function validateToolInput(tool: QuackTool, input: unknown): QuackResult<object> {
  if (!isObject(input)) {
    return fail({
      code: "tool.invalid_input",
      message: `Tool ${tool.id} input must be an object.`,
      category: "tool",
      recoverable: true,
      context: { toolId: tool.id },
    });
  }

  if (!tool.validateInput) {
    return ok(input);
  }

  return tool.validateInput(input) as QuackResult<object>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, QuackTool>();

  register(tool: QuackTool): QuackResult<ToolMetadata> {
    if (this.tools.has(tool.id)) {
      return fail({
        code: "tool.duplicate",
        message: `Tool ${tool.id} is already registered.`,
        category: "tool",
        recoverable: true,
      });
    }

    this.tools.set(tool.id, tool);
    return ok(tool.describe());
  }

  get(id: string): QuackResult<QuackTool> {
    const tool = this.tools.get(id);
    if (!tool) {
      return fail({
        code: "tool.not_found",
        message: `Tool ${id} is not registered.`,
        category: "tool",
        recoverable: true,
      });
    }

    return ok(tool);
  }

  list(): ToolMetadata[] {
    return [...this.tools.values()].map((tool) => tool.describe());
  }
}

export class EchoTool implements QuackTool<{ readonly message: string }, { readonly message: string }> {
  readonly id = "core.echo";

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Echo",
      description: "Returns the provided message. Useful for runtime smoke tests.",
      permissions: [],
    };
  }

  validateInput(input: unknown): QuackResult<{ readonly message: string }> {
    if (!isObject(input) || typeof input["message"] !== "string") {
      return fail({
        code: "tool.invalid_input",
        message: "Echo tool requires string input.message.",
        category: "tool",
        recoverable: true,
        context: { toolId: this.id },
      });
    }
    return ok({ message: input["message"] });
  }

  async execute(
    input: { readonly message: string },
    _context: ToolExecutionContext,
  ): Promise<ToolResult<{ readonly message: string }>> {
    return { output: { message: input.message } };
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
