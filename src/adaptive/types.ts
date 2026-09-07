import { type IsoTimestamp } from "../core/types.js";

export type ExperimentType =
  | "ab-test"
  | "multi-model"
  | "multi-prompt"
  | "pipeline"
  | "routing"
  | "agent"
  | "skill"
  | "workflow";

export type ExperimentStatus = "draft" | "running" | "completed" | "failed" | "cancelled";

export interface ExperimentConfig {
  type: ExperimentType;
  name: string;
  description: string;
  variants: ExperimentVariant[];
  metrics: string[];
  iterations: number;
  confidenceThreshold: number;
}

export interface ExperimentVariant {
  id: string;
  label: string;
  config: Record<string, unknown>;
  weight: number;
}

export interface ExperimentResult {
  variantId: string;
  metrics: Record<string, number>;
  sampleSize: number;
  confidence: number;
  isWinner: boolean;
}

export interface Experiment {
  id: string;
  config: ExperimentConfig;
  status: ExperimentStatus;
  results: ExperimentResult[];
  winner: string | null;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
  artifacts: string[];
}

export interface PromptVersion {
  id: string;
  version: number;
  content: string;
  hash: string;
  scores: PromptScore[];
  parentId: string | null;
  createdAt: IsoTimestamp;
  approved: boolean;
}

export interface PromptScore {
  benchmarkId: string;
  score: number;
  latencyMs: number;
  cost: number;
  sampleSize: number;
  timestamp: IsoTimestamp;
}

