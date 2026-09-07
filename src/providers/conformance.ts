import {
  capabilitySupport,
  type CapabilityName,
  type ExecutionContextV1,
  type ProviderModelRequestV1,
  type QuackProviderV1,
} from "../contracts/index.js";

export type ProviderConformanceCaseId =
  | "PCT-001" | "PCT-002" | "PCT-003" | "PCT-004" | "PCT-005"
  | "PCT-006" | "PCT-007" | "PCT-008" | "PCT-009" | "PCT-010"
  | "PCT-011" | "PCT-012" | "PCT-013" | "PCT-014" | "PCT-015"
  | "PCT-016" | "PCT-017" | "PCT-018" | "PCT-019" | "PCT-020";

export interface ProviderConformanceResult {
  readonly id: ProviderConformanceCaseId;
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "SKIP" | "BLOCKED";
  readonly durationMs: number;
  readonly reason?: string;
}
export interface ProviderConformanceFixture {
  readonly provider: QuackProviderV1;
  readonly model: string;
  readonly context: ExecutionContextV1;
  readonly textRequest?: ProviderModelRequestV1;
  readonly hooks?: Partial<Record<ProviderConformanceCaseId, () => Promise<void>>>;
  /** Live suites use BLOCKED for absent credentials; deterministic CI fixtures do not. */
  readonly blockedReason?: string;
}

export interface ProviderConformanceReport {
  readonly providerId: string;
  readonly model: string;
  readonly results: readonly ProviderConformanceResult[];
  readonly fullySupported: boolean;
}

const CASES: readonly { readonly id: ProviderConformanceCaseId; readonly name: string; readonly capability?: CapabilityName }[] = [
  { id: "PCT-001", name: "provider health" },
  { id: "PCT-002", name: "model discovery" },
  { id: "PCT-003", name: "text generation", capability: "text" },
  { id: "PCT-004", name: "streaming", capability: "streaming" },
  { id: "PCT-005", name: "cancellation", capability: "cancellation" },
  { id: "PCT-006", name: "timeout" },
  { id: "PCT-007", name: "invalid credentials" },
  { id: "PCT-008", name: "missing model" },
  { id: "PCT-009", name: "context overflow", capability: "context-window" },
  { id: "PCT-010", name: "tool calling", capability: "tool-calling" },
  { id: "PCT-011", name: "malformed tool call", capability: "tool-calling" },
  { id: "PCT-012", name: "structured JSON", capability: "structured-output" },
  { id: "PCT-013", name: "JSON schema", capability: "json-schema" },
  { id: "PCT-014", name: "usage normalization", capability: "token-accounting" },
  { id: "PCT-015", name: "error normalization" },
  { id: "PCT-016", name: "retry" },
  { id: "PCT-017", name: "fallback" },
  { id: "PCT-018", name: "concurrency" },
  { id: "PCT-019", name: "provider recovery" },
  { id: "PCT-020", name: "privacy boundary" },
];

/** Reusable provider conformance runner. Missing mandatory hooks fail loudly. */
export async function runProviderConformance(fixture: ProviderConformanceFixture): Promise<ProviderConformanceReport> {
  const metadata = fixture.provider.metadata();
  if (fixture.blockedReason) {
    return {
      providerId: metadata.providerId,
      model: fixture.model,
      results: CASES.map((item) => ({ id: item.id, name: item.name, status: "BLOCKED", durationMs: 0, reason: fixture.blockedReason })),
      fullySupported: false,
    };
  }
  let advertised = await fixture.provider.capabilities(fixture.model);
  const results: ProviderConformanceResult[] = [];
  for (const item of CASES) {
    if (item.capability && capabilitySupport(advertised, item.capability).level === "UNSUPPORTED") {
      results.push({ id: item.id, name: item.name, status: "SKIP", durationMs: 0, reason: `${item.capability} is explicitly unsupported.` });
      continue;
    }
    const started = Date.now();
    try {
      if (item.id === "PCT-001") {
        const health = await fixture.provider.health(fixture.context);
        if (health.status !== "HEALTHY" && health.status !== "DEGRADED") throw new Error(`Unexpected health status ${health.status}.`);
      } else if (item.id === "PCT-002") {
        const models = await fixture.provider.discoverModels(fixture.context);
        if (!models.some((model) => model.id === fixture.model)) throw new Error(`Model ${fixture.model} was not discovered.`);
        advertised = models.find((model) => model.id === fixture.model)?.capabilities ?? advertised;
      } else if (item.id === "PCT-003") {
        const response = await fixture.provider.generate(fixture.textRequest ?? { model: fixture.model, prompt: "Reply with the word ready." }, fixture.context);
        if (!response.text.trim()) throw new Error("Provider returned empty text.");
      } else if (item.id === "PCT-004") {
        if (!fixture.provider.stream) throw new Error("Streaming is advertised but stream() is not implemented.");
        let completed = false;
        for await (const event of fixture.provider.stream(fixture.textRequest ?? { model: fixture.model, prompt: "stream" }, fixture.context)) {
          completed = completed || event.type === "COMPLETED";
        }
        if (!completed) throw new Error("Stream ended without a COMPLETED event.");
      } else if (item.id === "PCT-005") {
        if (!fixture.provider.cancel) throw new Error("Cancellation is advertised but cancel() is not implemented.");
        await fixture.provider.cancel(fixture.context.executionId);
      } else {
        const hook = fixture.hooks?.[item.id];
        if (!hook) throw new Error(`Mandatory conformance fixture hook ${item.id} is missing.`);
        await hook();
      }
      results.push({ id: item.id, name: item.name, status: "PASS", durationMs: Date.now() - started });
    } catch (error) {
      results.push({ id: item.id, name: item.name, status: "FAIL", durationMs: Date.now() - started, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    providerId: metadata.providerId,
    model: fixture.model,
    results,
    fullySupported: results.every((result) => result.status === "PASS" || result.status === "SKIP"),
  };
}
