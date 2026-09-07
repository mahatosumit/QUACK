import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry, EchoProvider } from "./provider.js";

describe("ProviderRegistry", () => {
  it("register adds a provider", () => {
    const registry = new ProviderRegistry();
    const provider = new EchoProvider();
    const result = registry.register(provider);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.data === "core.echo-provider");
  });

  it("get returns registered provider", () => {
    const registry = new ProviderRegistry();
    const provider = new EchoProvider();
    registry.register(provider);
    const result = registry.get("core.echo-provider");
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.data === provider);
  });

  it("list returns all providers", () => {
    const registry = new ProviderRegistry();
    assert.deepEqual(registry.list(), []);
    registry.register(new EchoProvider());
    assert.deepEqual(registry.list(), ["core.echo-provider"]);
  });

  it("get with no match returns error", () => {
    const registry = new ProviderRegistry();
    const result = registry.get("nonexistent");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === "provider.not_found");
  });

  it("register rejects duplicate provider", () => {
    const registry = new ProviderRegistry();
    registry.register(new EchoProvider());
    const result = registry.register(new EchoProvider());
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.code === "provider.duplicate");
  });
});