export interface Prompt {
  id: string;
  name: string;
  versions: PromptVersion[];
  activeVersion: number;
  category: string;
  tags: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SkillVersion {
  id: string;
  version: number;
  definition: Record<string, unknown>;
  benchmarks: SkillBenchmark[];
  parentId: string | null;
  createdAt: IsoTimestamp;
  deprecated: boolean;
}

export interface SkillBenchmark {
  suite: string;
  passRate: number;
  avgLatencyMs: number;
  sampleSize: number;
  timestamp: IsoTimestamp;
}

export interface WorkflowObservation {
  stepId: string;
  latencyMs: number;
  failures: number;
  retries: number;
  toolCalls: number;
  routingDecisions: number;
}

export interface WorkflowOptimization {
  id: string;
  workflowId: string;
  observations: WorkflowObservation[];
  recommendations: string[];
  score: number;
  applied: boolean;
  createdAt: IsoTimestamp;
}

export interface DebateArgument {
  agentId: string;
  role: string;
  position: "for" | "against" | "neutral";
  claim: string;
  evidence: string[];
  confidence: number;
}

export interface DebateSession {
  id: string;
  topic: string;
  arguments: DebateArgument[];
  votes: Record<string, string>;
  consensus: string | null;
  minorityReport: string | null;
  decision: string | null;
  createdAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
}

export interface ScientificWorkflowStep {
  phase: string;
  status: "pending" | "running" | "completed" | "failed";
  output: string | null;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  provenance: Record<string, unknown>;
}

export interface ScientificWorkflow {
  id: string;
  question: string;
  hypothesis: string | null;
  steps: Record<string, ScientificWorkflowStep>;
  report: string | null;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

export type FailureCategory =
  | "reasoning"
  | "tool"
  | "environment"
  | "model"
  | "provider"
  | "network"
  | "user"
  | "workspace"
  | "unknown";

export interface FailureRecord {
  id: string;
  taskId: string;
  category: FailureCategory;
  message: string;
  context: Record<string, unknown>;
  recovery: string | null;
  timestamp: IsoTimestamp;
}

export interface KnowledgeEntry {
  id: string;
  type: "pattern" | "lesson" | "template" | "workflow" | "decision" | "guidance" | "validation";
  content: string;
  source: string;
  tags: string[];
  usageCount: number;
  score: number;
  createdAt: IsoTimestamp;
}

export interface ImprovementProposal {
  id: string;
  type: "prompt" | "skill" | "workflow" | "routing" | "model" | "agent";
  target: string;
  description: string;
  expectedImprovement: string;
  evidence: string[];
  status: "draft" | "proposed" | "approved" | "rejected" | "applied";
  score: number;
  createdAt: IsoTimestamp;
  appliedAt: IsoTimestamp | null;
}

export interface QualityPrediction {
  successProbability: number;
  expectedCost: number;
  expectedLatencyMs: number;
  risk: "low" | "medium" | "high";
  confidence: number;
}

export interface DistillationRecord {
  id: string;
  sourceType: "model" | "agent" | "skill" | "workflow" | "pipeline";
  sourceId: string;
  targetType: string;
  targetId: string;
  strategy: string;
  performanceDelta: number;
  provenance: string[];
  createdAt: IsoTimestamp;
}

export interface DecisionRecord {
  id: string;
  sessionId: string;
  decision: string;
  alternatives: string[];
  rationale: string;
  evidence: string[];
  confidence: number;
  createdAt: IsoTimestamp;
}

export interface ExperiencePattern {
  id: string;
  pattern: string;
  frequency: number;
  successRate: number;
  context: string[];
  tags: string[];
  lastObserved: IsoTimestamp;
}

export interface ReasoningTrace {
  id: string;
  sessionId: string;
  goal: string;
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  createdAt: IsoTimestamp;
}

export interface ReasoningStep {
  type: "observation" | "inference" | "hypothesis" | "verification" | "conclusion";
  content: string;
  evidence: string[];
  confidence: number;
}

export interface AdaptiveLayerConfig {
  experimentManager?: ExperimentConfig[];
  enableAutonomousImprovement: boolean;
  requireApproval: boolean;
  maxProposalsPerCycle: number;
  improvementIntervalMs: number;
}

export interface AdaptiveLayer {
  experimentManager: ExperimentManager;
  promptRegistry: PromptRegistry;
  skillEvolution: SkillEvolutionEngine;
  workflowEvolution: WorkflowEvolutionEngine;
  debateEngine: DebateEngine;
  scientificWorkflow: ScientificWorkflowEngine;
  failureAnalysis: FailureAnalysisEngine;
  continuousLearning: ContinuousLearning;
  improvementScheduler: AutonomousImprovementScheduler;
  qualityPrediction: QualityPredictionEngine;
  knowledgeDistillation: KnowledgeDistillationEngine;
  decisionReplay: DecisionReplayEngine;
  experienceMiner: ExperienceMiningEngine;
  reasoningArchive: ReasoningArchive;
  evaluationFramework: ModelEvaluationFramework;
}

export interface ExperimentManager {
  createExperiment(config: ExperimentConfig): Experiment;
  getExperiment(id: string): Experiment | undefined;
  listExperiments(type?: string): Experiment[];
  runExperiment(id: string): Promise<Experiment>;
  getResults(id: string): ExperimentResult[];
  compareVariants(id: string): Record<string, number>;
  deleteExperiment(id: string): boolean;
}

export interface PromptRegistry {
  createPrompt(name: string, content: string, category: string): Prompt;
  getPrompt(id: string): Prompt | undefined;
  getActiveVersion(id: string): PromptVersion | undefined;
  addVersion(id: string, content: string): PromptVersion;
  scoreVersion(promptId: string, versionId: string, score: PromptScore): void;
  rollback(id: string, versionNumber: number): PromptVersion;
  compareVersions(id: string, v1: number, v2: number): PromptScore[];
  listPrompts(): Prompt[];
}

export interface SkillEvolutionEngine {
  getSkillVersions(skillId: string): SkillVersion[];
  recordBenchmark(skillId: string, benchmark: SkillBenchmark): void;
  compareVersions(skillId: string, v1: number, v2: number): SkillBenchmark[];
  deprecateVersion(skillId: string, version: number): void;
  recommendUpgrade(skillId: string): number | null;
}

export interface WorkflowEvolutionEngine {
  observeExecution(workflowId: string, observation: WorkflowObservation): void;
  getOptimizations(workflowId: string): WorkflowOptimization[];
  getRecommendations(workflowId: string): string[];
  applyOptimization(workflowId: string, optId: string): void;
}

export interface DebateEngine {
  createSession(topic: string): DebateSession;
  addArgument(sessionId: string, argument: DebateArgument): void;
  castVote(sessionId: string, agentId: string, choice: string): void;
  resolve(sessionId: string): DebateSession;
  getSession(sessionId: string): DebateSession | undefined;
  listSessions(): DebateSession[];
}

export interface ScientificWorkflowEngine {
  createWorkflow(question: string): ScientificWorkflow;
  updateStep(workflowId: string, phase: string, step: ScientificWorkflowStep): void;
  setHypothesis(workflowId: string, hypothesis: string): void;
  setReport(workflowId: string, report: string): void;
  getWorkflow(id: string): ScientificWorkflow | undefined;
  listWorkflows(): ScientificWorkflow[];
  getProvenance(workflowId: string): Record<string, unknown>;
}

export interface FailureAnalysisEngine {
  recordFailure(failure: FailureRecord): void;
  getFailuresByCategory(category: FailureCategory): FailureRecord[];
  getFailureRate(windowMs: number): number;
  getRecommendations(taskId: string): string[];
  getStats(): Record<string, number>;
}

export interface ContinuousLearning {
  addEntry(entry: KnowledgeEntry): void;
  search(query: string, tags?: string[]): KnowledgeEntry[];
  getTopEntries(limit: number): KnowledgeEntry[];
  recordUsage(entryId: string): void;
  getStats(): Record<string, number>;
}

export interface AutonomousImprovementScheduler {
  proposeImprovement(proposal: ImprovementProposal): void;
  getProposals(status?: string): ImprovementProposal[];
  approveProposal(id: string): void;
  rejectProposal(id: string, reason: string): void;
  applyProposal(id: string): Promise<void>;
  runCycle(): Promise<ImprovementProposal[]>;
}

export interface QualityPredictionEngine {
  predict(request: Record<string, unknown>): QualityPrediction;
  updateModel(outcome: boolean, prediction: QualityPrediction): void;
  getAccuracy(): number;
}

export interface KnowledgeDistillationEngine {
  distill(sourceType: string, sourceId: string, targetType: string, strategy: string): DistillationRecord;
  getDistillations(sourceId: string): DistillationRecord[];
  getProvenance(distillationId: string): string[];
}

export interface DecisionReplayEngine {
  recordDecision(record: DecisionRecord): void;
  getDecision(id: string): DecisionRecord | undefined;
  replaySession(sessionId: string): DecisionRecord[];
  getStats(): Record<string, number>;
}

export interface ExperienceMiningEngine {
  recordPattern(pattern: ExperiencePattern): void;
  findPatterns(context: string[]): ExperiencePattern[];
  getFrequentPatterns(limit: number): ExperiencePattern[];
  getStats(): Record<string, number>;
}

export interface ReasoningArchive {
  storeTrace(trace: ReasoningTrace): void;
  getTrace(id: string): ReasoningTrace | undefined;
  searchTraces(goal: string): ReasoningTrace[];
  getStats(): Record<string, number>;
  createReasoningStep(type: ReasoningTrace["steps"][0]["type"], content: string, evidence?: string[], confidence?: number): ReasoningTrace["steps"][0];
}

export interface ModelEvaluationFramework {
  evaluateModel(modelId: string, suite: string): Promise<EvaluationResult>;
  compareModels(modelIds: string[], suite: string): Promise<EvaluationComparison>;
  getHistory(modelId: string): EvaluationResult[];
  getLeaderboard(suite: string): EvaluationResult[];
}

export interface EvaluationResult {
  modelId: string;
  suite: string;
  scores: Record<string, number>;
  latencyMs: number;
  cost: number;
  reliability: number;
  timestamp: IsoTimestamp;
}

export interface EvaluationComparison {
  suite: string;
  results: EvaluationResult[];
  rankings: string[];
  timestamp: IsoTimestamp;
}
