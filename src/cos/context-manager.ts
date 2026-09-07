import { createId, now } from "../core/types.js";
import { type ContextFrame } from "./types.js";
import { type GoalManager } from "./goal-manager.js";
import { type DecisionEngine } from "./decision-engine.js";
import { type ExperienceEngine } from "./experience-engine.js";
import { type AgentRegistry } from "../organization/registry.js";

export class ContextManager {
  private frames = new Map<string, ContextFrame>();
  private attentionStack: string[] = [];

  constructor(
    private goalManager: GoalManager,
    private decisionEngine: DecisionEngine,
    private experienceEngine: ExperienceEngine,
    private registry: AgentRegistry,
  ) {}

  buildFrame(): ContextFrame {
    const activeGoals = this.goalManager.getActive();
    const recentDecisions = this.decisionEngine.getAll().slice(-5);
    const agents = this.registry.getAll();
    const contextWords = [
      ...activeGoals.flatMap((g) => [g.mission, ...g.objectives, ...g.knowledgeTags]),
      ...recentDecisions.flatMap((d) => [d.problem, ...d.tags]),
    ];
    const relevantExperiences = this.experienceEngine.recommend(contextWords, 3);

    const frame: ContextFrame = {
      id: createId("ctx"),
      activeGoalIds: activeGoals.map((g) => g.id),
      recentDecisions: recentDecisions.map((d) => d.id),
      currentWorkload: agents.map((a) => ({ agentId: a.id, load: a.currentTaskIds.length })),
      environmentState: { agentCount: agents.length, goalCount: activeGoals.length },
      relevantExperiences: relevantExperiences.map((e) => e.id),
      attention: [...this.attentionStack],
      createdAt: now(),
    };
    this.frames.set(frame.id, frame);
    return frame;
  }

  getFrame(id: string): ContextFrame | undefined {
    return this.frames.get(id);
  }

  getLatestFrame(): ContextFrame | undefined {
    return [...this.frames.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).pop();
  }

  setAttention(goalId: string): void {
    if (!this.attentionStack.includes(goalId)) {
      this.attentionStack.push(goalId);
    }
    if (this.attentionStack.length > 10) this.attentionStack.shift();
  }

  getAttention(): string[] {
    return [...this.attentionStack];
  }

  clearAttention(): void {
    this.attentionStack = [];
  }

  clear(): void {
    this.frames.clear();
    this.attentionStack = [];
  }
}
