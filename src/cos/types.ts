import { type IsoTimestamp } from "../core/types.js";
import { type AgentRole, type AgentPriority, type OrgMemoryEntry } from "../organization/types.js";
import { type MissionState } from "../runtime/mission-lifecycle/mission-state-machine.js";

// ── Goals ────────────────────────────────────────────────────────

export type GoalStatus = "draft" | "active" | "paused" | "completed" | "failed" | "cancelled";

export interface GoalMilestone {
  id: string;
  description: string;
  dueBy?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  status: "pending" | "in_progress" | "completed" | "skipped";
}

export interface GoalDefinition {
  id: string;
  mission: string;
  objectives: string[];
  milestones: GoalMilestone[];
  dependencies: string[];
  priority: AgentPriority;
  owner: string;
  assignedAgents: string[];
  estimatedEffortHours: number;
  timeline: { start: IsoTimestamp; deadline?: IsoTimestamp };
  budget: { costLimit?: number; resourceLimit?: number };
  successMetrics: string[];
  failureCriteria: string[];
  progress: number;
  relatedWorkflows: string[];
  relatedSkills: string[];
  relatedDocs: string[];
  knowledgeTags: string[];
  status: GoalStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

// ── Missions ─────────────────────────────────────────────────────

export interface MissionDefinition {
  id: string;
  name: string;
  description: string;
  goals: string[];
  priority: AgentPriority;
  owner: string;
  /** Legacy status for backward compatibility. New code should use canonicalState. */
  status: "draft" | "active" | "completed" | "failed";
  /** Canonical mission lifecycle state. */
  canonicalState?: MissionState;
  createdAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

// Evidence-driven objectives and evaluation

export type MetricDirection = "maximize" | "minimize" | "target";
export type MetricValue = number | boolean | string;
export type ObjectiveEvaluationStatus =
  | "IMPROVED"
  | "REGRESSED"
  | "UNCHANGED"
  | "INSUFFICIENT_EVIDENCE"
  | "INCONCLUSIVE";

export interface MetricDefinition {
  id: string;
  description: string;
  direction: MetricDirection;
  measurementSource: string;
  weight?: number;
  threshold?: MetricValue;
}

export interface ObjectiveEvaluationPolicy {
  evaluatorId: string;
  minEvidenceCount: number;
  requireBaseline: boolean;
}

export interface ObjectiveSpecification {
  id: string;
  name: string;
  description: string;
  metrics: readonly MetricDefinition[];
  constraints: readonly string[];
  baselineStrategy?: string;
  evaluationPolicy: ObjectiveEvaluationPolicy;
}

export interface MetricObservation {
  id: string;
  objectiveId: string;
  metricId: string;
  runId: string;
  source: string;
  value?: MetricValue;
  valid: boolean;
  error?: string;
  observedAt: IsoTimestamp;
  sequence: number;
}

export interface ObjectiveEvidence {
  id: string;
  objectiveId: string;
  runId: string;
  metricId?: string;
  observationId?: string;
  evaluatorId: string;
  source: string;
  baselineRunId?: string;
  baselineValue?: MetricValue;
  observedValue?: MetricValue;
  delta?: number;
  conclusion: ObjectiveEvaluationStatus;
  confidence: number;
  createdAt: IsoTimestamp;
  execution?: ExecutionProvenance;
}

export interface ObjectiveEvaluation {
  id: string;
  objectiveId: string;
  runId: string;
  status: ObjectiveEvaluationStatus;
  summary: string;
  observations: readonly MetricObservation[];
  evidence: readonly ObjectiveEvidence[];
  comparedToRunId?: string;
  confidence: number;
  createdAt: IsoTimestamp;
  execution?: ExecutionProvenance;
}

export type ExecutionVariantRole = "production" | "control" | "candidate";

export interface SkillAttribution {
  skillId: string;
  version?: string;
  source?: string;
}

export interface ExecutionVariant {
  id: string;
  role: ExecutionVariantRole;
  label?: string;
}

export interface ExecutionProvenance {
  strategyId?: string;
  strategyLabel?: string;
  workflowId?: string;
  plannerId?: string;
  plannerVersion?: string;
  runtimeId?: string;
  runtimeVersion?: string;
  contextKey?: string;
  contextTags?: readonly string[];
  selectedSkills: readonly SkillAttribution[];
  variant?: ExecutionVariant;
}

export interface EvidenceBackedExperience {
  id: string;
  objective: ObjectiveSpecification;
  strategyId?: string;
  execution: ExecutionProvenance;
  missionId?: string;
  runId: string;
  taskId?: string;
  actions: readonly string[];
  outcomes: readonly string[];
  metricObservations: readonly MetricObservation[];
  evaluation: ObjectiveEvaluation;
  evidence: readonly ObjectiveEvidence[];
  resultStatus: "completed" | "failed" | "cancelled" | "inconclusive";
  traceRefs: readonly string[];
  createdAt: IsoTimestamp;
}

export interface PlaybookRule {
  id: string;
  context: readonly string[];
  recommendation: string;
  evidenceRefs: readonly string[];
  confidence: number;
  status: "candidate" | "validated" | "retired";
  createdAt: IsoTimestamp;
}

// ── Strategies ───────────────────────────────────────────────────

export interface RiskAnalysis {
  risk: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export interface ExecutionStrategy {
  id: string;
  goalId: string;
  approach: string;
  taskGraph: { step: string; dependsOn: string[] }[];
  risks: RiskAnalysis[];
  fallbackStrategies: string[];
  validationPlan: string;
  reviewSchedule: { cadence: string; nextReview: IsoTimestamp };
  completionMetrics: string[];
  status: "draft" | "approved" | "active" | "completed" | "superseded";
  createdAt: IsoTimestamp;
}

// ── Decisions ────────────────────────────────────────────────────

export interface DecisionRecord {
  id: string;
  problem: string;
  alternatives: { name: string; description: string; pros: string[]; cons: string[] }[];
  evidence: string[];
  tradeoffs: string[];
  risks: string[];
  decision: string;
  rationale: string;
  expectedOutcome: string;
  actualOutcome?: string;
  councilId?: string;
  voteResult?: string;
  madeBy: string;
  participants: string[];
  reviewDate?: IsoTimestamp;
  status: "pending" | "made" | "implemented" | "reviewed" | "superseded";
  tags: string[];
  createdAt: IsoTimestamp;
  implementedAt?: IsoTimestamp;
}

// ── Councils ─────────────────────────────────────────────────────

export interface CouncilSession {
  id: string;
  topic: string;
  invokedBy: string;
  participants: { agentId: string; role: AgentRole; vote?: string }[];
  evidence: { presentedBy: string; content: string }[];
  alternatives: string[];
  recommendation?: string;
  voteResult?: string;
  decisionId?: string;
  status: "assembling" | "deliberating" | "voting" | "concluded" | "deadlocked";
  createdAt: IsoTimestamp;
  concludedAt?: IsoTimestamp;
}

// ── Experiences ──────────────────────────────────────────────────

export interface ExperienceRecord {
  id: string;
  title: string;
  category: "bugfix" | "refactoring" | "architecture" | "optimization" | "testing" | "deployment" | "recovery" | "pattern";
  description: string;
  context: string[];
  steps: string[];
  outcome: "success" | "failure";
  tags: string[];
  relevance: number;
  usageCount: number;
  sourceGoalId?: string;
  createdBy: string;
  createdAt: IsoTimestamp;
  lastUsedAt?: IsoTimestamp;
}

// ── Learning ─────────────────────────────────────────────────────

export interface CosLearningRecord {
  id: string;
  pattern: string;
  insight: string;
  category: "workflow" | "decision" | "skill" | "agent" | "performance" | "architecture";
  confidence: number;
  evidence: string[];
  appliedCount: number;
  lastApplied?: IsoTimestamp;
  createdAt: IsoTimestamp;
}

// ── Governance ───────────────────────────────────────────────────

export type PolicyScope = "global" | "goal" | "agent" | "workflow" | "skill";
export type PolicySeverity = "required" | "recommended" | "advisory";

export interface PolicyDefinition {
  id: string;
  name: string;
  description: string;
  scope: PolicyScope;
  severity: PolicySeverity;
  rules: { field: string; condition: string; value: unknown }[];
  enforcement: "automatic" | "manual" | "audit";
  createdBy: string;
  createdAt: IsoTimestamp;
  enabled: boolean;
}

// ── Organizational Intelligence ──────────────────────────────────

export interface OrgSnapshot {
  timestamp: IsoTimestamp;
  agentUtilization: { idle: number; busy: number; error: number; total: number };
  skillCount: number;
  modelCount: number;
  goalCount: number;
  workflowCount: number;
  memorySize: number;
  taskCompletionRate: number;
  errorRate: number;
  bottlenecks: { agentId: string; taskCount: number }[];
  knowledgeGaps: string[];
}

// ── Metrics ──────────────────────────────────────────────────────

export interface CosMetricsSnapshot {
  timestamp: IsoTimestamp;
  goals: { total: number; active: number; completed: number; failed: number };
  decisions: { total: number; implemented: number; superseded: number };
  experiences: { total: number; byCategory: Record<string, number> };
  learning: { total: number; avgConfidence: number };
  agents: { total: number; avgTasksCompleted: number; avgErrorRate: number };
  workflows: { total: number; successRate: number };
  policies: { total: number; enabled: number };
}

// ── Timeline ─────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  type: "goal_created" | "milestone_reached" | "decision_made" | "council_held" | "experience_saved" | "policy_updated" | "recurring_review";
  description: string;
  timestamp: IsoTimestamp;
  relatedIds: string[];
  metadata?: Record<string, unknown>;
}

// ── Context ──────────────────────────────────────────────────────

export interface ContextFrame {
  id: string;
  activeGoalIds: string[];
  recentDecisions: string[];
  currentWorkload: { agentId: string; load: number }[];
  environmentState: Record<string, unknown>;
  relevantExperiences: string[];
  attention: string[];
  createdAt: IsoTimestamp;
}

// ── Capabilities ─────────────────────────────────────────────────

export interface CapabilityInventory {
  agentId: string;
  role: AgentRole;
  capabilities: string[];
  skillProficiencies: { skillId: string; proficiency: number; lastUsed?: IsoTimestamp }[];
  modelPreferences: string[];
  performance: { avgExecutionMs: number; successRate: number; tasksCompleted: number };
}

// ── Skill Evolution ──────────────────────────────────────────────

export interface SkillVersion {
  version: string;
  benchmarkScore: number;
  qualityScore: number;
  usageCount: number;
  lastOptimized?: IsoTimestamp;
  changeLog: string[];
}

// ── Improvement Proposal ─────────────────────────────────────────

export interface ImprovementProposal {
  id: string;
  title: string;
  description: string;
  category: "workflow" | "skill" | "architecture" | "memory" | "provider" | "prompt" | "organization" | "performance";
  currentState: string;
  proposedState: string;
  expectedBenefit: string;
  risk: "low" | "medium" | "high";
  effort: "small" | "medium" | "large";
  status: "draft" | "under_review" | "approved" | "scheduled" | "implemented" | "rejected";
  createdBy: string;
  createdAt: IsoTimestamp;
  implementedAt?: IsoTimestamp;
}

// ── Self Evaluation ──────────────────────────────────────────────

export interface SelfEvaluationReport {
  id: string;
  timestamp: IsoTimestamp;
  score: number;
  dimensions: { name: string; score: number; notes: string }[];
  proposals: ImprovementProposal[];
  healthSummary: string;
}
