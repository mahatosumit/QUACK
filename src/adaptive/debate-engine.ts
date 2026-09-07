import { createId, now } from "../core/types.js";
import type { DebateSession, DebateArgument } from "./types.js";

export function createDebateEngine() {
  const sessions = new Map<string, DebateSession>();

  function createSession(topic: string): DebateSession {
    const session: DebateSession = {
      id: createId("deb"),
      topic,
      arguments: [],
      votes: {},
      consensus: null,
      minorityReport: null,
      decision: null,
      createdAt: now(),
      resolvedAt: null,
    };
    sessions.set(session.id, session);
    return session;
  }

  function addArgument(sessionId: string, argument: DebateArgument): void {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Debate session ${sessionId} not found`);
    session.arguments.push(argument);
  }

  function castVote(sessionId: string, agentId: string, choice: string): void {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Debate session ${sessionId} not found`);
    session.votes[agentId] = choice;
  }

  function resolve(sessionId: string): DebateSession {
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Debate session ${sessionId} not found`);
    if (session.arguments.length === 0) {
      session.consensus = "No arguments presented";
      session.resolvedAt = now();
      return session;
    }

    const voteCounts: Record<string, number> = {};
    for (const vote of Object.values(session.votes)) {
      voteCounts[vote] = (voteCounts[vote] ?? 0) + 1;
    }

    let maxVotes = 0;
    let consensus: string | null = null;
    for (const [choice, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        consensus = choice;
      }
    }

    if (consensus) {
      session.consensus = consensus;
      const forArgs = session.arguments.filter((a) => a.position === "for");
      const againstArgs = session.arguments.filter((a) => a.position === "against");
      const minority = session.arguments.filter((a) => a.position !== consensus);
      if (minority.length > 0) {
        session.minorityReport = minority
          .map((a) => `${a.agentId} (${a.role}): ${a.claim} [confidence: ${a.confidence}]`)
          .join("\n");
      }
      session.decision = consensus;
    } else {
      session.consensus = "No consensus reached — further debate required";
    }

    session.resolvedAt = now();
    return session;
  }

  function getSession(sessionId: string): DebateSession | undefined {
    return sessions.get(sessionId);
  }

  function listSessions(): DebateSession[] {
    return Array.from(sessions.values());
  }

  return { createSession, addArgument, castVote, resolve, getSession, listSessions };
}
