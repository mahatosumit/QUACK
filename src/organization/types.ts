import { type IsoTimestamp } from "../core/types.js";

export type AgentRole =
  | "executive-brain"
  | "project-manager"
  | "architect"
  | "planner"
  | "software-engineer"
  | "debugger"
  | "reviewer"
  | "tester"
  | "documentation-engineer"
  | "research-engineer"
  | "security-engineer"
  | "performance-engineer"
  | "devops-engineer"
  | "release-engineer"
  | "ui-ux-engineer"
  | "plugin-engineer"
  | "memory-curator"
  | "knowledge-engineer";

export type AgentStatus = "idle" | "busy" | "blocked" | "error" | "offline" | "terminated";

export type AgentPriority = "critical" | "high" | "medium" | "low";

export interface AgentCapability {
  id: string;
  name: string;
  version: string;
  description: string;
}

export interface AgentProfile {
  role: AgentRole;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  maxConcurrentTasks: number;
  defaultPriority: AgentPriority;
  supportedTaskTypes: string[];
  requiredMemory: string[];
  requiredTools: string[];
  requiredSkills: string[];
  requiresApproval: boolean;
  autoDelegate: boolean;
  maxRetries: number;
  timeoutMs: number;
}

export interface AgentConfig {
  profile: AgentProfile;
  priority: AgentPriority;
  enabled: boolean;
  maxMemoryEntries: number;
  maxHistoryLength: number;
  autoRecover: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface AgentInstance {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  config: AgentConfig;
  createdAt: IsoTimestamp;
  lastActiveAt: IsoTimestamp;
  currentTaskIds: string[];
  metrics: AgentMetrics;
  health: AgentHealth;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  tasksDelegated: number;
  avgExecutionTimeMs: number;
  totalExecutionTimeMs: number;
  totalTokensUsed: number;
  communicationCount: number;
  errorCount: number;
  lastError?: string;
  uptimeMs: number;
}

export interface AgentHealth {
  status: AgentStatus;
  lastHeartbeat: IsoTimestamp;
  memoryUsage: number;
  activeThreads: number;
  responseTimeMs: number;
  errorRate: number;
}

export type MessageType =
  | "request" | "response" | "delegate" | "negotiate"
  | "vote" | "consensus" | "status" | "transfer"
  | "escalate" | "approve" | "reject" | "review"
  | "notify" | "broadcast" | "query" | "reply";

export interface AgentMessage {
  id: string;
  type: MessageType;
  from: string;
  to: string | string[];
  threadId?: string;
  timestamp: IsoTimestamp;
  payload: unknown;
  priority: AgentPriority;
  requiresResponse: boolean;
  responseTimeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskAssignment {
  taskId: string;
  assignedTo: string;
  assignedBy: string;
  goal: string;
  priority: AgentPriority;
  dependencies: string[];
  deadline?: IsoTimestamp;
  context?: Record<string, unknown>;
  status: "assigned" | "accepted" | "in_progress" | "completed" | "failed" | "reassigned";
  assignedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

export interface VoteRequest {
  id: string;
  topic: string;
  options: string[];
  voters: string[];
  deadline: IsoTimestamp;
  status: "open" | "closed" | "tied";
  results?: Record<string, string>;
}

export interface NegotiationRequest {
  id: string;
  initiator: string;
  participants: string[];
  topic: string;
  context: Record<string, unknown>;
  status: "open" | "agreed" | "deadlocked" | "cancelled";
  proposals: string[];
  agreedProposal?: string;
}

export interface WorkflowStep {
  id: string;
  description: string;
  assignedAgent: string;
  dependencies: string[];
  estimatedDurationMs: number;
  status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
}

export interface WorkflowPlan {
  id: string;
  goal: string;
  steps: WorkflowStep[];
  status: "planned" | "running" | "completed" | "failed" | "cancelled";
  createdAt: IsoTimestamp;
  owner: string;
  priority: AgentPriority;
}

export interface OrganizationState {
  version: string;
  agents: AgentInstance[];
  workflows: WorkflowPlan[];
  taskAssignments: TaskAssignment[];
  activeNegotiations: NegotiationRequest[];
  organizationalMemory: OrgMemoryEntry[];
  updatedAt: IsoTimestamp;
}

export interface OrgMemoryEntry {
  id: string;
  type: "success" | "failure" | "pattern" | "decision" | "lesson" | "architecture";
  content: string;
  tags: string[];
  agents: string[];
  timestamp: IsoTimestamp;
  relevanceScore: number;
  accessCount: number;
}

export interface LearningRecord {
  id: string;
  pattern: string;
  outcome: "success" | "failure";
  context: Record<string, unknown>;
  appliedBy: string;
  frequency: number;
  lastApplied: IsoTimestamp;
  effectivenessScore: number;
}
