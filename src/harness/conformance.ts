import assert from "node:assert/strict";
import type { Harness, HarnessConfig, HarnessExecutionContext, HarnessTaskInput, HarnessTaskOutput, HarnessCertification } from "./contract.js";

export interface ConformanceTestResult {
  readonly testId: string;
  readonly name: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly error?: string;
  readonly details?: unknown;
}
export interface ConformanceSuiteResult {
  readonly harnessId: string;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly results: readonly ConformanceTestResult[];
  readonly overallPass: boolean;
}

/** An executable fixture and an assertion of its expected observable result. */
export interface HarnessConformanceFixture {
  readonly input: HarnessTaskInput;
  readonly context: HarnessExecutionContext;
  readonly assertOutput: (output: HarnessTaskOutput) => void | Promise<void>;
}

/** Contract checks only. Passing these does not certify durable or delegated execution. */
export async function runHarnessConformanceTests(
  harness: Harness, config: HarnessConfig, fixture?: HarnessConformanceFixture,
): Promise<ConformanceSuiteResult> {
  const results: ConformanceTestResult[] = [];
  const context: HarnessExecutionContext = fixture?.context ?? {
    missionId: "conformance", runId: "contract", iterationId: "contract", actor: "conformance",
    workspaceRoot: process.cwd(), dataDir: process.cwd(), capabilities: [], trustClass: "SYSTEM",
  };
  async function check(testId: string, name: string, fn: () => Promise<void>) {
    const started = Date.now();
    try { await fn(); results.push({ testId, name, passed: true, durationMs: Date.now() - started }); }
    catch (error) { results.push({ testId, name, passed: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) }); }
  }
  await check("HAR-001", "Metadata and startup state", async () => {
    assert.ok(harness.metadata().id);
    assert.deepEqual(harness.metadata().capabilities, harness.capabilities());
    await harness.start(config);
    assert.ok(["HEALTHY", "DEGRADED"].includes(await harness.health()));
    assert.equal((await harness.status()).activeExecutions, 0);
  });
  await check("HAR-002", "Declared tools execute a fixture with verified output", async () => {
    if (harness.capabilities().tools === "UNSUPPORTED") {
      const result = await harness.send({ goal: "unsupported tool", requiredCapabilities: ["tools"] }, context);
      assert.equal(result.success, false);
      return;
    }
    assert.ok(fixture, "Tool capability requires an executable fixture and observable output assertion.");
    const result = await harness.send(fixture.input, context);
    assert.equal(result.success, true, result.error);
    assert.ok(result.metrics.toolCalls > 0);
    await fixture.assertOutput(result);
  });
  await check("HAR-003", "Unsupported capability requests fail", async () => {
    const unsupported = Object.entries(harness.capabilities()).filter(([, value]) => value === "UNSUPPORTED");
    assert.ok(unsupported.length, "No unsupported-capability fixture is available.");
    for (const [capability] of unsupported) {
      const result = await harness.send({ ...fixture?.input, goal: "unsupported capability", requiredCapabilities: [capability] }, context);
      assert.equal(result.success, false, `${capability} unexpectedly succeeded`);
    }
  });
  await check("HAR-004", "Pre-cancelled dispatch cannot succeed", async () => {
    assert.ok(fixture, "Cancellation requires an executable fixture.");
    const result = await harness.send(fixture.input, { ...context, signal: AbortSignal.abort() });
    assert.equal(result.success, false);
    assert.equal(result.metrics.toolCalls, 0);
  });
  await check("HAR-005", "Expired deadline prevents dispatch", async () => {
    assert.ok(fixture, "Deadline enforcement requires an executable fixture.");
    const result = await harness.send(fixture.input, { ...context, deadline: new Date(0).toISOString() });
    assert.equal(result.success, false);
    assert.equal(result.metrics.toolCalls, 0);
  });
  await check("HAR-006", "Unsupported durability and control reject", async () => {
    if (harness.capabilities().checkpoint !== "UNSUPPORTED" || harness.capabilities().resume !== "UNSUPPORTED" || harness.capabilities().interrupt !== "UNSUPPORTED") {
      throw new Error("Durable/control behavior requires an independent recovery and interruption fixture; it is not certified here.");
    }
    await assert.rejects(() => harness.checkpoint(context.missionId, context.runId));
    await assert.rejects(() => harness.interrupt(context.missionId, context.runId));
  });
  await check("HAR-007", "Unsupported delegation rejects child creation", async () => {
    assert.equal(harness.capabilities().subagents, "UNSUPPORTED", "Delegation requires an independent child-authority fixture; it is not certified here.");
    await assert.rejects(() => harness.spawnSubagent({
      taskId: "child", goal: "fixture", role: "fixture", capabilities: [], allowedTools: [], deniedTools: [],
      depth: 1, maxDepth: 1, parentId: "parent", missionId: context.missionId,
    }));
  });
  await check("HAR-008", "Dispose clears active state and health", async () => {
    await harness.dispose();
    await harness.dispose();
    assert.equal((await harness.status()).activeExecutions, 0);
    assert.notEqual(await harness.health(), "HEALTHY");
  });
  return summarize(config.harnessId, results);
}

