import { createValidatedListingRuntime } from "../test-support/validated-listing-runtime.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem } from "../distributions/swe-system.js";

test("ExecutiveBrain submitGoal executes concrete DAG toolInvocations through runtime", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_dag_workspace"));
  const dataDir = join(tmpdir(), createId("quack_dag_state"));
  const previousNvidiaKey = process.env["NVIDIA_API_KEY"];
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(join(workspaceRoot, "hello.txt"), "hello from executable dag\n", "utf8");
  let system: ReturnType<typeof createQuackSystem> | undefined;

  try {
    delete process.env["NVIDIA_API_KEY"];
    system = createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["workspace.read"],
    });

    const runtime = createValidatedListingRuntime(system, "hello.txt");
    const task = await runtime.submitGoal("list workspace files", "test");

    assert.equal(task.ok, true);
    if (!task.ok) return;
    assert.equal(task.data.status, "completed");
    assert.equal(task.data.result?.["totalSteps"], 1);
    assert.equal(task.data.result?.["failedSteps"], 0);
    assert.equal(task.data.result?.["toolCallsMade"], 1);

    const nodeResults = task.data.result?.["nodeResults"] as Record<string, {
      readonly toolCalls?: readonly string[];
      readonly output?: { readonly lastToolOutput?: { readonly files?: readonly string[] } };
    }>;
    const files = Object.values(nodeResults).flatMap((result) => result.output?.lastToolOutput?.files ?? []);
    assert.deepEqual(Object.values(nodeResults).flatMap((result) => result.toolCalls ?? []), ["core.workspace.list-files"]);
    assert.ok(files.some((file) => file.startsWith("hello.txt ")));
  } finally {
    if (previousNvidiaKey === undefined) {
      delete process.env["NVIDIA_API_KEY"];
    } else {
      process.env["NVIDIA_API_KEY"] = previousNvidiaKey;
    }
    // Fire-and-forget emits (ownership release) can append to the audit log
    // after submitGoal resolves; drain before teardown so rm never races an
    // in-flight append (ENOTEMPTY on macOS/Windows).
    await system?.events.drain();
    await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
