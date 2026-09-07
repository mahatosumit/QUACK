import { fail, ok, type JsonObject, type QuackResult } from "../core/types.js";
import { type ToolExecutionContext, type ToolMetadata, type ToolResult, type QuackTool } from "./tool.js";

export type ExternalResearchCapability =
  | "external.web_search"
  | "external.social_search"
  | "external.github_search"
  | "external.youtube_transcript"
  | "external.reddit_search"
  | "external.twitter_search";

export interface ResearchSource {
  readonly title: string;
  readonly url?: string;
  readonly text: string;
}

export interface AgentReachSearchInput {
  readonly query: string;
  readonly capability: ExternalResearchCapability;
  readonly maxResults?: number;
}

export interface AgentReachExecutor {
  (input: AgentReachSearchInput, signal: AbortSignal): Promise<readonly ResearchSource[]>;
}

export interface AgentReachToolAdapterConfig {
  readonly enabled?: boolean;
  readonly timeoutMs?: number;
  readonly maxResults?: number;
  readonly maxOutputChars?: number;
  /** Injected by a deployment integration; QUACK never installs Agent-Reach as a hard dependency. */
  readonly executor?: AgentReachExecutor;
}

/** Bounded adapter for an optional Agent-Reach CLI/MCP integration. */
export class AgentReachToolAdapter {
  private readonly config: Required<Omit<AgentReachToolAdapterConfig, "executor">> & Pick<AgentReachToolAdapterConfig, "executor">;

  constructor(config: AgentReachToolAdapterConfig = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      timeoutMs: config.timeoutMs ?? 10_000,
      maxResults: config.maxResults ?? 10,
      maxOutputChars: config.maxOutputChars ?? 16_000,
      executor: config.executor,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Safe operational metadata for status UIs; never exposes an executor or credentials. */
  getStatus(): { readonly enabled: boolean; readonly configured: boolean; readonly timeoutMs: number; readonly maxResults: number; readonly maxOutputChars: number } {
    return {
      enabled: this.config.enabled,
      configured: this.config.executor !== undefined,
      timeoutMs: this.config.timeoutMs,
      maxResults: this.config.maxResults,
      maxOutputChars: this.config.maxOutputChars,
    };
  }

  async search(input: AgentReachSearchInput): Promise<{ readonly status: "disabled" | "success" | "failed"; readonly sources: readonly ResearchSource[]; readonly error?: string }> {
    if (!this.config.enabled) return { status: "disabled", sources: [], error: "Agent-Reach integration is disabled by default." };
    if (!this.config.executor) return { status: "failed", sources: [], error: "Agent-Reach executor is not configured." };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const maxResults = Math.min(Math.max(1, input.maxResults ?? this.config.maxResults), this.config.maxResults);
      const sources = await this.config.executor({ ...input, maxResults }, controller.signal);
      return { status: "success", sources: normalizeSources(sources, maxResults, this.config.maxOutputChars) };
    } catch (error) {
      return { status: "failed", sources: [], error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Registered in QUACK's tool registry but inert until explicitly enabled. The runtime capability broker enforces network.http. */
export class AgentReachTool implements QuackTool<AgentReachSearchInput, JsonObject> {
  readonly id = "external.agent-reach";

  constructor(private readonly adapter: AgentReachToolAdapter) {}

  describe(): ToolMetadata {
    return {
      id: this.id,
      name: "Agent-Reach research adapter",
      description: "Optional bounded external research adapter. Disabled by default.",
      permissions: ["network.http"],
    };
  }

  validateInput(input: unknown): QuackResult<AgentReachSearchInput> {
    if (!isRecord(input) || typeof input["query"] !== "string" || !input["query"].trim() || !isCapability(input["capability"])) {
      return fail({ code: "research.invalid_input", message: "Research requires a non-empty query and supported capability.", category: "validation", recoverable: true });
    }
    const maxResults = typeof input["maxResults"] === "number" ? input["maxResults"] : undefined;
    return ok({ query: input["query"], capability: input["capability"], ...(maxResults === undefined ? {} : { maxResults }) });
  }

  async execute(input: AgentReachSearchInput, _context: ToolExecutionContext): Promise<ToolResult<JsonObject>> {
    const result = await this.adapter.search(input);
    return {
      output: {
        status: result.status,
        sources: result.sources.map((source) => ({ title: source.title, url: source.url ?? null, text: source.text })),
        error: result.error ?? null,
      },
    };
  }
}

function normalizeSources(sources: readonly ResearchSource[], maxResults: number, maxOutputChars: number): ResearchSource[] {
  let remaining = maxOutputChars;
  const normalized: ResearchSource[] = [];
  for (const source of sources.slice(0, maxResults)) {
    if (remaining <= 0) break;
    const text = source.text.slice(0, remaining);
    remaining -= text.length;
    normalized.push({ title: source.title.slice(0, 500), ...(source.url ? { url: source.url } : {}), text });
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCapability(value: unknown): value is ExternalResearchCapability {
  return value === "external.web_search" || value === "external.social_search" || value === "external.github_search" || value === "external.youtube_transcript" || value === "external.reddit_search" || value === "external.twitter_search";
}
