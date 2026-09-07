import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NvidiaNimProvider } from "./nvidia.js";
import { ProviderRegistry } from "./provider.js";

describe("NvidiaNimProvider", () => {
  it("does not invent model or capability support without credentials", async () => {
    const provider = new NvidiaNimProvider({ apiKey: "", defaultModel: "" });
    const discovered = await provider.discover();
    assert.equal(discovered.providerId, "provider.nvidia-nim");
    assert.deepEqual(discovered.models, []);
    assert.equal(discovered.supportsStreaming, false);
    assert.equal(discovered.supportsToolCalling, false);
  });

  it("fails closed when API key is not configured", async () => {
    const provider = new NvidiaNimProvider({ apiKey: "" });
    await assert.rejects(provider.generate({ model: "test/model", prompt: "hello" }), /authentication is not configured/i);
  });

  it("registers in ProviderRegistry alongside existing providers", () => {
    const registry = new ProviderRegistry();
    const provider = new NvidiaNimProvider({ apiKey: "test-key" });
    const res = registry.register(provider);
    assert.equal(res.ok, true);
    assert.ok(registry.list().includes("provider.nvidia-nim"));
  });
});
