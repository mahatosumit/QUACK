import test from "node:test";
import assert from "node:assert/strict";
import { ModelRegistry } from "./registry.js";
import type { ModelInfo } from "./types.js";

function sampleModel(overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    id: "test-model-1",
    name: "Test Model One",
    provider: "test-provider",
    capabilities: ["reasoning", "coding"],
    contextWindow: 8192,
    supportsTools: true,
    latencyMs: 500,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
    status: "available",
    ...overrides,
  };
}

test("ModelRegistry register adds a model", () => {
  const registry = new ModelRegistry();
  const result = registry.register(sampleModel());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data, "test-model-1");
});

test("ModelRegistry register rejects duplicates", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel());
  const result = registry.register(sampleModel());

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "model.duplicate");
});

test("ModelRegistry get returns a registered model", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel());
  const result = registry.get("test-model-1");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.name, "Test Model One");
});

test("ModelRegistry get fails for unknown model", () => {
  const registry = new ModelRegistry();
  const result = registry.get("nonexistent");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "model.not_found");
});

test("ModelRegistry getAll returns all models", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel({ id: "m1", name: "Model 1" }));
  registry.register(sampleModel({ id: "m2", name: "Model 2" }));

  const all = registry.getAll();
  assert.equal(all.length, 2);
});

test("ModelRegistry findByCapability filters correctly", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel({ id: "m1", capabilities: ["reasoning"] }));
  registry.register(sampleModel({ id: "m2", capabilities: ["coding"] }));
  registry.register(sampleModel({ id: "m3", capabilities: ["reasoning", "coding"] }));

  const reasoning = registry.findByCapability("reasoning");
  assert.equal(reasoning.length, 2);
  assert.equal(reasoning[0]!.id, "m1");

  const coding = registry.findByCapability("coding");
  assert.equal(coding.length, 2);

  const fast = registry.findByCapability("fast");
  assert.equal(fast.length, 0);
});

test("ModelRegistry findByProvider filters correctly", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel({ id: "m1", provider: "openai" }));
  registry.register(sampleModel({ id: "m2", provider: "anthropic" }));
  registry.register(sampleModel({ id: "m3", provider: "openai" }));

  const openai = registry.findByProvider("openai");
  assert.equal(openai.length, 2);

  const anthropic = registry.findByProvider("anthropic");
  assert.equal(anthropic.length, 1);

  const unknown = registry.findByProvider("unknown");
  assert.equal(unknown.length, 0);
});

test("ModelRegistry remove deletes a model", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel());
  const removeResult = registry.remove("test-model-1");

  assert.equal(removeResult.ok, true);
  assert.equal(registry.count, 0);
});

test("ModelRegistry remove fails for unknown model", () => {
  const registry = new ModelRegistry();
  const result = registry.remove("nonexistent");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "model.not_found");
});

test("ModelRegistry count tracks registered models", () => {
  const registry = new ModelRegistry();
  assert.equal(registry.count, 0);

  registry.register(sampleModel({ id: "m1" }));
  assert.equal(registry.count, 1);

  registry.register(sampleModel({ id: "m2" }));
  assert.equal(registry.count, 2);

  registry.remove("m1");
  assert.equal(registry.count, 1);
});

test("ModelRegistry updateStatus changes model status", () => {
  const registry = new ModelRegistry();
  registry.register(sampleModel());

  const result = registry.updateStatus("test-model-1", "error");
  assert.equal(result.ok, true);

  const model = registry.get("test-model-1");
  assert.equal(model.ok, true);
  if (!model.ok) return;
  assert.equal(model.data.status, "error");
});

test("ModelRegistry updateStatus fails for unknown model", () => {
  const registry = new ModelRegistry();
  const result = registry.updateStatus("nonexistent", "available");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "model.not_found");
});
