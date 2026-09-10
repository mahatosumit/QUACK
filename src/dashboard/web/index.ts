import { type JsonObject } from "../../core/types.js";
import { type QuackEvent } from "../../events/event-bus.js";
import { collectMetrics, type MissionTrace } from "../../harness/index.js";
import { type ApiMissionRecord } from "../../server/index.js";
import { type StoredMissionEvaluation } from "../../storage/sqlite.js";
import { type SkillRecord } from "../../skills/types.js";
import { type SpecialistAgentDefinition } from "../../agents/index.js";

export interface DashboardMissionView {
  readonly active: readonly ApiMissionRecord[];
  readonly completed: readonly ApiMissionRecord[];
  readonly failed: readonly ApiMissionRecord[];
  readonly all: readonly ApiMissionRecord[];
}

export interface DashboardAgentView {
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly trustLevel: string;
    readonly specialization: readonly string[];
    readonly executionState: "available" | "assigned";
    readonly assignedMissions: readonly string[];
  }[];
}

export interface DashboardSkillView {
  readonly skills: readonly {
    readonly id: string;
    readonly version: string;
    readonly name: string;
    readonly validationStatus: string;
    readonly executionHistory: {
      readonly useCount: number;
      readonly avgDurationMs: number;
    };
  }[];
}

export interface DashboardSecurityView {
  readonly capabilityRequests: readonly QuackEvent[];
  readonly decisions: readonly QuackEvent[];
  readonly permissionFailures: readonly QuackEvent[];
}

export interface DashboardHarnessView {
  readonly traces: readonly MissionTrace[];
  readonly evaluations: readonly StoredMissionEvaluation[];
  readonly failures: readonly QuackEvent[];
  readonly latencyMetrics: {
    readonly avgLatencyMs: number;
    readonly traceCount: number;
  };
}

export interface DashboardState {
  readonly generatedAt: string;
  readonly missions: DashboardMissionView;
  readonly agents: DashboardAgentView;
  readonly skills: DashboardSkillView;
  readonly security: DashboardSecurityView;
  readonly harness: DashboardHarnessView;
}

export function buildDashboardState(input: {
  readonly missions: readonly ApiMissionRecord[];
  readonly agents: readonly SpecialistAgentDefinition[];
  readonly skills: readonly SkillRecord[];
  readonly traces: readonly MissionTrace[];
  readonly evaluations: readonly StoredMissionEvaluation[];
  readonly events: readonly QuackEvent[];
}): DashboardState {
  const active = input.missions.filter((mission) => mission.state === "QUEUED" || mission.state === "RUNNING");
  const completed = input.missions.filter((mission) => mission.state === "COMPLETED");
  const failed = input.missions.filter((mission) => mission.state === "FAILED");
  const capabilityRequests = input.events.filter((event) => event.type === "capability.requested");
  const decisions = input.events.filter((event) => event.type === "capability.allowed" || event.type === "capability.denied");
  const permissionFailures = input.events.filter((event) =>
    event.type === "capability.denied" ||
    (event.type.endsWith(".failed") && event.payload["error"] !== undefined)
  );
  const traceMetrics = input.traces.map((trace) => collectMetrics(trace));
  const avgLatencyMs = traceMetrics.length === 0
    ? 0
    : Math.round(traceMetrics.reduce((total, metrics) => total + metrics.executionLatencyMs, 0) / traceMetrics.length);

  return {
    generatedAt: new Date().toISOString(),
    missions: {
      active,
      completed,
      failed,
      all: [...input.missions],
    },
    agents: {
      agents: input.agents.map((agent) => ({
        id: agent.identity.id,
        name: agent.identity.name,
        trustLevel: agent.trustLevel,
        specialization: [...agent.specialization],
        executionState: assignedMissions(agent, active).length > 0 ? "assigned" : "available",
        assignedMissions: assignedMissions(agent, active),
      })),
    },
    skills: {
      skills: input.skills.map((skill) => ({
        id: skill.id,
        version: skill.manifest.version,
        name: skill.manifest.name,
        validationStatus: skill.status,
        executionHistory: {
          useCount: skill.useCount,
          avgDurationMs: skill.avgDurationMs,
        },
      })),
    },
    security: {
      capabilityRequests,
      decisions,
      permissionFailures,
    },
    harness: {
      traces: [...input.traces],
      evaluations: [...input.evaluations],
      failures: input.events.filter((event) => event.type.endsWith(".failed")),
      latencyMetrics: {
        avgLatencyMs,
        traceCount: input.traces.length,
      },
    },
  };
}
function assignedMissions(agent: SpecialistAgentDefinition, active: readonly ApiMissionRecord[]): string[] {
  return active
    .filter((mission) => agent.specialization.some((term) => mission.goal.toLowerCase().includes(term.toLowerCase())))
    .map((mission) => mission.id);
}
