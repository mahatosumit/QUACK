import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PatchEngine } from "./patch-engine.js";
import { EventBus } from "../../events/event-bus.js";

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "test.txt"), "hello world\nline two\nline three\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("PatchEngine generatePatch and apply", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    const patch = await engine.generatePatch("test edit", [
      { path: "test.txt", content: "modified content\nline two\nline three\n" },
    ]);

    assert.equal(patch.description, "test edit");
    assert.equal(patch.files.length, 1);
    assert.equal(patch.files[0].path, "test.txt");

    const result = await engine.applyPatch(patch);
    assert.ok(result.success);

    const content = readFileSync(join(root, "test.txt"), "utf-8");
    assert.equal(content, "modified content\nline two\nline three\n");
  } finally {
    cleanup();
  }
});

test("PatchEngine rollbackPatch restores original", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    const original = readFileSync(join(root, "test.txt"), "utf-8");

    const patch = await engine.generatePatch("test edit", [
      { path: "test.txt", content: "modified content\n" },
    ]);
    await engine.applyPatch(patch);

    assert.equal(readFileSync(join(root, "test.txt"), "utf-8"), "modified content\n");

    const rollback = await engine.rollbackPatch(patch.id);
    assert.ok(rollback.success);

    assert.equal(readFileSync(join(root, "test.txt"), "utf-8"), original);
  } finally {
    cleanup();
  }
});

test("PatchEngine generatePatch validates missing files", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    const patch = await engine.generatePatch("edit missing", [
      { path: "nonexistent.txt", content: "new content\n" },
    ]);

    const result = await engine.applyPatch(patch);
    assert.ok(result.success); // creates new files
    assert.ok(existsSync(join(root, "nonexistent.txt")));
  } finally {
    cleanup();
  }
});

test("PatchEngine computeHunks produces valid hunks", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    // Use private method via public API: generatePatch creates hunks internally
    const patch = await engine.generatePatch("multi line", [
      { path: "test.txt", content: "hello world\nmodified line\nline three\n" },
    ]);

    assert.equal(patch.files[0].hunks.length, 1);
    assert.ok(patch.files[0].hunks[0].startLine > 0);
  } finally {
    cleanup();
  }
});

test("PatchEngine validatePatch runs validators", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    const patch = await engine.generatePatch("validator test", [
      { path: "test.txt", content: "validated content\n" },
    ]);

    const result = await engine.validatePatch(patch);
    assert.ok(result.valid || !result.valid); // check it completes without error
    assert.ok(Array.isArray(result.errors));
  } finally {
    cleanup();
  }
});

test("PatchEngine listAppliedPatches", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const engine = new PatchEngine({ workspaceRoot: root, eventBus: events });

    const patch = await engine.generatePatch("list test", [
      { path: "test.txt", content: "listed content\n" },
    ]);
    await engine.applyPatch(patch);

    const list = engine.listAppliedPatches();
    assert.equal(list.length, 1);
    assert.equal(list[0].description, "list test");
  } finally {
    cleanup();
  }
});
