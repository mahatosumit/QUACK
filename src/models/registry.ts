import { fail, ok, type QuackResult } from "../core/types.js";
import type { ModelCapability, ModelInfo } from "./types.js";

export class ModelRegistry {
  private readonly models = new Map<string, ModelInfo>();

  register(info: ModelInfo): QuackResult<string> {
    if (this.models.has(info.id)) {
      return fail({
        code: "model.duplicate",
        message: `Model ${info.id} is already registered.`,
        category: "runtime",
        recoverable: true,
      });
    }

    this.models.set(info.id, info);
    return ok(info.id);
  }

  get(id: string): QuackResult<ModelInfo> {
    const model = this.models.get(id);
    if (!model) {
      return fail({
        code: "model.not_found",
        message: `Model ${id} is not registered.`,
        category: "runtime",
        recoverable: true,
      });
    }

    return ok(model);
  }

  getAll(): ModelInfo[] {
    return [...this.models.values()];
  }

  findByCapability(capability: ModelCapability): ModelInfo[] {
    return [...this.models.values()].filter((m) =>
      m.capabilities.includes(capability),
    );
  }

  findByProvider(provider: string): ModelInfo[] {
    return [...this.models.values()].filter((m) => m.provider === provider);
  }

  remove(id: string): QuackResult<void> {
    if (!this.models.has(id)) {
      return fail({
        code: "model.not_found",
        message: `Model ${id} is not registered.`,
        category: "runtime",
        recoverable: true,
      });
    }

    this.models.delete(id);
    return ok(undefined);
  }

  updateStatus(
    id: string,
    status: ModelInfo["status"],
  ): QuackResult<void> {
    const model = this.models.get(id);
    if (!model) {
      return fail({
        code: "model.not_found",
        message: `Model ${id} is not registered.`,
        category: "runtime",
        recoverable: true,
      });
    }

    this.models.set(id, { ...model, status });
    return ok(undefined);
  }

  get count(): number {
    return this.models.size;
  }
}
