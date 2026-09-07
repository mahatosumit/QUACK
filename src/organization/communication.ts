import { createId, now } from "../core/types.js";
import {
  type AgentMessage,
  type MessageType,
  type AgentPriority,
  type VoteRequest,
  type NegotiationRequest,
} from "./types.js";

export class AgentCommunicationBus {
  private messages = new Map<string, AgentMessage>();
  private threads = new Map<string, AgentMessage[]>();
  private pendingResponses = new Map<string, (msg: AgentMessage) => void>();
  private voteRequests = new Map<string, VoteRequest>();
  private negotiations = new Map<string, NegotiationRequest>();
  private subscriptions = new Map<string, Set<(msg: AgentMessage) => void>>();

  send(msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage {
    const full: AgentMessage = {
      ...msg,
      id: createId("msg"),
      timestamp: now(),
    };
    this.messages.set(full.id, full);
    if (this.messages.size > 5000) {
      const firstKey = this.messages.keys().next().value;
      if (firstKey) this.messages.delete(firstKey);
    }

    if (full.threadId) {
      if (!this.threads.has(full.threadId)) {
        this.threads.set(full.threadId, []);
        if (this.threads.size > 1000) {
          const firstKey = this.threads.keys().next().value;
          if (firstKey) this.threads.delete(firstKey);
        }
      }
      this.threads.get(full.threadId)!.push(full);
    }

    const recipients = typeof full.to === "string" ? [full.to] : full.to;
    for (const recipient of recipients) {
      const subs = this.subscriptions.get(recipient);
      if (subs) {
        for (const handler of subs) {
          handler(full);
        }
      }
    }

    const responder = this.pendingResponses.get(full.id);
    if (responder) {
      responder(full);
      this.pendingResponses.delete(full.id);
    }

    return full;
  }

  request(from: string, to: string, topic: string, payload: unknown, priority: AgentPriority = "medium"): AgentMessage {
    return this.send({
      type: "request",
      from,
      to,
      payload,
      priority,
      requiresResponse: true,
      responseTimeoutMs: 30000,
      metadata: { topic },
    });
  }

  reply(original: AgentMessage, from: string, payload: unknown): AgentMessage {
    return this.send({
      type: "reply",
      from,
      to: original.from,
      threadId: original.threadId ?? original.id,
      payload,
      priority: original.priority,
      requiresResponse: false,
    });
  }

  delegate(from: string, to: string, taskId: string, goal: string, payload: unknown): AgentMessage {
    return this.send({
      type: "delegate",
      from,
      to,
      payload: { taskId, goal, ...(payload as Record<string, unknown>) },
      priority: "high",
      requiresResponse: true,
      responseTimeoutMs: 60000,
      metadata: { taskId, delegation: true },
    });
  }

  broadcast(from: string, topic: string, payload: unknown): void {
    this.send({
      type: "broadcast",
      from,
      to: [],
      payload: { topic, ...(payload as Record<string, unknown>) },
      priority: "low",
      requiresResponse: false,
      metadata: { broadcast: true },
    });
  }

  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, new Set());
    }
    this.subscriptions.get(agentId)!.add(handler);
    return () => this.subscriptions.get(agentId)?.delete(handler);
  }

  getThread(threadId: string): AgentMessage[] {
    return this.threads.get(threadId) ?? [];
  }

  getMessage(id: string): AgentMessage | undefined {
    return this.messages.get(id);
  }

  getMessagesFor(agentId: string): AgentMessage[] {
    return [...this.messages.values()].filter(
      (m) => m.to === agentId || (Array.isArray(m.to) && m.to.includes(agentId)),
    );
  }

  // ── Voting ────────────────────────────────────────────────────

  createVote(topic: string, options: string[], voters: string[], deadlineMs = 60000): VoteRequest {
    const vote: VoteRequest = {
      id: createId("vote"),
      topic,
      options,
      voters,
      deadline: new Date(Date.now() + deadlineMs).toISOString(),
      status: "open",
      results: {},
    };
    this.voteRequests.set(vote.id, vote);
    if (this.voteRequests.size > 1000) {
      const firstKey = this.voteRequests.keys().next().value;
      if (firstKey) this.voteRequests.delete(firstKey);
    }
    return vote;
  }

  castVote(voteId: string, voter: string, choice: string): boolean {
    const vote = this.voteRequests.get(voteId);
    if (!vote || vote.status !== "open") return false;
    if (!vote.voters.includes(voter)) return false;
    if (!vote.options.includes(choice)) return false;
    vote.results![voter] = choice;
    return true;
  }

  tallyVote(voteId: string): string | undefined {
    const vote = this.voteRequests.get(voteId);
    if (!vote) return undefined;
    const counts = new Map<string, number>();
    for (const choice of Object.values(vote.results ?? {})) {
      counts.set(choice, (counts.get(choice) ?? 0) + 1);
    }
    if (counts.size === 0) {
      vote.status = "closed";
      return undefined;
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      vote.status = "tied";
      return undefined;
    }
    vote.status = "closed";
    return sorted[0][0];
  }

  // ── Negotiation ───────────────────────────────────────────────

  createNegotiation(initiator: string, participants: string[], topic: string, context: Record<string, unknown>): NegotiationRequest {
    const negotiation: NegotiationRequest = {
      id: createId("nego"),
      initiator,
      participants,
      topic,
      context,
      status: "open",
      proposals: [],
    };
    this.negotiations.set(negotiation.id, negotiation);
    if (this.negotiations.size > 1000) {
      const firstKey = this.negotiations.keys().next().value;
      if (firstKey) this.negotiations.delete(firstKey);
    }
    return negotiation;
  }

  propose(negotiationId: string, proposer: string, proposal: string): boolean {
    const n = this.negotiations.get(negotiationId);
    if (!n || n.status !== "open") return false;
    if (!n.participants.includes(proposer)) return false;
    n.proposals = [...n.proposals, proposal];
    return true;
  }

  agree(negotiationId: string, proposal: string): boolean {
    const n = this.negotiations.get(negotiationId);
    if (!n || n.status !== "open") return false;
    n.status = "agreed";
    n.agreedProposal = proposal;
    return true;
  }

  deadlock(negotiationId: string): boolean {
    const n = this.negotiations.get(negotiationId);
    if (!n) return false;
    n.status = "deadlocked";
    return true;
  }

  // ── Stats ─────────────────────────────────────────────────────

  getStats(): { totalMessages: number; activeVotes: number; activeNegotiations: number } {
    return {
      totalMessages: this.messages.size,
      activeVotes: [...this.voteRequests.values()].filter((v) => v.status === "open").length,
      activeNegotiations: [...this.negotiations.values()].filter((n) => n.status === "open").length,
    };
  }

  clear(): void {
    this.messages.clear();
    this.threads.clear();
    this.pendingResponses.clear();
    this.voteRequests.clear();
    this.negotiations.clear();
    this.subscriptions.clear();
  }
}
