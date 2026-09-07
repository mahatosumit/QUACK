import { ComputerRuntime } from "./computer-runtime.js";
import { ComputerPlanner } from "./computer-planner.js";
import { SessionRecorder } from "./session-recorder.js";
import { MacroEngine } from "./macro-engine.js";
import { ActionValidator } from "./action-validator.js";
import { ComputerMemory } from "./computer-memory.js";
import { VisionRuntime } from "./vision-runtime.js";
import type { ComputerProvider, BrowserProvider, SafetyPolicy } from "./types.js";

export interface ComputerOrchestratorDeps {
  runtime?: ComputerRuntime;
  planner?: ComputerPlanner;
  recorder?: SessionRecorder;
  macros?: MacroEngine;
  validator?: ActionValidator;
  memory?: ComputerMemory;
  vision?: VisionRuntime;
}

export interface UniversalComputerPlatform {
  readonly runtime: ComputerRuntime;
  readonly planner: ComputerPlanner;
  readonly recorder: SessionRecorder;
  readonly macros: MacroEngine;
  readonly validator: ActionValidator;
  readonly memory: ComputerMemory;
  readonly vision: VisionRuntime;
}

export function createUCP(deps?: ComputerOrchestratorDeps): UniversalComputerPlatform {
  const runtime = deps?.runtime ?? new ComputerRuntime();
  const planner = deps?.planner ?? new ComputerPlanner(runtime);
  const recorder = deps?.recorder ?? new SessionRecorder(runtime);
  const macros = deps?.macros ?? new MacroEngine();
  const validator = deps?.validator ?? new ActionValidator(runtime.getSafetyPolicy());
  const memory = deps?.memory ?? new ComputerMemory();
  const vision = deps?.vision ?? new VisionRuntime(runtime.getProvider());

  macros.registerBuiltins();

  return { runtime, planner, recorder, macros, validator, memory, vision };
}

export function createUCPWithProviders(
  provider: ComputerProvider,
  browserProvider: BrowserProvider,
  eventBus?: import("../events/event-bus.js").EventBus,
  safetyPolicy?: SafetyPolicy,
): UniversalComputerPlatform {
  const runtime = new ComputerRuntime({ provider, browserProvider, eventBus, safetyPolicy });
  return createUCP({ runtime });
}
