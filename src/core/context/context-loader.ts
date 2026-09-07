import { createId, now, type JsonObject } from "../types.js";
import { type ContextProvider, type ContextBundle, type PreviousDecision } from "./types.js";
import { IdentityLoader } from "./identity-loader.js";
import { ProjectLoader } from "./project-loader.js";

/**
 * Context Bootloader — loads user identity, project state, previous decisions,
 * and preferences before the ExecutiveBrain executes a task. Additive layer;
 * never modifies existing memory or core systems. Can be disabled via config.
 */
export class ContextLoader {
  private readonly providers: ContextProvider[] = [];
  private cachedBundle?: ContextBundle;

  constructor(
    private readonly identityLoader: IdentityLoader,
    private readonly projectLoader: ProjectLoader,
    private readonly previousDecisions: PreviousDecision[] = [],
    private readonly activeGoals: string[] = [],
    private readonly enabled: boolean = true,
  ) {}

  static create(config: { workspaceRoot?: string; dataDir?: string; enabled?: boolean }, decisions: PreviousDecision[] = [], goals: string[] = []): ContextLoader {
    return new ContextLoader(
      new IdentityLoader(config.dataDir),
      new ProjectLoader(config.workspaceRoot),
      decisions,
      goals,
      config.enabled ?? true,
    );
  }

  registerProvider(provider: ContextProvider): void {
    this.providers.push(provider);
  }

  /** Boot the context bundle. Returns undefined if disabled. */
  async boot(): Promise<ContextBundle | undefined> {
    if (!this.enabled) return undefined;
    if (this.cachedBundle) return this.cachedBundle;

    const identity = await this.identityLoader.load();
    const project = await this.projectLoader.load();

    const extras: JsonObject = {};
    for (const provider of this.providers) {
      try {
        const slice = await provider.load();
        if (slice) Object.assign(extras, slice);
      } catch {
        // providers are additive, failures are non-fatal
      }
    }

    const bundle: ContextBundle = {
      id: createId("ctx"),
      identity,
      project,
      previousDecisions: [...this.previousDecisions].slice(-20),
      activeGoals: [...this.activeGoals],
      preferences: identity.preferences,
      createdAt: now(),
      source: "bootloader",
      metadata: extras,
    };
    this.cachedBundle = bundle;
    return bundle;
  }

  /** Re-run the boot sequence discarding the cache. */
  async refresh(): Promise<ContextBundle | undefined> {
    this.cachedBundle = undefined;
    return this.boot();
  }

  /** Expose identity loader for mutation. */
  getIdentityLoader(): IdentityLoader {
    return this.identityLoader;
  }

  /** Expose project loader for inspection. */
  getProjectLoader(): ProjectLoader {
    return this.projectLoader;
  }
}
