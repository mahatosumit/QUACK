/** Shared crash-boundary types for the Phase 5 multi-process recovery harness. */
export type CrashPoint =
  | "before-ownership"
  | "after-ownership"
  | "during-heartbeat"
  | "tool-entered"
  | "after-tool-before-persist"
  | "after-receipt-before-complete";
