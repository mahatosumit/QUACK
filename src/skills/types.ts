import { type Permission } from "../security/permissions.js";

export type SkillCategory = string;

export interface SkillManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly trustLevel?: SkillTrustLevel;
  readonly requiredCapabilities?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly executionLimits?: SkillExecutionLimits;
  readonly category: SkillCategory;
  readonly tags: readonly string[];
  readonly requiresPermissions: readonly Permission[];
  readonly requiresTools: readonly string[];
  readonly requiresProviders?: readonly string[];
  readonly requiresModels?: readonly string[];
  readonly requiresMemory?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly entry: string;
  readonly examples?: readonly SkillExample[];
  readonly documentation?: string;
}

export type SkillTrustLevel = "builtin" | "trusted" | "verified" | "community" | "experimental";

export interface SkillExecutionLimits {
  readonly timeoutMs?: number;
  readonly maxIterations?: number;
  readonly maxToolCalls?: number;
  readonly maxRetriesPerStep?: number;
}

export interface SkillExample {
  readonly input: string;
  readonly output: string;
  readonly description: string;
}

export interface SkillDefinition {
  readonly manifest: SkillManifest;
  readonly execute: (input: SkillInput) => Promise<SkillResult>;
  readonly validate?: (input: SkillInput) => Promise<SkillValidation>;
  readonly portableExecution?: PortableSkillExecutionDefinition;
  readonly compilationProvenance?: SkillCompilationProvenance;
}

export interface SkillInput {
  readonly goal: string;
  readonly parameters: Record<string, unknown>;
  readonly context: {
    readonly workspaceRoot: string;
    readonly dataDir: string;
    readonly sessionId: string;
  };
}

export interface SkillResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
  readonly durationMs: number;
  readonly artifacts?: readonly SkillArtifact[];
  readonly memoryUpdates?: readonly SkillMemoryUpdate[];
}

export interface SkillArtifact {
  readonly path: string;
  readonly content: string;
  readonly type: "text" | "json" | "markdown" | "diff" | "image" | "data";
}

export interface SkillMemoryUpdate {
  readonly scope: "session" | "workspace" | "project";
  readonly key: string;
  readonly content: string;
}

export interface PortableSkillExecutionDefinition {
  readonly schemaVersion: 1;
  readonly steps: readonly PortableSkillStep[];
  readonly compiledAgainstTools?: readonly PortableToolCompatibility[];
  readonly risk?: SkillCompilationRisk;
  readonly limits?: {
    readonly maxSteps?: number;
    readonly maxToolCalls?: number;
    readonly maxRetriesPerStep?: number;
    readonly timeoutMs?: number;
  };
}

export interface PortableSkillStep {
  readonly id: string;
  readonly description: string;
  readonly dependencies?: readonly string[];
  readonly requiredTools: readonly string[];
  readonly toolInvocations: readonly PortableToolInvocation[];
  readonly timeoutMs?: number;
  readonly retryPolicy?: {
    readonly maxRetries: number;
    readonly backoff: "fixed" | "linear" | "exponential" | "jitter";
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
}

export interface PortableToolInvocation {
  readonly toolId: string;
  readonly input: Record<string, unknown>;
  readonly reason?: string;
}

export type CompilationDiagnosticSeverity = "info" | "warning" | "error";

export type CompilationDiagnosticCode =
  | "UNKNOWN_TOOL"
  | "AMBIGUOUS_TOOL"
  | "MISSING_INPUT"
  | "UNBOUND_OUTPUT"
  | "INVALID_DEPENDENCY"
  | "PERMISSION_DENIED"
  | "UNBOUNDED_STEP"
  | "UNSUPPORTED_OPERATION"
  | "AMBIGUOUS_INSTRUCTION"
  | "INVALID_TOOL_INPUT"
  | "TOOL_COMPATIBILITY"
  | "MISSING_SECTION";

export interface CompilationDiagnostic {
  readonly severity: CompilationDiagnosticSeverity;
  readonly code: CompilationDiagnosticCode;
  readonly message: string;
  readonly sourceLocation?: string;
  readonly stepId?: string;
  readonly recommendation?: string;
}

export type SkillCompilationOutcome =
  | "COMPILED"
  | "COMPILED_WITH_WARNINGS"
  | "NEEDS_CLARIFICATION"
  | "UNSUPPORTED"
  | "REJECTED";

export type SkillCompilationRisk =
  | "READ_ONLY"
  | "LOW_RISK_MUTATION"
  | "WORKSPACE_MUTATION"
  | "EXTERNAL_SIDE_EFFECT"
  | "DESTRUCTIVE"
  | "PRIVILEGED";

export interface PortableToolCompatibility {
  readonly toolId: string;
  readonly metadataFingerprint: string;
  readonly permissions: readonly Permission[];
}

export interface SkillCompilationProvenance {
  readonly sourceType: "skill.md" | "structured-ir" | "plan-ir";
  readonly sourceId?: string;
  readonly sourceHash: string;
  readonly compilerVersion: string;
  readonly schemaVersion: 1;
  readonly toolRegistryFingerprint?: string;
  readonly compiledAt: string;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly outcome: SkillCompilationOutcome;
  readonly risk: SkillCompilationRisk;
  readonly promotionLineage?: readonly string[];
}

export interface SkillValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface SkillExecutionPlan {
  readonly skills: readonly { skillId: string; version?: string; weight: number; reason: string }[];
  readonly composed: boolean;
  readonly estimatedDurationMs: number;
}

export type SkillStatus = "active" | "inactive" | "error" | "loading" | "candidate" | "review" | "retired" | "quarantined";
export type SkillLoadSource = "builtin" | "file" | "package" | "marketplace" | "generated" | "imported" | "plugin";

export interface SkillLifecycleEvent {
  readonly skillId: string;
  readonly version?: string;
  readonly from: SkillStatus;
  readonly to: SkillStatus;
  readonly reason: string;
  readonly evidenceRefs: readonly string[];
  readonly replacementSkillId?: string;
  readonly replacementVersion?: string;
  readonly createdAt: string;
}

export interface SkillRecord {
  readonly id: string;
  readonly versionKey: string;
  readonly manifest: SkillManifest;
  readonly status: SkillStatus;
  readonly source: SkillLoadSource;
  readonly fingerprint?: string;
  readonly supersededBy?: string;
  readonly supersededByVersion?: string;
  readonly parentVersion?: string;
  readonly isDefault: boolean;
  readonly loadedAt: string;
  readonly lastUsed?: string;
  readonly useCount: number;
  readonly avgDurationMs: number;
}
