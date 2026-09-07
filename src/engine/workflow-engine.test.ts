import test from "node:test";
import assert from "node:assert/strict";
import { TaskGraphBuilder } from "./task-graph.js";
import { InMemoryCheckpointStore, CheckpointManager } from "./checkpoint-system.js";
import { InMemoryJournalStore, JournalWriter } from "./execution-journal.js";
import { WorkflowEngine, type WorkflowEngineConfig } from "./workflow-engine.js";
import { type RetryPolicy, type TaskGraph, type WorkflowState } from "./types.js";
import { type JsonObject } from "../core/types.js";
import { EchoTool, ToolRegistry, validateToolInput, type ToolInvocation, type ToolInvocationExecutionContext, type ToolInvocationExecutor, type ToolInvocationOutcome } from "../tools/tool.js";

const NO_RETRY: RetryPolicy = { maxRetries: 0, backoff: "fixed", baseDelayMs: 0, maxDelayMs: 0 };

test("workflow engine invokes concrete node toolInvocations", async () => {
  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const calls: string[] = [];
  const graph = new TaskGraphBuilder({ description: "real tool invocation" })
    .addNode("echo", {
      description: "Echo a message",
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "hello" } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, async (invocation, context) => {
    calls.push(invocation.toolId);
    return executeRegisteredToolForTest(registry, invocation, context);
  });

  assert.equal(state.status, "completed");
  assert.deepEqual(calls, ["core.echo"]);
  assert.equal(state.nodeResults["echo"]?.success, true);
  assert.deepEqual(state.nodeResults["echo"]?.toolCalls, ["core.echo"]);
});

test("workflow engine resolves node output bindings between DAG nodes", async () => {
  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const graph = new TaskGraphBuilder({ description: "dataflow" })
    .addNode("first", {
      description: "Produce a message",
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "from first" } }],
      retryPolicy: NO_RETRY,
    })
    .addNode("second", {
      description: "Consume first node output",
      dependencies: ["first"],
      tools: ["core.echo"],
      toolInvocations: [{
        toolId: "core.echo",
        input: { message: { $fromNode: "first", path: "output.lastToolOutput.message" } },
      }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, (invocation, context) => executeRegisteredToolForTest(registry, invocation, context));
  const output = state.nodeResults["second"]?.output;

  assert.equal(state.status, "completed");
  assert.equal(((output?.["lastToolOutput"] as { readonly message?: string })?.message), "from first");
});

test("workflow engine rejects toolInvocations not declared in requiredTools", async () => {
  const graph = new TaskGraphBuilder({ description: "undeclared tool" })
    .addNode("node", {
      description: "Try an undeclared tool",
      tools: [],
      toolInvocations: [{ toolId: "core.echo", input: { message: "nope" } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, async () => {
    throw new Error("executor should not be called");
  });

  assert.equal(state.status, "failed");
  assert.match(state.nodeResults["node"]?.error ?? "", /not declared in requiredTools/);
  assert.deepEqual(state.nodeResults["node"]?.toolCalls, []);
});

test("workflow engine rejects malformed $fromNode bindings structurally", async () => {
  const graph = new TaskGraphBuilder({ description: "malformed binding" })
    .addNode("first", {
      description: "Produce a message",
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "first" } }],
      retryPolicy: NO_RETRY,
    })
    .addNode("second", {
      description: "Use malformed binding",
      dependencies: ["first"],
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: { $fromNode: 123 } as JsonObject } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const state = await runWorkflow(graph, (invocation, context) => executeRegisteredToolForTest(registry, invocation, context));

  assert.equal(state.status, "failed");
  assert.match(state.nodeResults["second"]?.error ?? "", /\$fromNode binding requires/);
});

test("workflow engine allows bindings only from declared dependencies", async () => {
  const graph = new TaskGraphBuilder({ description: "hidden dependency" })
    .addNode("first", {
      description: "Produce a hidden value",
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "hidden" } }],
      retryPolicy: NO_RETRY,
    })
    .addNode("gate", {
      description: "Declared dependency",
      tools: [],
      retryPolicy: NO_RETRY,
    })
    .addNode("second", {
      description: "Try hidden binding",
      dependencies: ["gate"],
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: { $fromNode: "first", path: "output.lastToolOutput.message" } } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const state = await runWorkflow(graph, (invocation, context) => executeRegisteredToolForTest(registry, invocation, context));

  assert.equal(state.status, "failed");
  assert.match(state.nodeResults["second"]?.error ?? "", /not a declared dependency/);
});

