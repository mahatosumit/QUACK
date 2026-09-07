import { type IsoTimestamp, type JsonObject } from "../types.js";

/** User identity attributes persisted across sessions. */
export interface UserIdentity {
  readonly id: string;
  name: string;
  role: string;
  preferences: UserPreferences;
  goals: string[];
  technicalPreferences: TechnicalPreferences;
  communicationStyle: CommunicationStyle;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface UserPreferences {
  codingStyle: "modular" | "functional" | "object-oriented" | "procedural";
  explanationStyle: "detailed" | "concise" | "terse";
  language: string;
  theme: "light" | "dark" | "system";
  autoApproveLowRisk: boolean;
}

export interface TechnicalPreferences {
  languages: string[];
  frameworks: string[];
  tooling: string[];
  testingFramework: string;
  linter: string;
  formatter: string;
}

export type CommunicationStyle = "formal" | "casual" | "technical" | "tutorial";

/** Snapshot of an opening project/session state. */
export interface ProjectState {
  readonly id: string;
  name: string;
  rootPath: string;
  description: string;
  files: string[];
  gitBranch?: string;
  gitCommit?: string;
  dependencies: string[];
  languages: string[];
  lastOpenedAt: IsoTimestamp;
}

/** A previous decision recalled into context before task execution. */
export interface PreviousDecision {
  readonly id: string;
  decision: string;
  rationale: string;
  impact: string;
  date: IsoTimestamp;
}

/** The fully assembled context bundle handed to the ExecutiveBrain. */
export interface ContextBundle {
  readonly id: string;
  readonly identity: UserIdentity;
  readonly project?: ProjectState;
  readonly previousDecisions: PreviousDecision[];
  readonly activeGoals: string[];
  readonly preferences: UserPreferences;
  createdAt: IsoTimestamp;
  source: "bootloader" | "resume" | "manual";
  metadata: JsonObject;
}

/** A provider that contributes a slice of context. Additive, never replacing core memory. */
export interface ContextProvider {
  readonly id: string;
  load(): Promise<JsonObject>;
}

/** Configuration for the context boot sequence. */
export interface ContextBootloaderConfig {
  readonly dataDir?: string;
  readonly workspaceRoot?: string;
  readonly enabled: boolean;
  readonly maxDecisions: number;
}
