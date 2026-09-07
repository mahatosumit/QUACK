# Harness Engineering

The Harness Engineering layer measures QUACK mission execution without taking control of the runtime. It observes event bus traffic and loop results, then produces mission traces, metrics, evaluations, replay comparisons, and benchmark scenarios.

## Execution support and certification

The trace/evaluation utilities described here are separate from the native execution
harness. The native provider is `H0_DETECTED` (uncertified), executes explicit
planned tool invocations, and emulates streaming. Its subagent, background-job,
checkpoint, resume, pause, cancel, and interrupt operations are unsupported. The
loop driver has no trusted default mission validator; observing tool success or
scoring a trace is not independent proof that the mission is complete. See
[Current conformance status](architecture/LOOP_CONFORMANCE_STATUS.md).

## Components

- `TraceRecorder`: captures mission input, generated plans, selected skills, capability events, tools executed, verification results, loop iterations, and final outcome.
- `MetricsCollector`: calculates task success rate, tool failure rate, capability violations, recovery attempts, execution latency, iteration count, tool call count, and capability check count.
- `MissionEvaluator`: evaluates a trace and emits `evaluation.started` / `evaluation.completed`.
- `ReplayEngine`: compares deterministic execution signatures from prior traces against replayed or newly captured traces.
- `benchmarkScenarios`: named scenario definitions for file creation, coding, failed tool recovery, and denied capability requests.

## Tracing

Attach a recorder to the event bus before mission execution:

```ts
const harness = createHarness({ eventBus });
const detach = harness.traceRecorder.attach();
const loopResult = await agentLoop.start({ missionId, goal });
const trace = await harness.traceRecorder.createTrace({
  missionInput: { missionId, goal },
  loopResult,
});
detach();
```

`trace.created` is emitted after the trace is materialized. The trace contains the evidence emitted by the instrumented path. Completeness depends on event coverage; the recorder does not itself validate the mission or mutate runtime, planner, skill, capability, or tool behavior.

## Evaluation

Use the synchronous API for direct scoring:

```ts
const result = evaluateMission(trace);
```

Use the class API when event emission is required:

```ts
const result = await harness.evaluator.evaluateMission(trace);
```

The result shape is:

```ts
{
  success,
  score,
  failures,
  improvements,
  metrics
}
```

## Replay

Replay compares deterministic execution signatures:

- mission goal
- plan strategies
- selected actions
- tools and success/failure outcomes
- verification decisions
- final outcome

Given only a previous trace, replay compares that trace with itself. Given an expected and actual trace, it compares their signatures and reports mismatches. It does not execute tools, reconstruct a run, or prove restart recovery.

## Benchmarks

Scenario fixtures live in `tests/harness/scenarios/` and the TypeScript scenario catalog is exported from `src/harness/scenarios.ts`.

The v1 scenarios are:

- file creation mission
- coding mission
- failed tool recovery
- denied capability request

These scenarios define benchmark intent and expected surfaces. They are designed for deterministic harness tests first, with future runners able to execute them against sandboxed skill/runtime environments.

## Test coverage and its limits

Tests named for production completion use real system composition for runtime and API/agent-loop paths. External boundaries use injected deterministic providers and research executors. The suite additionally exercises the existing self-modification controller's isolated worktree, human-approval, merge, post-merge verification, and revert-based rollback paths.

These test names do not certify production readiness. Adaptive experiment execution, knowledge distillation, and automatic improvement are unsupported without configured executors; trace collection is not evidence that learning ran.

The improvement-bridge harness adds explicit checks that an eligible actionable review creates a persisted `PROPOSED` record and `proposal.awaiting_approval` event, while the source file and tool call count remain unchanged. It also covers vague/non-code rejection, approval and rejection gates, the improvement-origin recursion guard, and containment of improvement-cycle failures. The isolated-worktree and rollback integration harnesses remain the authority for approved candidate execution and failed post-merge verification.
