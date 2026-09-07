import { type LoopResult } from "../agent-loop/contract.js";
import { now } from "../core/types.js";
import { type MissionEvaluationResult, type MissionTrace } from "../harness/index.js";
import { type QuackSystem } from "../distributions/swe-system.js";

export interface MissionSubmission {
  readonly missionId?: string;
  readonly goal: string;
  readonly actor?: string;
}

export interface MissionStatus {
  readonly missionId?: string;
  readonly loopId: string;
  readonly state: string;
  readonly iterations: number;
  readonly error?: string;
}

export class QuackApi {
  private readonly missions = new Map<string, LoopResult>();
  private readonly traces = new Map<string, MissionTrace>();
  private readonly evaluations = new Map<string, MissionEvaluationResult>();
  private system: QuackSystem | undefined;

  constructor(system?: QuackSystem) {
    this.system = system;
  }

  setSystem(system: QuackSystem): void {
    this.system = system;
  }

  private getSystem(): QuackSystem {
    if (!this.system) throw new Error("QuackApi system not initialized");
    return this.system;
  }

  async submitMission(input: MissionSubmission): Promise<MissionStatus> {
    const system = this.getSystem();
    const task = await system.runtime.submitGoal(input.goal, input.actor ?? "api", { missionId: input.missionId, origin: "api" });
    if (!task.ok) throw Object.assign(new Error(task.error.message), { code: task.error.code });
    const loopResult = system.runtime.getLoopResult(task.data.id);
    if (!loopResult) throw new Error(String(task.data.error?.message ?? "Mission was not admitted to a runtime session."));
    const trace = await system.harness.traceRecorder.createTrace({
      missionInput: { missionId: input.missionId, goal: input.goal, actor: input.actor ?? "api" }, loopResult,
    });
    const evaluation = await system.harness.evaluator.evaluateMission(trace);
    await system.storage.traces.save(trace, { lookupId: loopResult.runId });
    await system.storage.evaluations.save({ id: loopResult.runId, traceId: trace.id, missionId: input.missionId, result: evaluation, createdAt: now() });
    this.missions.set(loopResult.runId, loopResult);
    this.traces.set(loopResult.runId, trace);
    this.evaluations.set(loopResult.runId, evaluation);
    return this.statusFromResult(loopResult);
  }

  getStatus(loopId: string): MissionStatus | undefined {
    const result = this.missions.get(loopId);
    return result ? this.statusFromResult(result) : undefined;
  }

  getTrace(loopId: string): MissionTrace | undefined {
    return this.traces.get(loopId);
  }

  getEvaluation(loopId: string): MissionEvaluationResult | undefined {
    return this.evaluations.get(loopId);
  }

  listMissions(): MissionStatus[] {
    return [...this.missions.values()].map((result) => this.statusFromResult(result));
  }

  private statusFromResult(result: LoopResult): MissionStatus {
    return {
      missionId: result.missionId,
      loopId: result.runId,
      state: result.state,
      iterations: result.iterations.length,
      error: result.error,
    };
  }
}
