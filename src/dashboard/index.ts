import { type QuackSystem } from "../distributions/swe-system.js";

export interface DeveloperDashboardSnapshot {
  readonly activeMissions: readonly unknown[];
  readonly agentStatus: readonly { readonly id: string; readonly name: string; readonly trustLevel: string; readonly specialization: readonly string[] }[];
  readonly skillExecution: readonly { readonly id: string; readonly version: string; readonly status: string; readonly useCount: number }[];
  readonly capabilityDecisions: readonly unknown[];
  readonly traces: readonly unknown[];
  readonly failures: readonly unknown[];
  readonly evaluations: readonly unknown[];
}

export class DeveloperDashboard {
  private readonly capabilityDecisions: unknown[] = [];
  private readonly traces: unknown[] = [];
  private readonly failures: unknown[] = [];
  private readonly evaluations: unknown[] = [];

  constructor(private readonly system: QuackSystem) {
    system.events.onAny((event) => {
      if (event.type === "capability.allowed" || event.type === "capability.denied") this.capabilityDecisions.push(event);
      if (event.type === "trace.created") this.traces.push(event);
      if (event.type.endsWith(".failed")) this.failures.push(event);
      if (event.type === "evaluation.completed") this.evaluations.push(event);
    });
  }

  snapshot(): DeveloperDashboardSnapshot {
    return {
      activeMissions: this.system.cognitiveSystem.missionManager.getActive(),
      agentStatus: this.system.workforce.registry.list().map((agent) => ({
        id: agent.identity.id,
        name: agent.identity.name,
        trustLevel: agent.trustLevel,
        specialization: agent.specialization,
      })),
      skillExecution: this.system.skills.getAll().map((skill) => ({
        id: skill.id,
        version: skill.manifest.version,
        status: skill.status,
        useCount: skill.useCount,
      })),
      capabilityDecisions: [...this.capabilityDecisions],
      traces: [...this.traces],
      failures: [...this.failures],
      evaluations: [...this.evaluations],
    };
  }

  renderText(): string {
    const snapshot = this.snapshot();
    return [
      "QUACK Developer Dashboard",
      `Active missions: ${snapshot.activeMissions.length}`,
      `Agents: ${snapshot.agentStatus.length}`,
      `Skills: ${snapshot.skillExecution.length}`,
      `Capability decisions: ${snapshot.capabilityDecisions.length}`,
      `Traces: ${snapshot.traces.length}`,
      `Failures: ${snapshot.failures.length}`,
      `Evaluations: ${snapshot.evaluations.length}`,
    ].join("\n");
  }
}
