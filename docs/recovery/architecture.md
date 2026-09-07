# Recovery Architecture

Status: single-process SUPPORTED (verified); multi-process UNSUPPORTED.

ADRs: [0028](../adr/0028-interrupted-mission-recovery.md),
[0031](../adr/0031-multi-process-recovery-unsupported.md)

## Canonical path

```text
QuackRuntime.resumeMission
→ SessionRuntime (sole checkpoint owner)
→ assertRecoveryCheckpoint
→ DefaultLoopDriver
```

Authoritative state during recovery: the checkpoint's `recovery` block
(identity, status, invocation journal, memory writes, evidence,
verification) plus the durable task record.

## Stores (JSON, per ADR 0031 analysis)

| Store | Role |
| --- | --- |
| `JsonFileTaskStore` | durable task records + execution identity |
| `JsonFileCheckpointStore` | versioned execution checkpoints |
| `JsonFileJournalStore` | invocation journal (STARTED → COMPLETED/FAILED) |

Each: caches the file once per process, serializes writes per instance
(in-process only), persists by atomic tmp+rename. There is **no
cross-process exclusion** in these stores.

## What is verified

- Real child-process SIGKILL crashes at seven boundaries (planning,
  planned, node-started, tool-entered, acknowledged, verifying,
  finalizing); each resumes to completion exactly once.
- Retry-safety classes: retry-safe acknowledged failures retry with fresh
  attempts; ambiguous non-idempotent state → `BLOCKED` +
  `recovery.reconciliation_required`.
- Metadata/capability revalidation before replay; foreign evidence and
  receipts rejected; terminal missions return stored results; malformed
  checkpoint budgets rejected; unsupported checkpoint versions rejected;
  `dataDir` contract enforced; single-process duplicate ownership →
  `recovery.busy`.

## What is NOT supported

- Multi-process recovery (see `multi-process-recovery.md`).
- Automatic replay of ambiguous non-idempotent effects.
- `QuackRuntimeV1.resume` (declared contract member, unimplemented).
