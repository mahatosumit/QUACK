# ADR 0033: Completion Receipts from the Durable Evidence Chain

## Status

Accepted — 2026-09-06

## Context

The evaluated-completion gate (2026-09-05) hardened validation: validators
receive a separate workflow-state snapshot, and malformed, misattributed,
invented, duplicate, or empty evidence citations fail closed. The checkpoint
already durably stores host-created evidence and the verification record
bound to it, and `assertRecoveryCheckpoint` rejects foreign, stale, or
mismatched evidence and receipts (ADR 0028).

The remaining gap was explainability: a COMPLETED mission's task result
carried a summary but no explicit, citable proof chain. There was no single
artifact a consumer could inspect to see mission → execution → workflow →
evidence → verification → completion.

## Decision

`src/engine/completion-receipt.ts` defines `CompletionReceiptV1`, the
derived proof chain for a completed durable mission:

- execution identity (mission, execution/task, session, workflow)
- summary
- cited evidence id plus a deterministic sha-256 digest of the bound evidence
  payload (id, mission, execution, kind, timestamp, source, data, redactions)
- verifier, verification status, verification record id, verified-at
- `independent: true` marker

The receipt is **derived output, not a second source of truth**. The versioned
execution checkpoint remains authoritative for execution state, invocation
outcomes, evidence, and verification; the receipt cites those artifacts by
identity and digest.

### Minting rules (fail closed)

`buildCompletionReceipt` rejects:

- missing summary
- unsuccessful verification
- verification that does not cite the supplied evidence
- evidence bound to a different mission or execution
- foreign, non-passing, or unciting verification records

`assertCompletionReceipt` rejects receipts whose identity does not match the
execution identity, whose verification status is not `PASSED`, whose digest
is malformed, or whose verified-at precedes the evidence creation time
(stale/forged chains).

### Runtime wiring

`QuackRuntime` mints a receipt only for durable executions with a
`durableRecoveryEnabled` checkpoint that stored evidence and verification. The
receipt is loaded from the checkpoint's stored chain, validated, snapshotted
via `receiptSnapshot`, and attached to the completed task's `result.receipt`.
Non-durable executions never mint a receipt — there is no durable evidence
chain to cite — while their completion still requires loop-driver
verification success, unchanged.

## Consequences

- A completed durable mission is explainable end to end:
  mission → execution → workflow state → evidence → verification → receipt.
- Forged or mismatched evidence cannot produce a receipt: the minter and the
  validator both fail closed, and the receipt digest binds the exact cited
  evidence payload.
- No new persistence artifact or ledger was introduced; the checkpoint stays
  the single durable authority.
- Receipts for non-durable executions are explicitly unsupported.

## Verification

- `src/engine/completion-receipt.test.ts` (9 tests): minting with full chain
  citation; fail-closed on unsuccessful verification, foreign evidence
  citation, foreign evidence identity, foreign/failed verification record;
  forged/foreign/stale receipt rejection; digest determinism and payload
  sensitivity; JSON-safe snapshot.
- `src/runtime/completion-receipt-runtime.test.ts` (2 tests): a real durable
  mission completes with a receipt whose evidenceId and verificationId match
  the checkpoint-stored chain; a non-durable completion mints no receipt.
- Full repository suite: 1,317 ordinary tests + 17 serial tests, 0 failures;
  root and SDK typechecks, build, and lint pass.