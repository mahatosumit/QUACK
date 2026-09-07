import test from "node:test";
import assert from "node:assert/strict";
import { PluginRegistry } from "./registry.js";
import { type PluginManifest } from "./manifest.js";

const validManifest: PluginManifest = {
  id: "test-plugin",
  name: "Test Plugin",
  version: "1.0.0",
  quackApiVersion: "0.1.0",
  type: "tool",
  entry: "./dist/index.js",
  description: "A test plugin",
  capabilities: ["test"],
  permissions: ["workspace.read"],
};

const anotherManifest: PluginManifest = {
  id: "agent-plugin",
  name: "Agent Plugin",
  version: "0.5.0",
  quackApiVersion: "0.1.0",
  type: "agent",
  entry: "./dist/agent.js",
  capabilities: ["agent"],
  permissions: ["workspace.read", "memory.read"],
};

test("register a plugin with valid manifest", () => {
  const registry = new PluginRegistry();
  const record = registry.register(validManifest);

  assert.equal(record.manifest.id, "test-plugin");
  assert.equal(record.status, "inactive");
  assert.ok(record.loadedAt);
});

test("get registered plugin", () => {
  const registry = new PluginRegistry();
  registry.register(validManifest);

  const record = registry.get("test-plugin");
  assert.ok(record);
  assert.equal(record.manifest.name, "Test Plugin");
});

test("get returns undefined for unknown id", () => {
  const registry = new PluginRegistry();
  const record = registry.get("nonexistent");
  assert.equal(record, undefined);
});

test("get all returns all registered plugins", () => {
  const registry = new PluginRegistry();
  registry.register(validManifest);
  registry.register(anotherManifest);

  const all = registry.getAll();
  assert.equal(all.length, 2);
});

test("remove returns true for existing plugin", () => {
  const registry = new PluginRegistry();
  registry.register(validManifest);

  const removed = registry.remove("test-plugin");
  assert.equal(removed, true);
});

test("remove returns false for nonexistent plugin", () => {
  const registry = new PluginRegistry();
  const removed = registry.remove("nonexistent");
  assert.equal(removed, false);
});

test("count returns correct number of registered plugins", () => {
  const registry = new PluginRegistry();
  assert.equal(registry.count(), 0);

  registry.register(validManifest);
  assert.equal(registry.count(), 1);

  registry.register(anotherManifest);
  assert.equal(registry.count(), 2);
});

test("findByType filters correctly", () => {
  const registry = new PluginRegistry();
  registry.register(validManifest);
  registry.register(anotherManifest);

  const tools = registry.findByType("tool");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].manifest.id, "test-plugin");

  const agents = registry.findByType("agent");
  assert.equal(agents.length, 1);
  assert.equal(agents[0].manifest.id, "agent-plugin");

  const noMatch = registry.findByType("ui");
  assert.equal(noMatch.length, 0);
});
