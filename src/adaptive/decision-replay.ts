import { createId, now } from "../core/types.js";
import type { DecisionRecord } from "./types.js";

export function createDecisionReplayEngine() {
  const decisions: DecisionRecord[] = [];
  const maxDecisions = 5000;

  function recordDecision(record: DecisionRecord): void {
    decisions.push({ ...record, id: record.id || createId("dr") });
    if (decisions.length > maxDecisions) {
      decisions.splice(0, decisions.length - maxDecisions);
    }
  }

  function getDecision(id: string): DecisionRecord | undefined {
    return decisions.find((d) => d.id === id);
  }

  function replaySession(sessionId: string): DecisionRecord[] {
    return decisions
      .filter((d) => d.sessionId === sessionId)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
  }

  function getStats(): Record<string, number> {
    const stats: Record<string, number> = { total: decisions.length };
    for (const d of decisions) {
      stats[`confidence_${Math.round(d.confidence * 10) * 10}`] =
        (stats[`confidence_${Math.round(d.confidence * 10) * 10}`] ?? 0) + 1;
    }
    return stats;
  }

  return { recordDecision, getDecision, replaySession, getStats };
}
