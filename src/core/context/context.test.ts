import test from "node:test";
import assert from "node:assert/strict";
import { IdentityLoader, ProjectLoader, ContextLoader, type ContextBundle } from "./index.js";

test("IdentityLoader loads defaults then persists updates", async () => {
  const loader = new IdentityLoader();
  const identity = await loader.load();
  assert.equal(identity.name, "User");
  assert.equal(identity.role, "engineer");
  assert.equal(identity.preferences.codingStyle, "modular");

  await loader.update({ name: "Example User" });
  const updated = await loader.load();
  assert.equal(updated.name, "Example User");
});

test("IdentityLoader adds and removes goals", async () => {
  const loader = new IdentityLoader();
  await loader.addGoal("Build autonomous AI systems");
  let identity = await loader.load();
  assert.equal(identity.goals.length, 1);

  await loader.removeGoal("Build autonomous AI systems");
  identity = await loader.load();
  assert.equal(identity.goals.length, 0);
});

test("ProjectLoader reads the workspace", async () => {
  const loader = new ProjectLoader("./src/core/context");
  const project = await loader.load();
  assert.ok(project, "project should load");
  assert.ok(project!.files.some((f) => f.endsWith("types.ts")));
  assert.ok(project!.languages.includes("TypeScript"));
});

test("ContextLoader boots a bundle when enabled", async () => {
  const loader = ContextLoader.create({ workspaceRoot: "./src", enabled: true });
  const bundle = await loader.boot();
  assert.ok(bundle, "bundle should be created");
  assert.equal(bundle!.source, "bootloader");
  assert.equal(bundle!.identity.name, "User");
  assert.ok(bundle!.project, "project should be loaded");
});

test("ContextLoader returns undefined when disabled", async () => {
  const loader = ContextLoader.create({ enabled: false });
  const bundle = await loader.boot();
  assert.equal(bundle, undefined);
});

test("ContextLoader caches bundle until refresh", async () => {
  const loader = ContextLoader.create({ workspaceRoot: "./src", enabled: true });
  const first = await loader.boot();
  const second = await loader.boot();
  assert.equal(first, second, "cached bundle should be identical");
  const third = await loader.refresh();
  assert.notEqual(first, third);
});
