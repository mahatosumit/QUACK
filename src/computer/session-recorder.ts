import { now } from "../core/types.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type { ActionResult, ComputerAction, RecordedStep, SessionRecording } from "./types.js";

export class SessionRecorder {
  private runtime: ComputerRuntime;
  private recordings: Map<string, SessionRecording> = new Map();
  private activeRecordingId: string | null = null;

  constructor(runtime: ComputerRuntime) {
    this.runtime = runtime;
  }

  startRecording(name?: string): string {
    const id = createId();
    const recording: SessionRecording = {
      id, name: name ?? `Recording ${id.slice(0, 8)}`, steps: [],
      durationMs: 0, startedAt: now(), paused: false, tags: [],
    };
    this.recordings.set(id, recording);
    this.activeRecordingId = id;
    return id;
  }

  stopRecording(): SessionRecording | null {
    if (!this.activeRecordingId) return null;
    const recording = this.recordings.get(this.activeRecordingId);
    if (recording) {
      recording.endedAt = now();
      recording.durationMs = new Date(recording.endedAt).getTime() - new Date(recording.startedAt).getTime();
    }
    const id = this.activeRecordingId;
    this.activeRecordingId = null;
    return recording ?? null;
  }

  pauseRecording(): boolean {
    if (!this.activeRecordingId) return false;
    const recording = this.recordings.get(this.activeRecordingId);
    if (!recording) return false;
    recording.paused = true;
    return true;
  }

  resumeRecording(): boolean {
    if (!this.activeRecordingId) return false;
    const recording = this.recordings.get(this.activeRecordingId);
    if (!recording) return false;
    recording.paused = false;
    return true;
  }

  isRecording(): boolean {
    return this.activeRecordingId !== null;
  }

  async recordStep(action: ComputerAction, result: ActionResult, screenshotBefore?: boolean, screenshotAfter?: boolean): Promise<RecordedStep | null> {
    if (!this.activeRecordingId) return null;
    const recording = this.recordings.get(this.activeRecordingId);
    if (!recording || recording.paused) return null;

    const sb = screenshotBefore ? (await this.runtime.execute({ type: "screenshot" })).type === "screenshot" ? (await this.runtime.execute({ type: "screenshot" })) : undefined : undefined;
    await new Promise((r) => setTimeout(r, 50));
    const sa = screenshotAfter ? (await this.runtime.execute({ type: "screenshot" })).type === "screenshot" ? (await this.runtime.execute({ type: "screenshot" })) : undefined : undefined;

    const step: RecordedStep = {
      id: createId(),
      action, result,
      timestamp: now(),
      durationMs: 0,
    };

    if (sb?.type === "screenshot") step.screenshotBefore = sb.result.screenshot;
    if (sa?.type === "screenshot") step.screenshotAfter = sa.result.screenshot;

    recording.steps.push(step);
    return step;
  }

  async replay(sessionId: string, stepFrom?: number, stepTo?: number): Promise<ActionResult[]> {
    const recording = this.recordings.get(sessionId);
    if (!recording) return [];

    const steps = recording.steps.slice(stepFrom ?? 0, stepTo ?? recording.steps.length);
    const results: ActionResult[] = [];

    for (const step of steps) {
      if (step.action.type === "session" && (step.action.action as any).type === "replay") continue;
      const result = await this.runtime.execute(step.action);
      results.push(result);
      await new Promise((r) => setTimeout(r, 100));
    }

    return results;
  }

  getRecording(id: string): SessionRecording | undefined {
    return this.recordings.get(id);
  }

  getAllRecordings(): SessionRecording[] {
    return Array.from(this.recordings.values());
  }

  deleteRecording(id: string): boolean {
    return this.recordings.delete(id);
  }

  getActiveRecordingId(): string | null {
    return this.activeRecordingId;
  }
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
