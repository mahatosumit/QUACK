import { createQuackSystem, type QuackSystem, type Task, type QuackConfig } from "@quack/os";

export type QuackClientConfig = Partial<QuackConfig>;

export class QuackClient {
  private system: QuackSystem | null = null;

  async initialize(config?: QuackClientConfig): Promise<void> {
    if (this.system) throw new Error("Client already initialized. Call shutdown() first.");
    this.system = createQuackSystem(config);
  }

  async submitGoal(goal: string): Promise<Task> {
    if (!this.system) throw new Error("Client not initialized. Call initialize() first.");
    const result = await this.system.runtime.submitGoal(goal, "sdk");
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.data;
  }

  getSystem(): QuackSystem {
    if (!this.system) throw new Error("Client not initialized. Call initialize() first.");
    return this.system;
  }

  async shutdown(): Promise<void> {
    await this.system?.runtime.shutdown();
    this.system = null;
  }
}
