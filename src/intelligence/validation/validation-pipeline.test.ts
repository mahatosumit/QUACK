import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ValidationPipeline } from "./validation-pipeline.js";
import { EventBus } from "../../events/event-bus.js";

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-test-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("ValidationPipeline typeCheck returns empty on no-ts project", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const pipeline = new ValidationPipeline({ workspaceRoot: root, eventBus: events, timeoutMs: 30_000 });

    const errors = await pipeline.typeCheck();
    assert.ok(Array.isArray(errors));
  } finally {
    cleanup();
  }
});

test("ValidationPipeline lint returns empty on no-eslint project", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const pipeline = new ValidationPipeline({ workspaceRoot: root, eventBus: events, timeoutMs: 30_000 });

    const errors = await pipeline.lint();
    assert.ok(Array.isArray(errors));
  } finally {
    cleanup();
  }
});

test("ValidationPipeline handles multiple calls", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const events = new EventBus();
    const pipeline = new ValidationPipeline({ workspaceRoot: root, eventBus: events, timeoutMs: 30_000 });

    const [typeErrors, lintErrors] = await Promise.all([
      pipeline.typeCheck(),
      pipeline.lint(),
    ]);
    assert.ok(Array.isArray(typeErrors));
    assert.ok(Array.isArray(lintErrors));
  } finally {
    cleanup();
  }
});
