# Continuous Benchmarking Strategy

QUACK OS strictly follows the rule: **Never optimize without evidence.**

## Metrics Tracked

1. **Startup Latency**: Time from `QuackRuntime.create()` to the `EventBus` accepting events. Target: < 100ms.
2. **Event Loop Lag**: Node.js event loop blocking duration during heavy operations (e.g., AST patching, Graph indexing). Target: Max blocking 15ms per tick.
3. **Memory Consumption**: Heap usage during deep recursive DAG workflows. Target: Flat line (no leaks), constrained by LRU bound.
4. **I/O Throughput**: Time taken to flush `JsonFileCheckpointStore`.

## CI Pipeline
Benchmarks must be run on every PR modifying `src/engine`, `src/intelligence`, or `src/memory`. 

```bash
npm run benchmark
```

If a PR causes a >5% regression in Event Loop Lag or Startup Latency, it will be automatically blocked by the CI.
