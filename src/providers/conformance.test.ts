import assert from "node:assert/strict";
import test from "node:test";
import { QUACK_CONTRACT_VERSION, type ExecutionContextV1, type QuackProviderV1 } from "../contracts/index.js";
import { runProviderConformance, type ProviderConformanceCaseId } from "./conformance.js";

test("provider conformance executes all mandatory cases and only skips explicit unsupported capabilities", async () => {
  const provider = new TextOnlyProvider();
  const hookIds: ProviderConformanceCaseId[] = ["PCT-006", "PCT-007", "PCT-008", "PCT-015", "PCT-016", "PCT-017", "PCT-018", "PCT-019", "PCT-020"];
  const hooks = Object.fromEntries(hookIds.map((id) => [id, async () => undefined]));
  const report = await runProviderConformance({ provider, model: "text-1", context: executionContext(), hooks });
  assert.equal(report.results.length, 20);
  assert.equal(report.results.filter((result) => result.status === "FAIL").length, 0);
  assert.equal(report.fullySupported, true);
  assert.equal(report.results.find((result) => result.id === "PCT-010")?.status, "SKIP");
});

class TextOnlyProvider implements QuackProviderV1 {
  metadata() { return { contractVersion: QUACK_CONTRACT_VERSION, providerId: "text-only", displayName: "Text", runtime: "fake", boundary: "local", credentialEnvironmentVariables: [] } as const; }
  async health() { return { status: "HEALTHY", checkedAt: new Date().toISOString() } as const; }
  async discoverModels() { return [{ id: "text-1", providerId: "text-only", runtime: "fake", capabilities: await this.capabilities() }]; }
  async capabilities() { return [{ capability: "text", level: "NATIVE" }, { capability: "streaming", level: "UNSUPPORTED" }, { capability: "cancellation", level: "UNSUPPORTED" }, { capability: "context-window", level: "UNSUPPORTED" }, { capability: "tool-calling", level: "UNSUPPORTED" }, { capability: "structured-output", level: "UNSUPPORTED" }, { capability: "json-schema", level: "UNSUPPORTED" }, { capability: "token-accounting", level: "UNSUPPORTED" }] as const; }
  async generate(request: { readonly model: string }, context: ExecutionContextV1) { return { executionId: context.executionId, providerId: "text-only", model: request.model, text: "ready", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "unavailable" }, latencyMs: 0 } as const; }
}
function executionContext(): ExecutionContextV1 {
  return { contractVersion: QUACK_CONTRACT_VERSION, missionId: "mission", taskId: "task", executionId: "execution", actor: "test" };
}
