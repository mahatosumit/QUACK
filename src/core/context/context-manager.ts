import { createId, now, type JsonObject } from "../types.js";
import { type ContextBundle, type ContextProvider, type UserIdentity, type ProjectState, type PreviousDecision } from "./types.js";
import { type IdentityLoader } from "./identity-loader.js";

/**
 * ContextManager — assembles and caches the active context bundle, supports
 * attention stacks, and exposes providers. Additive layer over existing memory.
 */
export class ContextManagerNew {
  private bundle?: ContextBundle;
  private attentionStack: string[] = [];
  private readonly providers = new Map<string, ContextProvider>();

  constructor(
    private readonly identityLoader: IdentityLoader,
    private readonly decisions: PreviousDecision[] = [],
    private readonly goals: string[] = [],
  ) {}

  registerProvider(id: string, provider: ContextProvider): void {
    this.providers.set(id, provider);
  }

  unregisterProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  async build(): Promise<ContextBundle> {
    const identity = await this.identityLoader.load();
    let project: ProjectState | undefined;
    for (const [id, provider] of this.providers) {
      if (id === "project") {
        const ctx = await provider.load();
        project = ctx as unknown as ProjectState;
      }
    }
    const extra: JsonObject = {};
    for (const [id, provider] of this.providers) {
      if (id === "project") continue;
      const slice = await provider.load();
      if (slice) Object.assign(extra, slice);
    }

    this.bundle = {
      id: createId("ctx"),
      identity,
      project,
      previousDecisions: [...this.decisions].slice(-20),
      activeGoals: [...this.goals],
      preferences: identity.preferences,
      createdAt: now(),
      source: "resume",
      metadata: extra,
    };
    return this.bundle;
  }

  get(): ContextBundle | undefined {
    return this.bundle;
  }

  setAttention(goalId: string): void {
    if (!this.attentionStack.includes(goalId)) this.attentionStack.push(goalId);
    if (this.attentionStack.length > 10) this.attentionStack.shift();
  }

  getAttention(): readonly string[] {
    return [...this.attentionStack];
  }

  clearAttention(): void {
    this.attentionStack = [];
  }

  clear(): void {
    this.bundle = undefined;
    this.attentionStack = [];
  }

  addDecision(decision: PreviousDecision): void {
    this.decisions.push(decision);
  }
}
