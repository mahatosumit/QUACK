# QUACK Solo Production Performance Report

Measurement date: 2026-08-15. Host: Windows 10.0.26200 x64, Node v24.15.0,
AMD Ryzen 7 7435HS (16 logical cores), 23.7 GB RAM, NVIDIA GeForce RTX 4060
Laptop GPU (8188 MiB VRAM). These are local measurements, not clean-machine or
cross-platform certification.

## Measured release paths

| Metric | Result | Gate |
|---|---:|---|
| Control Room server ready | 1,193.72 ms | PASS, target < 5 s |
| Idle working set after startup | 153.35 MB | PASS, target < 1 GB |
| Idle CPU sample (3 s, one-core scale) | 0.00% | PASS, target < 3% |
| Local `/health` p50, 30 sequential | 0.41 ms | PASS |
| Local `/health` p95, 30 sequential | 0.94 ms | PASS, target < 200 ms |
| Local `/health` max | 1.44 ms | PASS |
| Regression suite | 89.929 s | 1,093 passed |
| Browser E2E assertion time | 3.386 s | 1 passed |
| Unsigned portable ZIP | 7.68 MB | Informational |

The repository benchmark measured:

| Microbenchmark | Result |
|---|---:|
| In-process cold system construction | 17.19 ms |
| In-process warm system construction | 3.58 ms |
| Synthetic workspace scan | 0.07 ms |
| Intelligence router | 0.21 ms |
| Memory retrieval | 2.85 ms |
| DAG scheduling | 0.19 ms |

Raw microbenchmark results are stored in `benchmarks/benchmark-latest.json`.
They do not represent provider inference or end-to-end mission latency.

## Blocked or not measured

```text
RENDER_FPS=NOT_MEASURED
SUSTAINED_CONCURRENCY=NOT_MEASURED
CANCELLATION_LATENCY_UNDER_LOAD=NOT_MEASURED
PROVIDER_FAILOVER_UNDER_LOAD=NOT_MEASURED
LONG_DURATION_MEMORY_GROWTH=NOT_MEASURED
OLLAMA_LATENCY=BLOCKED_NOT_INSTALLED
NVIDIA_LATENCY=BLOCKED_BY_SECRET_VISIBILITY
REAL_PROVIDER_MISSION_OVERHEAD=NOT_MEASURED
CLEAN_VM_PACKAGED_STARTUP=NOT_MEASURED
```

Measured solo thresholds pass. The broader performance certification remains
partial and contributes to the final `NOT_READY` decision.
