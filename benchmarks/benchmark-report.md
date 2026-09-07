# QUACK Local Microcheck Report

**Date:** 2026-09-04T02:58:01.940Z
**Environment:** Node v24.19.0 on win32 (x64)
**Samples:** One observation per operation, using isolated temporary state.
**Routing:** unsupported: no eligible model registered

| Operation | Observed duration (ms) |
|---|---|
| System construction (first) | 8.86 |
| System construction (repeat) | 2.28 |
| In-memory workspace registration | 0.03 |
| Model routing selection | Not measured (unsupported) |
| Empty fixture memory retrieval | 157.12 |
| Four-node DAG construction | 0.26 |

- Single-process local observations, not production certification or a comparative baseline.
- No model inference, workspace indexing, or workflow scheduling was measured.
- Unavailable routing is reported as null rather than a successful latency measurement.
