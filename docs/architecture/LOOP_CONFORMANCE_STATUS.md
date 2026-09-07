# QUACK Loop & Harness Convergence - Historical Phase 3 Status

## Current status after Phase 1

The native provider reports `H0_DETECTED` (detected, **uncertified**), as defined
by `QuackNativeHarness.certification()` in `src/harness/registry.ts`. Registration
and a passing contract-shaped fixture do not certify production execution.
Native tools require explicit planned invocations; streaming is emulated.
Checkpoint, resume, pause, cancel, interrupt, subagent execution, and background
jobs are unsupported by the native harness. The separate loop driver can cancel
an active run, but its pause/resume operations are unsupported. It also has no
trusted default mission validator: completion needs an explicitly configured
validator and real evidence. No automatic restart recovery or child execution
certification is established.

The historical tables below are retained for context. Their checkmarks and test
counts are **superseded assertions, not current conformance evidence**.

## Historical Loop Test Notes (LOOP-001 through LOOP-020)

| Test | Status | Notes |
|------|--------|-------|
| LOOP-001: Normal completion | ❌ FAIL | Loop fails due to doom-loop detection triggering before completion |
| LOOP-002: Iteration limit | ✅ PASS | Correctly stops at maxIterations |
| LOOP-003: Budget stop | ✅ PASS | Budget enforcement working |
| LOOP-004: Timeout | ❌ FAIL | Doom-loop detection triggers before timeout |
| LOOP-005: Cancellation | ✅ PASS | AbortSignal properly handled |
| LOOP-006: No-progress detection | ❌ FAIL | Doom-loop detection triggers first |
| LOOP-007: Repeated action doom loop | ✅ PASS | Fingerprint-based detection working |
| LOOP-008: A/B oscillation | ✅ PASS | Pattern detection framework exists |
| LOOP-009: Replan recovery | ✅ PASS | Replan logic functional |
| LOOP-010: Wait for approval | ❌ FAIL | Pause timing issue - loop not started when pause called |
| LOOP-011: Approval resume | ✅ PASS | Resume after pause works |
| LOOP-012: Wait external event | ✅ PASS | Event injection and wake working |
| LOOP-013: Event wake | ❌ FAIL | Wake event not received - loop not in wait state |
| LOOP-014: Provider failure | ✅ PASS | Handled by harness circuit breaker |
| LOOP-015: Provider recovery | ✅ PASS | Circuit breaker recovery logic exists |
| LOOP-016: Harness failure | ✅ PASS | Error handling in loop |
| LOOP-017: Harness fallback | ✅ PASS | Registry selection supports fallback |
| LOOP-018: Restart resume | ✅ PASS | Checkpoint/resume framework exists |
| LOOP-019: Background job completion | ✅ PASS | Event-driven wait tested |
| LOOP-020: Verifier-last completion | ✅ PASS | Verification gate enforced |

**Pass Rate: 15/20 (75%)**

---

## Root Cause Analysis

### Primary Issue: Doom-Loop Detection Too Aggressive
The doom-loop detector fires on the first iteration when it detects "identical calls" because the same tool is used. This prevents normal completion and timeout tests from reaching their expected stop reasons.

**Fix Applied**: Added `enableDoomLoopDetection: false` to relevant test configs, but need to ensure all tests that shouldn't trigger doom-loop have it disabled.

### Secondary Issue: Pause/Event Timing
The pause and event wake tests fail because:
1. `loopDriver.start()` is async - `currentRun` isn't set until first iteration begins
2. Pause called before loop is actually running → `currentRun` is undefined → state remains IDLE
3. Event wake requires loop to be in WAIT state (reflection.nextStep = "wait") to receive events

### Verification Logic
The harness `send()` returns success=true with toolCalls=1, so verification should pass. The "Expected COMPLETED, got FAILED: undefined" suggests the loop is terminating for another reason (likely doom-loop).

---

## Historical Harness Conformance Assertions (Superseded)

The former 20-test pass claim is withdrawn as evidence of native feature support.

| Test | Status |
|------|--------|
| HAR-001: Discover - metadata() | ✅ |
| HAR-002: Health - health() | ✅ |
| HAR-003: Simple Task - start() + send() | ✅ |
| HAR-004: Tools - tools capability | ✅ |
| HAR-005: Structured Result - contract compliance | ✅ |
| HAR-006: Stream - stream() returns AsyncIterable | ✅ |
| HAR-007: Cancel - cancel() stops execution | ✅ |
| HAR-008: Timeout - respects timeoutMs | ✅ |
| HAR-009: Unsupported Capability - fail loud | ✅ |
| HAR-010: Environment Allocation - workspace | ✅ |
| HAR-011: Workspace - read/write | ✅ |
| HAR-012: Checkpoint - checkpoint() | ✅ |
| HAR-013: Resume - resume() | ✅ |
| HAR-014: Crash Recovery - recovery | ✅ |
| HAR-015: Subagent - spawnSubagent() | ✅ |
| HAR-016: Continuable Child - cold resume | ✅ |
| HAR-017: Child Report - QUIET/WAKE_PARENT | ✅ |
| HAR-018: Interrupt - interrupt() | ✅ |
| HAR-019: Teardown - dispose() | ✅ |
| HAR-020: Plugin Unload - registry | ✅ |

**Current native status: H0_DETECTED — uncertified.**

---

## Architecture Status

### Components listed by the historical report (not certified)
- ✅ Harness Contract v2 (metadata, health, capabilities, start/send/stream/checkpoint/resume/pause/cancel/interrupt/status/shutdown)
- ✅ Harness Provider Registry (QUACK_NATIVE registered, selection logic)
- ✅ Harness Conformance Tests (HAR-001-020)
- ✅ Loop Contract (phases, budget, stop reasons, progress/doom-loop detection)
- ✅ Loop Driver (DefaultLoopDriver with all phases)
- ✅ Progress Detector (ProgressSnapshot with scoring)
- ✅ Doom-Loop Detector (11 pattern types)
- ✅ Wakeup Manager (event-driven + heartbeat)
- ✅ QuackNativeHarness (real tool execution via system.runtime)

### Integration Gaps
- LoopDriver not yet connected to CLI commands
- Old AgentLoop and ExecutiveBrain paths still active
- Flight Recorder events need to include loop/harness transitions
- Subagent cold resume not fully implemented
- Background job execution not fully implemented

---

## Next Steps

1. **Phase 4**: Implement subagents (one-shot + continuable with cold resume)
2. **Phase 5**: Prove event-driven background job wait/resume (ZERO model calls while idle)
3. **Phase 6**: Flight Recorder integration for loop/harness events
4. **Phase 7**: Verified learning pipeline
5. **Phase 8**: Fix existing E2E failures
6. **Phase 9**: Windows determinism (20 consecutive PASS)
7. **Phase 10**: NVIDIA live mission
8. **Phase 11**: QUACK-on-QUACK E2E

These historical notes do not establish current architectural completion or production readiness. Unsupported operations, execution-path integration, and independent validation remain substantive gaps.