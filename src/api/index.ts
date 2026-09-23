import { type LoopResult } from "../agent-loop/contract.js";
import { now } from "../core/types.js";
import { type MissionEvaluationResult, type MissionTrace } from "../harness/index.js";
import { type QuackSystem } from "../distributions/swe-system.js";
import { isMissionMode } from "../runtime/mission.js";

export interface MissionSubmission {
  readonly missionId?: string;
  readonly goal: string;
  readonly actor?: string;
  readonly signal?: AbortSignal;
  readonly engine?: "governed" | "dag";
  readonly mode?: string;
  readonly permissions?: readonly string[];
  readonly constraints?: readonly string[];
}

export interface GovernedMissionInput {
  readonly missionId?: string;
  readonly objective: string;
  readonly actor?: string;
  readonly permissions?: readonly string[];
  readonly constraints?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface MissionStatus {
  readonly missionId?: string;
  readonly loopId: string;
  /** Durable runtime task id — the handle for cancel/resume operations. */
  readonly taskId?: string;
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
    const engine = input.engine === "governed" || input.mode === "governed" ? "governed" : "dag";
    const execution = await system.runtime.submitMission({
      objective: input.goal,
      actor: input.actor ?? "api",
      missionId: input.missionId,
      origin: "api",
      engine,
      mode: input.mode === "governed" ? "mission" : isMissionMode(input.mode) ? input.mode : undefined,
      permissions: input.permissions,
      constraints: input.constraints,
      signal: input.signal,
    });
    if (!execution.ok) throw Object.assign(new Error(execution.error.message), { code: execution.error.code });
    if (engine === "governed") {
      return {
        missionId: execution.data.missionId,
        loopId: execution.data.executionId,
        taskId: execution.data.taskId ?? execution.data.missionId,
        state: execution.data.state,
        iterations: execution.data.iterations,
        error: execution.data.error?.message,
      };
    }
    const task = execution.data.task;
    if (!task) throw new Error("The DAG mission engine returned no task.");
    const loopResult = system.runtime.getLoopResult(task.id);
    if (!loopResult) throw new Error(String(task.error?.message ?? "Mission was not admitted to a runtime session."));
    const trace = await system.harness.traceRecorder.createTrace({
      missionInput: { missionId: input.missionId, goal: input.goal, actor: input.actor ?? "api" }, loopResult,
    });
    const evaluation = await system.harness.evaluator.evaluateMission(trace);
    await system.storage.traces.save(trace, { lookupId: loopResult.runId });
    await system.storage.evaluations.save({ id: loopResult.runId, traceId: trace.id, missionId: input.missionId, result: evaluation, createdAt: now() });
    this.missions.set(loopResult.runId, loopResult);
    this.traces.set(loopResult.runId, trace);
    this.evaluations.set(loopResult.runId, evaluation);
    return { ...this.statusFromResult(loopResult), taskId: task.id };
  }

  /** Run an objective through the governed model-in-the-loop runtime with capability gating. */
  async submitGovernedMission(input: GovernedMissionInput): Promise<MissionStatus> {
    return this.submitMission({
      missionId: input.missionId,
      goal: input.objective,
      actor: input.actor,
      engine: "governed",
      mode: "mission",
      permissions: input.permissions,
      constraints: input.constraints,
      signal: input.signal,
    });
  }

  getStatus(loopId: string): MissionStatus | undefined {
    const result = this.missions.get(loopId);
    return result ? this.statusFromResult(result) : undefined;
  }

  /** Resume an interrupted mission through the canonical recovery path. */
  async resumeMission(missionId: string): Promise<MissionStatus> {
    const system = this.getSystem();
    const result = await system.runtime.resumeMission(missionId);
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    const loopResult = system.runtime.getLoopResult(result.data.id);
    if (!loopResult) return {
      missionId: result.data.execution?.missionId ?? missionId,
      loopId: result.data.id,
      taskId: result.data.id,
      state: result.data.status === "completed" ? "COMPLETED" : result.data.status === "failed" ? "FAILED" : result.data.status === "created" ? "PENDING" : "RUNNING",
      iterations: 0,
      error: typeof result.data.error?.message === "string" ? result.data.error.message : undefined,
    };
    this.missions.set(loopResult.runId, loopResult);
    return this.statusFromResult(loopResult);
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
