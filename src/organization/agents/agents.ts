import { now } from "../../core/types.js";
import { type AgentRole, type AgentInstance } from "../types.js";
import { type AgentCommunicationBus } from "../communication.js";
import { BaseAgent } from "./base-agent.js";

// ── Executive Brain ──────────────────────────────────────────────

export class ExecutiveBrainAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Project Manager ──────────────────────────────────────────────

export class ProjectManagerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Architect ────────────────────────────────────────────────────

export class ArchitectAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Planner ──────────────────────────────────────────────────────

export class PlannerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Software Engineer ────────────────────────────────────────────

export class SoftwareEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Debugger ─────────────────────────────────────────────────────

export class DebuggerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Reviewer ─────────────────────────────────────────────────────

export class ReviewerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Tester ───────────────────────────────────────────────────────

export class TesterAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Documentation Engineer ───────────────────────────────────────

export class DocumentationEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Research Engineer ────────────────────────────────────────────

export class ResearchEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Security Engineer ────────────────────────────────────────────

export class SecurityEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Performance Engineer ─────────────────────────────────────────

export class PerformanceEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── DevOps Engineer ──────────────────────────────────────────────

export class DevOpsEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Release Engineer ─────────────────────────────────────────────

export class ReleaseEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── UI/UX Engineer ───────────────────────────────────────────────

export class UiUxEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Plugin Engineer ──────────────────────────────────────────────

export class PluginEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Memory Curator ───────────────────────────────────────────────

export class MemoryCuratorAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Knowledge Engineer ───────────────────────────────────────────

export class KnowledgeEngineerAgent extends BaseAgent {
  constructor(instance: AgentInstance, comms: AgentCommunicationBus) { super(instance, comms); }

  protected async run(goal: string, context: Record<string, unknown>): Promise<unknown> {
    throw new Error(`Agent role ${this.role} has no execution implementation; execution is unsupported.`);
  }
}

// ── Agent Factory ────────────────────────────────────────────────

export function createAgent(instance: AgentInstance, comms: AgentCommunicationBus): BaseAgent {
  const agents: Record<AgentRole, new (instance: AgentInstance, comms: AgentCommunicationBus) => BaseAgent> = {
    "executive-brain": ExecutiveBrainAgent,
    "project-manager": ProjectManagerAgent,
    "architect": ArchitectAgent,
    "planner": PlannerAgent,
    "software-engineer": SoftwareEngineerAgent,
    "debugger": DebuggerAgent,
    "reviewer": ReviewerAgent,
    "tester": TesterAgent,
    "documentation-engineer": DocumentationEngineerAgent,
    "research-engineer": ResearchEngineerAgent,
    "security-engineer": SecurityEngineerAgent,
    "performance-engineer": PerformanceEngineerAgent,
    "devops-engineer": DevOpsEngineerAgent,
    "release-engineer": ReleaseEngineerAgent,
    "ui-ux-engineer": UiUxEngineerAgent,
    "plugin-engineer": PluginEngineerAgent,
    "memory-curator": MemoryCuratorAgent,
    "knowledge-engineer": KnowledgeEngineerAgent,
  };
  const AgentClass = agents[instance.role] ?? SoftwareEngineerAgent;
  return new AgentClass(instance, comms);
}