test("workflow engine fails cleanly for missing output binding paths", async () => {
  const graph = new TaskGraphBuilder({ description: "missing output path" })
    .addNode("first", {
      description: "Produce output",
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "first" } }],
      retryPolicy: NO_RETRY,
    })
    .addNode("second", {
      description: "Read missing key",
      dependencies: ["first"],
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: { $fromNode: "first", path: "output.missing" } } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const state = await runWorkflow(graph, (invocation, context) => executeRegisteredToolForTest(registry, invocation, context));

  assert.equal(state.status, "failed");
  assert.match(state.nodeResults["second"]?.error ?? "", /Cannot resolve node output path/);
});

test("workflow engine rejects missing graph dependencies before execution", async () => {
  const graph = new TaskGraphBuilder({ description: "missing dependency" })
    .addNode("node", {
      description: "Depends on a missing node",
      dependencies: ["missing"],
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "should not run" } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  await assert.rejects(() => runWorkflow(graph, async () => {
    throw new Error("executor should not be called");
  }), /missing dependency/);
});

test("workflow engine clones bound JSON output before passing it downstream", async () => {
  const graph = new TaskGraphBuilder({ description: "clone binding" })
    .addNode("producer", {
      description: "Produce object output",
      tools: ["test.producer"],
      toolInvocations: [{ toolId: "test.producer", input: {} }],
      retryPolicy: NO_RETRY,
    })
    .addNode("mutator", {
      description: "Mutate bound object",
      dependencies: ["producer"],
      tools: ["test.mutator"],
      toolInvocations: [{ toolId: "test.mutator", input: { payload: { $fromNode: "producer", path: "output.lastToolOutput.payload" } } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, async (invocation) => {
    if (invocation.toolId === "test.producer") {
      return { toolId: invocation.toolId, success: true, output: { payload: { label: "original" } } };
    }
    const payload = invocation.input["payload"] as { label: string };
    payload.label = "mutated";
    return { toolId: invocation.toolId, success: true, output: { payload } };
  });

  const producerPayload = state.nodeResults["producer"]?.output?.["lastToolOutput"] as { readonly payload?: { readonly label?: string } };
  const mutatorPayload = state.nodeResults["mutator"]?.output?.["lastToolOutput"] as { readonly payload?: { readonly label?: string } };
  assert.equal(state.status, "completed");
  assert.equal(producerPayload.payload?.label, "original");
  assert.equal(mutatorPayload.payload?.label, "mutated");
});

test("workflow engine does not fake success for nodes without executable invocations", async () => {
  const graph = new TaskGraphBuilder({ description: "missing invocation" })
    .addNode("needs-tool", {
      description: "Needs a tool but has no invocation",
      tools: ["core.echo"],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, async () => {
    throw new Error("executor should not be called");
  });

  assert.equal(state.status, "failed");
  assert.equal(state.nodeResults["needs-tool"]?.success, false);
  assert.match(state.nodeResults["needs-tool"]?.error ?? "", /no executable toolInvocations/);
  assert.deepEqual(state.nodeResults["needs-tool"]?.toolCalls, []);
});

test("workflow engine skips downstream nodes when a dependency fails", async () => {
  const registry = new ToolRegistry();
  registry.register(new EchoTool());
  const graph = new TaskGraphBuilder({ description: "failure propagation" })
    .addNode("first", {
      description: "Fail on unknown tool",
      tools: ["core.missing"],
      toolInvocations: [{ toolId: "core.missing", input: {} }],
      retryPolicy: NO_RETRY,
    })
    .addNode("second", {
      description: "Should not run",
      dependencies: ["first"],
      tools: ["core.echo"],
      toolInvocations: [{ toolId: "core.echo", input: { message: "should not run" } }],
      retryPolicy: NO_RETRY,
    })
    .build();

  const state = await runWorkflow(graph, (invocation, context) => executeRegisteredToolForTest(registry, invocation, context));

  assert.equal(state.status, "failed");
  assert.deepEqual(state.failedNodes, ["first"]);
  assert.deepEqual(state.skippedNodes, ["second"]);
  assert.match(state.nodeResults["second"]?.error ?? "", /dependency node/);
});

async function runWorkflow(
  graph: TaskGraph,
  executeTool: ToolInvocationExecutor,
): Promise<WorkflowState> {
  const journalStore = new InMemoryJournalStore();
  const engine = new WorkflowEngine(
    {
      schedulerConfig: { maxParallelNodes: 2, defaultTimeoutMs: 1000, queuePollIntervalMs: 10 },
      defaultRetryPolicy: NO_RETRY,
      checkpointInterval: 0,
      executeTool,
    },
    new CheckpointManager(new InMemoryCheckpointStore()),
    new JournalWriter(journalStore, "workflow-test", "session-test"),
  );

  await engine.start(graph, "workflow-test", "session-test", "task-test");
  return engine.waitForCompletion();
}

async function executeRegisteredToolForTest(
  registry: ToolRegistry,
  invocation: ToolInvocation,
  context: ToolInvocationExecutionContext,
): Promise<ToolInvocationOutcome> {
  const tool = registry.get(invocation.toolId);
  if (!tool.ok) {
    return { toolId: invocation.toolId, success: false, error: tool.error.message };
  }

  const validInput = validateToolInput(tool.data, invocation.input);
  if (!validInput.ok) {
    return { toolId: invocation.toolId, success: false, error: validInput.error.message };
  }

  try {
    const result = await tool.data.execute(validInput.data, context);
    return { toolId: invocation.toolId, success: true, output: result.output as JsonObject };
  } catch (error) {
    return {
      toolId: invocation.toolId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function engineFor(config: Partial<WorkflowEngineConfig> = {}): WorkflowEngine {
  return new WorkflowEngine({ schedulerConfig: { maxParallelNodes: 2, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 },
    defaultRetryPolicy: NO_RETRY, checkpointInterval: 0, ...config },
  new CheckpointManager(new InMemoryCheckpointStore()), new JournalWriter(new InMemoryJournalStore(), "test", "session"));
}

const success = () => ({ success: true, toolCalls: [], durationMs: 0 });

test("node timeout begins on actual execution, not queue admission", { timeout: 2000 }, async () => {
  const started = deferred();
  const release = deferred();
  const calls: string[] = [];
  const engine = engineFor({ schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 },
    executeNode: async node => { calls.push(node.id); if (node.id === "first") { started.resolve(); await release.promise; } return success(); } });
  const graph = new TaskGraphBuilder({ description: "queue deadline" })
    .addNode("first", { description: "occupy capacity", timeoutMs: 1000, retryPolicy: NO_RETRY })
    .addNode("second", { description: "short operation", timeoutMs: 10, retryPolicy: NO_RETRY }).build();
  await engine.start(graph, "wf", "ses", "plan");
  await started.promise;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(engine.getWorkflowState()?.nodeStates.second, "ready");
  assert.equal(engine.getWorkflowState()?.taskGraph.nodes[1].startedAt, undefined);
  release.resolve();
  assert.equal((await engine.waitForCompletion()).status, "completed");
  assert.deepEqual(calls, ["first", "second"]);
});

test("node timeout aborts and retains its operation until cleanup settles", { timeout: 2000 }, async () => {
  const aborted = deferred(), cleanup = deferred();
  const engine = engineFor({ executeNode: async (_node, context) => {
    context.signal.addEventListener("abort", aborted.resolve, { once: true });
    await cleanup.promise;
    return success();
  } });
  const graph = new TaskGraphBuilder({ description: "timeout drain" }).addNode("node", { description: "blocking", timeoutMs: 10, retryPolicy: NO_RETRY }).build();
  await engine.start(graph, "wf", "ses", "plan");
  await aborted.promise;
  assert.equal(engine.isRunning(), true);
  assert.equal(engine.getWorkflowState()?.nodeStates.node, "running");
  cleanup.resolve();
  const state = await engine.waitForCompletion();
  assert.equal(state.status, "failed");
  assert.equal(state.nodeResults.node.success, false);
  assert.match(state.nodeResults.node.error!, /timed out/);
});

test("cancellation drains active work and prevents queued work and late success", { timeout: 2000 }, async () => {
  const started = deferred(), aborted = deferred(), cleanup = deferred();
  const calls: string[] = [];
  const engine = engineFor({ schedulerConfig: { maxParallelNodes: 1, defaultTimeoutMs: 1000, queuePollIntervalMs: 0 },
    executeNode: async (node, context) => { calls.push(node.id); started.resolve(); context.signal.addEventListener("abort", aborted.resolve, { once: true }); await cleanup.promise; return success(); } });
  const graph = new TaskGraphBuilder({ description: "cancel" }).addNode("first", { description: "active", retryPolicy: NO_RETRY })
    .addNode("second", { description: "queued", retryPolicy: NO_RETRY }).build();
  await engine.start(graph, "wf", "ses", "plan");
  await started.promise;
  let returned = false;
  const cancelled = engine.cancelAndWait().then(state => { returned = true; return state!; });
  await aborted.promise;
  assert.equal(returned, false);
  cleanup.resolve();
  const state = await cancelled;
  assert.equal(state.status, "cancelled");
  assert.deepEqual(state.taskGraph.nodes.map(node => node.status), ["cancelled", "cancelled"]);
  assert.deepEqual(calls, ["first"]);
});

test("resource locks remain held across retries and results retain graph order", { timeout: 2000 }, async () => {
  const calls: string[] = [];
  const engine = engineFor({ executeNode: async (node, context) => {
    calls.push(`${node.id}:${context.attempt}`);
    return node.id === "a" && context.attempt === 1 ? { ...success(), success: false, error: "busy" } : success();
  } });
  const retryPolicy = { ...NO_RETRY, maxRetries: 1, baseDelayMs: 10, maxDelayMs: 10 };
  const graph = new TaskGraphBuilder({ description: "locks" }).addNode("a", { description: "retry", resources: ["shared"], retryPolicy })
    .addNode("b", { description: "same resource", resources: ["shared"], retryPolicy }).build();
  await engine.start(graph, "wf", "ses", "plan");
  const state = await engine.waitForCompletion();
  assert.equal(state.status, "completed");
  assert.deepEqual(calls, ["a:1", "a:2", "b:1"]);
  assert.deepEqual(state.completedNodes, ["a", "b"]);
  assert.equal(state.taskGraph.nodes[0].retryCount, 1);
});

test("transition failure aborts and drains sibling operations before returning", { timeout: 2000 }, async () => {
  const started = deferred(), aborted = deferred(), cleanup = deferred();
  const engine = engineFor({ executeNode: async (node, context) => {
    if (node.id === "a") { started.resolve(); context.signal.addEventListener("abort", aborted.resolve, { once: true }); await cleanup.promise; }
    else await started.promise;
    return success();
  }, onTransition: state => { if (state.nodeStates.b === "completed") throw new Error("transition persistence failed"); } });
  const graph = new TaskGraphBuilder({ description: "control failure" }).addNode("a", { description: "active", retryPolicy: NO_RETRY })
    .addNode("b", { description: "finish first", retryPolicy: NO_RETRY }).build();
  await engine.start(graph, "wf", "ses", "plan");
  await aborted.promise;
  assert.equal(engine.isRunning(), true);
  cleanup.resolve();
  const state = await engine.waitForCompletion();
  assert.equal(state.status, "failed");
  assert.equal(state.nodeStates.a, "cancelled");
  assert.ok(state.errors.some(error => error.includes("transition persistence failed")));
});

test("per-run concurrency can only narrow configured admission and deadline denies dispatch", { timeout: 2000 }, async () => {
  const started = deferred(), release = deferred();
  const calls: string[] = [];
  const engine = engineFor({ executeNode: async node => { calls.push(node.id); if (node.id === "a") { started.resolve(); await release.promise; } return success(); } });
  const graph = new TaskGraphBuilder({ description: "budget" }).addNode("a", { description: "a", retryPolicy: NO_RETRY }).addNode("b", { description: "b", retryPolicy: NO_RETRY }).build();
  await engine.start(graph, "wf", "ses", "plan", { maxParallelNodes: 1 });
  await started.promise;
  assert.deepEqual(calls, ["a"]);
  release.resolve();
  assert.equal((await engine.waitForCompletion()).status, "completed");
  calls.length = 0;
  await engine.start(graph, "wf2", "ses", "plan", { deadline: new Date(Date.now() - 1).toISOString() });
  assert.equal((await engine.waitForCompletion()).status, "cancelled");
  assert.deepEqual(calls, []);
  await assert.rejects(() => engine.start(graph, "wf3", "ses", "plan", { maxParallelNodes: NaN }), /positive integer/);
});
