import assert from "node:assert/strict";
import test from "node:test";
import { EchoProvider, ProviderRegistry, type ProviderAdapter } from "./provider.js";
import { DeterministicMockProvider, ProviderFallbackRouter } from "./router.js";

test("provider fallback reaches deterministic mock after a failed provider", async () => {
  const providers = new ProviderRegistry();
  const failing: ProviderAdapter = { id: "failing", discover: async () => ({ providerId: "failing", models: [], supportsStreaming: false, supportsStructuredOutput: false, supportsToolCalling: false, supportsEmbeddings: false, supportsMultimodal: false }), healthCheck: async () => ({ healthy: false, message: "down" }), generate: async () => { throw new Error("down"); } };
  providers.register(failing);
  providers.register(new DeterministicMockProvider());
  providers.register(new EchoProvider());
  const routed = await new ProviderFallbackRouter(providers).generate({ model: "deterministic-1", prompt: "hello" }, ["failing", "test.deterministic-mock"]);
  assert.deepEqual(routed.attempted, ["failing", "test.deterministic-mock"]);
  assert.equal(routed.result.text, "mock:deterministic-1:hello");
});
