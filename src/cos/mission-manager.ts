import { createId, now } from "../core/types.js";
import { type MissionDefinition } from "./types.js";
import { type MissionRepository } from "../storage/sqlite.js";
import { 
  type MissionState, 
  type MissionTransitionTrigger,
  assertMissionTransition,
  legalMissionTransitions,
  missionStateFromLegacyStatus,
  legacyStatusFromMissionState,
  planMissionTransition
} from "../runtime/mission-lifecycle/mission-state-machine.js";

export type MissionActivationListener = (mission: MissionDefinition) => void;

export interface MissionTransitionEvent {
  missionId: string;
  from: MissionState;
  to: MissionState;
  trigger: MissionTransitionTrigger;
  reason?: string;
  occurredAt: string;
}

export class MissionManager {
  private readonly activationListeners = new Set<MissionActivationListener>();
  private readonly transitionListeners = new Set<(event: MissionTransitionEvent) => void>();

  constructor(private readonly repository: MissionRepository = new InMemoryMissionRepository()) {}

  create(params: { name: string; description: string; owner?: string; priority?: "critical" | "high" | "medium" | "low" }): MissionDefinition {
    const mission: MissionDefinition = {
      id: createId("mission"),
      name: params.name,
      description: params.description,
      goals: [],
      priority: params.priority ?? "medium",
      owner: params.owner ?? "organization",
      status: "draft",
      canonicalState: "CREATED",
      createdAt: now(),
    };
    this.repository.save(mission);
    return mission;
  }

  get(id: string): MissionDefinition | undefined {
    return this.repository.get(id);
  }

  getAll(): MissionDefinition[] {
    return this.repository.list();
  }

  getActive(): MissionDefinition[] {
    return this.getAll().filter((m) => m.canonicalState === "RUNNING" || m.canonicalState === "STARTING" || m.canonicalState === "WAITING" || m.canonicalState === "RECOVERING" || m.canonicalState === "BLOCKED" || m.status === "active");
  }

  activate(id: string): boolean {
      const mission = this.repository.get(id);
      if (!mission) return false;

      const currentState = mission.canonicalState ?? missionStateFromLegacyStatus(mission.status);
    
      // Legacy activate moved draft -> active (RUNNING)
      // Canonical path: CREATED -> QUEUED -> STARTING -> RUNNING
      if (currentState === "CREATED") {
        // First transition: enqueue
        let result = this.transition(id, "enqueue", "Mission queued");
        if (!result) return false;
      
        // Second transition: start (QUEUED -> STARTING)
        result = this.transition(id, "start", "Mission starting");
        if (!result) return false;
      
        // Third transition: start (STARTING -> RUNNING)
        return this.transition(id, "start", "Mission activated");
      }
    
      // For other states, try direct start transition
      return this.transition(id, "start", "Mission activated");
    }

  complete(id: string): boolean {
    return this.transition(id, "succeed", "Mission completed");
  }

  fail(id: string, reason?: string): boolean {
    return this.transition(id, "fail", reason ?? "Mission failed");
  }

  cancel(id: string, reason?: string): boolean {
    return this.transition(id, "cancel", reason ?? "Mission cancelled");
  }

  transition(id: string, trigger: MissionTransitionTrigger, reason?: string): boolean {
      const mission = this.repository.get(id);
      if (!mission) return false;

      const currentState = mission.canonicalState ?? missionStateFromLegacyStatus(mission.status);
    
      try {
              // Find the valid target state for this trigger
              const rules = legalMissionTransitions(currentState);
              const rule = rules.find((r: { trigger: MissionTransitionTrigger }) => r.trigger === trigger);
              if (!rule) {
                return false; // No valid transition for this trigger from current state
              }
      
        const transition = planMissionTransition(id, currentState, rule.to, trigger, reason);
        // Validate the transition
        assertMissionTransition(currentState, transition.to, trigger);
      
        // Apply the transition
        mission.canonicalState = transition.to;
        mission.status = legacyStatusFromMissionState(transition.to);
        if (transition.to === "SUCCEEDED" || transition.to === "FAILED" || transition.to === "CANCELLED" || transition.to === "TIMED_OUT") {
          mission.completedAt = now();
        }
      
        this.repository.save(mission);
      
      // Notify transition listeners
      const event: MissionTransitionEvent = {
        missionId: id,
        from: currentState,
        to: transition.to,
        trigger,
        reason,
        occurredAt: transition.occurredAt,
      };
      for (const listener of this.transitionListeners) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
      
      // Legacy activation notification - only for RUNNING to match legacy behavior
            if (transition.to === "RUNNING") {
              for (const listener of this.activationListeners) {
                try {
                  listener({ ...mission, goals: [...mission.goals] });
                } catch {
                  // Ignore listener errors
                }
              }
            }
      
      return true;
    } catch {
      return false;
    }
  }

  onActivate(listener: MissionActivationListener): () => void {
    this.activationListeners.add(listener);
    return () => this.activationListeners.delete(listener);
  }

  onTransition(listener: (event: MissionTransitionEvent) => void): () => void {
    this.transitionListeners.add(listener);
    return () => this.transitionListeners.delete(listener);
  }

  addGoal(missionId: string, goalId: string): boolean {
    const mission = this.repository.get(missionId);
    if (!mission) return false;
    if (!mission.goals.includes(goalId)) mission.goals.push(goalId);
    this.repository.save(mission);
    return true;
  }

  getStats(): { total: number; active: number; completed: number; failed: number } {
    const all = this.getAll();
    return {
      total: all.length,
      active: all.filter((m) => m.canonicalState === "RUNNING" || m.canonicalState === "STARTING" || m.canonicalState === "WAITING" || m.canonicalState === "RECOVERING" || m.canonicalState === "BLOCKED" || m.status === "active").length,
      completed: all.filter((m) => m.canonicalState === "SUCCEEDED" || m.status === "completed").length,
      failed: all.filter((m) => m.canonicalState === "FAILED" || m.canonicalState === "CANCELLED" || m.canonicalState === "TIMED_OUT" || m.status === "failed").length,
    };
  }

  clear(): void {
    this.repository.clear();
  }
}

export class InMemoryMissionRepository implements MissionRepository {
  private readonly missions = new Map<string, MissionDefinition>();

  save(mission: MissionDefinition): MissionDefinition {
    const stored = cloneMission(mission);
    this.missions.set(stored.id, stored);
    return cloneMission(stored);
  }

  get(id: string): MissionDefinition | undefined {
    const mission = this.missions.get(id);
    return mission ? cloneMission(mission) : undefined;
  }

  list(): MissionDefinition[] {
    return [...this.missions.values()].map(cloneMission);
  }

  clear(): void {
    this.missions.clear();
  }
}

function cloneMission(mission: MissionDefinition): MissionDefinition {
  return { ...mission, goals: [...mission.goals] };
}