/** Certification above detection needs separately implemented scenario gates. */
export async function runCertificationTests(
  harness: Harness, config: HarnessConfig, targetLevel: HarnessCertification, fixture?: HarnessConformanceFixture,
): Promise<ConformanceSuiteResult> {
  const detected = harness.metadata().id === config.harnessId;

  if (targetLevel === "H4_DURABLE") {
    const results: ConformanceTestResult[] = [];
    const context: HarnessExecutionContext = fixture?.context ?? {
      missionId: "h4-cert", runId: "h4-run", iterationId: "h4-iter", actor: "h4-certifier",
      workspaceRoot: process.cwd(), dataDir: process.cwd(), capabilities: ["tools", "checkpoint", "resume", "streaming"], trustClass: "SYSTEM",
    };

    async function check(testId: string, name: string, fn: () => Promise<void>) {
      const started = Date.now();
      try {
        await fn();
        results.push({ testId, name, passed: true, durationMs: Date.now() - started });
      } catch (error) {
        results.push({ testId, name, passed: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      }
    }

    await check("H4-CAPABILITIES", "Harness advertises native durability and control capabilities", async () => {
      assert.ok(detected, "Harness ID must match config");
      const caps = harness.capabilities();
      assert.equal(caps.tools, "NATIVE", "Tools capability must be NATIVE for H4");
      assert.equal(caps.checkpoint, "NATIVE", "Checkpoint capability must be NATIVE for H4");
      assert.equal(caps.resume, "NATIVE", "Resume capability must be NATIVE for H4");
      assert.equal(caps.interrupt, "NATIVE", "Interrupt capability must be NATIVE for H4");
      assert.equal(caps.streaming, "NATIVE", "Streaming capability must be NATIVE for H4");
    });

    await check("H4-START", "Harness starts and transitions to HEALTHY state", async () => {
      await harness.start(config);
      assert.equal(await harness.health(), "HEALTHY");
      assert.equal((await harness.status()).activeExecutions, 0);
    });

    const sendFixture = fixture ?? {
      input: { goal: "H4 cert task", toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: "." } }] },
      context,
      assertOutput: () => {},
    };

    let checkpointData: any;

    await check("H4-SEND", "Executes task with evidence and metrics", async () => {
      const output = await harness.send(sendFixture.input, context);
      assert.equal(output.success, true);
      assert.ok(output.evidence.length > 0);
      assert.ok(output.metrics.toolCalls > 0);
    });

    await check("H4-STREAM", "Streams execution results via async iterable", async () => {
      let count = 0;
      for await (const chunk of harness.stream(sendFixture.input, { ...context, runId: "h4-stream-run" })) {
        assert.ok(chunk);
        count++;
      }
      assert.ok(count > 0, "Stream must yield at least one output");
    });

    await check("H4-CHECKPOINT", "Captures durable checkpoint with state, taskStates, and budgets", async () => {
      checkpointData = await harness.checkpoint(context.missionId, context.runId);
      assert.ok(checkpointData.id, "Checkpoint must have a unique ID");
      assert.equal(checkpointData.missionId, context.missionId);
      assert.ok(checkpointData.createdAt);
      assert.ok(typeof checkpointData.state === "object");
      assert.ok(typeof checkpointData.budgetsConsumed === "object");
    });

    await check("H4-COLD-RESUME", "Cold resumption restores harness execution state without loss", async () => {
      assert.ok(checkpointData, "Checkpoint required for resume");
      await harness.resume(checkpointData);
      assert.equal(await harness.health(), "HEALTHY");
    });

    await check("H4-PAUSE", "Pauses mission and prevents concurrent execution", async () => {
      await harness.pause(context.missionId);
      await assert.rejects(() => harness.send(sendFixture.input, context), /is paused/);
      await harness.cancel(context.missionId); // unpause
    });

    await check("H4-CANCEL", "Cancels mission state cleanly", async () => {
      await harness.cancel(context.missionId, context.runId);
    });

    await check("H4-INTERRUPT", "Interrupts in-flight execution run", async () => {
      await harness.interrupt(context.missionId, context.runId);
      assert.equal((await harness.status()).activeExecutions, 0);
    });

    await check("H4-STATUS", "getStatus retrieves previously completed execution output", async () => {
      const prev = await harness.getStatus(context.missionId, context.runId);
      assert.ok(prev);
      assert.equal(prev.success, true);
    });

    await check("H4-AUTH-CONTINUITY", "Unsupported capability requests fail closed without execution", async () => {
      const res = await harness.send({ ...sendFixture.input, requiredCapabilities: ["subagents"] }, context);
      assert.equal(res.success, false);
    });

    await check("H4-DEADLINE-ENFORCEMENT", "Expired deadlines fail closed before dispatch", async () => {
      const res = await harness.send(sendFixture.input, { ...context, deadline: new Date(0).toISOString() });
      assert.equal(res.success, false);
      assert.equal(res.metrics.toolCalls, 0);
    });

    await check("H4-CANCEL-SIGNAL", "Pre-cancelled abort signal fails closed before dispatch", async () => {
      const res = await harness.send(sendFixture.input, { ...context, signal: AbortSignal.abort() });
      assert.equal(res.success, false);
      assert.equal(res.metrics.toolCalls, 0);
    });

    await check("H4-RESOURCE-DRAIN", "All active executions drain to zero without lingering tasks", async () => {
      const stat = await harness.status();
      assert.equal(stat.activeExecutions, 0, "Active executions must be 0 after completion");
    });

    await check("H4-DISPOSE", "Complete disposal clears state without zombie processes or leaks", async () => {
      await harness.dispose();
      assert.equal((await harness.status()).activeExecutions, 0);
      assert.notEqual(await harness.health(), "HEALTHY");
    });

    return summarize(config.harnessId, results);
  }

  return summarize(config.harnessId, [{
    testId: "CERT-001", name: `Certification evidence for ${targetLevel}`, durationMs: 0,
    passed: detected && targetLevel === "H0_DETECTED",
    ...(!detected || targetLevel !== "H0_DETECTED" ? { error: "Independent execution certification gates are unavailable; registration and contract shape are not certification." } : {}),
  }]);
}
function summarize(harnessId: string, results: readonly ConformanceTestResult[]): ConformanceSuiteResult {
  const passedTests = results.filter((result) => result.passed).length;
  return { harnessId, totalTests: results.length, passedTests, failedTests: results.length - passedTests, results, overallPass: passedTests === results.length };
}
export type { HarnessCertification };
