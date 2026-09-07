import { createId, now } from "../core/types.js";
import { type AgentRole } from "../organization/types.js";
import { type CouncilSession } from "./types.js";
import { type AgentCommunicationBus } from "../organization/communication.js";
import { type AgentRegistry } from "../organization/registry.js";
interface CouncilTemplate {
  topic: string;
  requiredRoles: AgentRole[];
  optionalRoles: AgentRole[];
  evidence: string[];
}

const DEFAULT_COUNCIL_TEMPLATES: CouncilTemplate[] = [
  {
    topic: "architecture",
    requiredRoles: ["architect", "software-engineer"],
    optionalRoles: ["security-engineer", "performance-engineer", "reviewer"],
    evidence: [],
  },
  {
    topic: "security",
    requiredRoles: ["security-engineer", "architect"],
    optionalRoles: ["devops-engineer", "reviewer", "software-engineer"],
    evidence: [],
  },
  {
    topic: "strategy",
    requiredRoles: ["executive-brain", "project-manager"],
    optionalRoles: ["research-engineer", "knowledge-engineer", "architect"],
    evidence: [],
  },
  {
    topic: "performance",
    requiredRoles: ["performance-engineer", "software-engineer"],
    optionalRoles: ["architect", "reviewer", "devops-engineer"],
    evidence: [],
  },
  {
    topic: "release",
    requiredRoles: ["release-engineer", "devops-engineer"],
    optionalRoles: ["project-manager", "tester", "documentation-engineer"],
    evidence: [],
  },
];

export class CouncilEngine {
  private sessions = new Map<string, CouncilSession>();

  constructor(
    private comms: AgentCommunicationBus,
    private registry: AgentRegistry,
  ) {}

  getTemplates(): CouncilTemplate[] {
    return DEFAULT_COUNCIL_TEMPLATES;
  }

  assemble(topic: string, invokedBy: string, additionalRoles: AgentRole[] = []): CouncilSession | undefined {
    const template = DEFAULT_COUNCIL_TEMPLATES.find((t) => topic.toLowerCase().includes(t.topic));
    const roles: AgentRole[] = template
      ? [...template.requiredRoles, ...template.optionalRoles.filter((r) => additionalRoles.includes(r) || additionalRoles.length === 0)]
      : ([...additionalRoles, "architect", "software-engineer", "reviewer"] as AgentRole[]);

    const participants: CouncilSession["participants"] = [];
    const seen = new Set<string>();
    for (const role of roles) {
      const agents = this.registry.findByRole(role);
      const agent = agents.find((a) => a.status === "idle" && a.config.enabled && !seen.has(a.id));
      if (agent) {
        participants.push({ agentId: agent.id, role: agent.role });
        seen.add(agent.id);
      }
    }

    if (participants.length < 2) return undefined;

    const session: CouncilSession = {
      id: createId("council"),
      topic,
      invokedBy,
      participants,
      evidence: [],
      alternatives: [],
      status: "assembling",
      createdAt: now(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  addEvidence(sessionId: string, presentedBy: string, content: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "concluded") return false;
    session.evidence.push({ presentedBy, content });
    return true;
  }

  addAlternative(sessionId: string, alternative: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "concluded") return false;
    session.alternatives.push(alternative);
    return true;
  }

  castVote(sessionId: string, agentId: string, choice: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "concluded" || session.status === "deadlocked") return false;
    const participant = session.participants.find((p) => p.agentId === agentId);
    if (!participant) return false;
    participant.vote = choice;

    session.status = "voting";

    const allVoted = session.participants.every((p) => p.vote !== undefined);
    if (allVoted) {
      this.tally(session);
    }
    return true;
  }

  conclude(sessionId: string, decisionId?: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.status = "concluded";
    session.concludedAt = now();
    if (decisionId) session.decisionId = decisionId;
    return true;
  }

  get(id: string): CouncilSession | undefined {
    return this.sessions.get(id);
  }

  getAll(): CouncilSession[] {
    return [...this.sessions.values()];
  }

  getOpen(): CouncilSession[] {
    return this.getAll().filter((s) => s.status !== "concluded" && s.status !== "deadlocked");
  }

  getStats(): { total: number; concluded: number; deadlocked: number } {
    const all = this.getAll();
    return {
      total: all.length,
      concluded: all.filter((s) => s.status === "concluded").length,
      deadlocked: all.filter((s) => s.status === "deadlocked").length,
    };
  }

  clear(): void {
    this.sessions.clear();
  }

  private tally(session: CouncilSession): void {
    const counts = new Map<string, number>();
    for (const p of session.participants) {
      if (p.vote) counts.set(p.vote, (counts.get(p.vote) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
      session.status = "deadlocked";
      return;
    }
    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      session.status = "deadlocked";
      session.recommendation = undefined;
      return;
    }
    session.recommendation = sorted[0][0];
    session.voteResult = `${sorted[0][0]} (${sorted[0][1]}/${session.participants.length} votes)`;
    session.status = "voting";
  }
}
