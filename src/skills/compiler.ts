import { createHash } from "node:crypto";
import { type JsonObject, type JsonValue } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type Permission } from "../security/permissions.js";
import { type ToolMetadata, type ToolRegistry, validateToolInput } from "../tools/tool.js";
import { type SkillRegistry } from "./registry.js";
import { PORTABLE_SKILL_EXECUTION_SCHEMA_VERSION, toolMetadataFingerprint } from "./sandbox-runtime.js";
import {
  type CompilationDiagnostic,
  type CompilationDiagnosticCode,
  type PortableSkillExecutionDefinition,
  type PortableSkillStep,
  type SkillCategory,
  type SkillCompilationOutcome,
  type SkillCompilationProvenance,
  type SkillCompilationRisk,
  type SkillDefinition,
  type SkillManifest,
} from "./types.js";

export const SAFE_SKILL_COMPILER_VERSION = "1.0.0";
export const SKILL_SOURCE_IR_SCHEMA_VERSION = 1;
export const SKILL_PLAN_IR_SCHEMA_VERSION = 1;

export interface SkillSourceIR {
  readonly schemaVersion: typeof SKILL_SOURCE_IR_SCHEMA_VERSION;
  readonly name?: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly requiredCapabilities: readonly string[];
  readonly suggestedTools: readonly string[];
  readonly constraints: readonly string[];
  readonly steps: readonly SkillSourceStepIR[];
  readonly expectedResult?: string;
  readonly failureConditions: readonly string[];
  readonly safetyNotes: readonly string[];
  readonly verification: readonly string[];
  readonly examples: readonly string[];
  readonly provenance: SkillSourceProvenance;
  readonly diagnostics: readonly CompilationDiagnostic[];
}

export interface SkillSourceStepIR {
  readonly id: string;
  readonly text: string;
  readonly sourceLocation: string;
}

export interface SkillSourceProvenance {
  readonly sourceType: "skill.md";
  readonly sourceId?: string;
  readonly sourceHash: string;
  readonly parsedAt: string;
  readonly parserVersion: string;
}

export interface SkillPlanIR {
  readonly schemaVersion: typeof SKILL_PLAN_IR_SCHEMA_VERSION;
  readonly skillId: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly category: SkillCategory;
  readonly tags: readonly string[];
  readonly steps: readonly SkillPlanStepIR[];
  readonly requiredTools: readonly string[];
  readonly permissions: readonly Permission[];
  readonly risk: SkillCompilationRisk;
  readonly diagnostics: readonly CompilationDiagnostic[];
}

export interface SkillPlanStepIR {
  readonly id: string;
  readonly intent: string;
  readonly candidateCapability?: string;
  readonly candidateTool?: string;
  readonly resolvedTool?: ToolMetadata;
  readonly inputs: JsonObject;
  readonly dependencies: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly retryPolicyRequest?: number;
  readonly timeoutRequestMs?: number;
  readonly verificationRequirement?: string;
}

export interface SkillCompilationResult {
  readonly outcome: SkillCompilationOutcome;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly source: SkillSourceIR;
  readonly plan?: SkillPlanIR;
  readonly portableExecution?: PortableSkillExecutionDefinition;
  readonly definition?: SkillDefinition;
  readonly dryRun?: SkillCompilationDryRun;
  readonly provenance: SkillCompilationProvenance;
}

export interface SkillCompilationDryRun {
  readonly resolvedDag: readonly {
    readonly id: string;
    readonly dependencies: readonly string[];
    readonly tools: readonly string[];
    readonly bindings: readonly string[];
    readonly timeoutMs?: number;
    readonly maxRetries: number;
  }[];
  readonly selectedTools: readonly ToolMetadata[];
  readonly permissions: readonly Permission[];
  readonly risk: SkillCompilationRisk;
  readonly sideEffects: readonly string[];
  readonly estimatedBounds: {
    readonly maxSteps: number;
    readonly maxToolCalls: number;
    readonly maxRetriesPerStep: number;
    readonly timeoutMs: number;
  };
}

export interface SkillMarkdownCompilationOptions {
  readonly skillId?: string;
  readonly version?: string;
  readonly sourceId?: string;
  readonly category?: SkillCategory;
  readonly tags?: readonly string[];
  readonly author?: string;
  readonly events?: EventBus;
  readonly allowedPermissions?: readonly Permission[];
  readonly limits?: {
    readonly maxSteps?: number;
    readonly maxToolCalls?: number;
    readonly maxRetriesPerStep?: number;
    readonly timeoutMs?: number;
  };
}

type SectionName =
  | "description"
  | "purpose"
  | "inputs"
  | "outputs"
  | "instructions"
  | "steps"
  | "tools"
  | "constraints"
  | "preconditions"
  | "postconditions"
  | "verification"
  | "examples"
  | "safety"
  | "failure";

const DEFAULT_LIMITS = {
  maxSteps: 8,
  maxToolCalls: 12,
  maxRetriesPerStep: 1,
  timeoutMs: 5_000,
};

const SECTION_ALIASES = new Map<string, SectionName>([
  ["description", "description"],
  ["purpose", "purpose"],
  ["input", "inputs"],
  ["inputs", "inputs"],
  ["output", "outputs"],
  ["outputs", "outputs"],
  ["instruction", "instructions"],
  ["instructions", "instructions"],
  ["step", "steps"],
  ["steps", "steps"],
  ["tool", "tools"],
  ["tools", "tools"],
  ["constraint", "constraints"],
  ["constraints", "constraints"],
  ["precondition", "preconditions"],
  ["preconditions", "preconditions"],
  ["postcondition", "postconditions"],
  ["postconditions", "postconditions"],
  ["verification", "verification"],
  ["verify", "verification"],
  ["examples", "examples"],
  ["example", "examples"],
  ["safety", "safety"],
  ["safety notes", "safety"],
  ["failure", "failure"],
  ["failure conditions", "failure"],
]);

const UNSUPPORTED_PATTERNS: readonly { readonly pattern: RegExp; readonly code: CompilationDiagnosticCode; readonly message: string }[] = [
  { pattern: /\brm\s+-rf\b/i, code: "UNSUPPORTED_OPERATION", message: "Destructive shell deletion cannot be compiled." },
  { pattern: /\beval\s*\(/i, code: "UNSUPPORTED_OPERATION", message: "Dynamic eval cannot be compiled." },
  { pattern: /\barbitrary\s+(javascript|typescript|python|code)\b/i, code: "UNSUPPORTED_OPERATION", message: "Arbitrary code execution cannot be compiled." },
  { pattern: /\bexecute\s+(this\s+)?(shell|bash|powershell|cmd)\b/i, code: "UNSUPPORTED_OPERATION", message: "Raw shell snippets cannot be embedded in portable skills." },
  { pattern: /\bdownload\b.*\b(script|code)\b.*\bexecute\b/i, code: "UNSUPPORTED_OPERATION", message: "Downloading and executing code is outside the portable skill model." },
  { pattern: /\bescalate\s+permission/i, code: "PERMISSION_DENIED", message: "Permission escalation instructions are rejected." },
  { pattern: /\b(ignore|bypass)\s+(all\s+)?(restrictions|safety|permissions)\b/i, code: "PERMISSION_DENIED", message: "Instructions to bypass safety restrictions are rejected." },
  { pattern: /\bretry\s+forever\b/i, code: "UNBOUNDED_STEP", message: "Unbounded retries cannot be compiled." },
  { pattern: /\brepeat\s+until\s+successful\b/i, code: "UNBOUNDED_STEP", message: "Unbounded loops cannot be compiled." },
];

const DESTRUCTIVE_AMBIGUITY = /\b(clean\s+up|delete|remove|wipe|destroy|purge|erase)\b/i;

export class SafeSkillCompiler {
  constructor(private readonly tools: ToolRegistry) {}

  async compileSkillMarkdown(markdown: string, options: SkillMarkdownCompilationOptions = {}): Promise<SkillCompilationResult> {
    await options.events?.emit("skill.compile.started", {
      sourceId: options.sourceId ?? null,
      sourceHash: sourceHash(markdown),
    }, { actor: "skill-compiler" });

    const source = parseSkillMarkdown(markdown, options);
    await options.events?.emit("skill.compile.parsed", {
      sourceId: source.provenance.sourceId ?? null,
      diagnostics: summarizeDiagnostics(source.diagnostics),
    }, { actor: "skill-compiler" });

    const result = this.compileSource(source, options);
    if (result.plan) {
      await options.events?.emit("skill.compile.tool-resolved", {
        sourceId: source.provenance.sourceId ?? null,
        tools: result.plan.requiredTools,
        permissions: result.plan.permissions,
        risk: result.plan.risk,
      }, { actor: "skill-compiler" });
    }
    const eventPayload = {
      sourceId: source.provenance.sourceId ?? null,
      outcome: result.outcome,
      risk: result.provenance.risk,
      diagnostics: summarizeDiagnostics(result.diagnostics),
    };
    if (result.outcome === "REJECTED") {
      await options.events?.emit("skill.compile.rejected", eventPayload, { actor: "skill-compiler" });
    } else if (result.outcome === "NEEDS_CLARIFICATION") {
      await options.events?.emit("skill.compile.requires-clarification", eventPayload, { actor: "skill-compiler" });
    } else if (!result.portableExecution) {
      await options.events?.emit("skill.compile.validation-failed", eventPayload, { actor: "skill-compiler" });
    } else {
      await options.events?.emit("skill.compile.completed", eventPayload, { actor: "skill-compiler" });
    }
    return result;
  }

  compileSource(source: SkillSourceIR, options: SkillMarkdownCompilationOptions = {}): SkillCompilationResult {
    const diagnostics = [...source.diagnostics, ...rejectUnsafeSource(source)];
    const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };

    if (diagnostics.some((diagnostic) => diagnostic.severity === "error" && ["UNSUPPORTED_OPERATION", "PERMISSION_DENIED", "UNBOUNDED_STEP"].includes(diagnostic.code))) {
      return rejectedResult(source, diagnostics, "REJECTED", options);
    }

    if (source.steps.length === 0) {
      diagnostics.push(diagnostic("error", "MISSING_SECTION", "No bounded steps were found in SKILL.md.", {
        recommendation: "Add a Steps section with one bullet per tool-backed operation.",
      }));
      return rejectedResult(source, diagnostics, "NEEDS_CLARIFICATION", options);
    }

    if (DESTRUCTIVE_AMBIGUITY.test(sourceText(source)) && !hasExplicitMutationTool(source)) {
      diagnostics.push(diagnostic("error", "AMBIGUOUS_INSTRUCTION", "Ambiguous destructive or cleanup intent requires clarification.", {
        recommendation: "Declare a specific safe tool and exact non-destructive inputs.",
      }));
      return rejectedResult(source, diagnostics, "NEEDS_CLARIFICATION", options);
    }

    const plan = this.toPlan(source, diagnostics, limits, options);
    if (plan.diagnostics.some((entry) => entry.severity === "error")) {
      return resultFromPlan(source, plan, undefined, options);
    }

    const portableExecution = this.toPortableExecution(plan, limits);
    const dryRun = dryRunPortable(plan, portableExecution);
    const definition = portableSkillDefinitionFromCompilation(source, plan, portableExecution, options);
    return resultFromPlan(source, plan, portableExecution, options, definition, dryRun);
  }

  registerCandidate(registry: SkillRegistry, result: SkillCompilationResult, options: { readonly parentVersion?: string; readonly sourceRef?: string } = {}): SkillDefinition {
    if (!result.definition || !result.portableExecution) {
      throw new Error(`Cannot register skill compilation outcome ${result.outcome}.`);
    }
    registry.register(result.definition, "imported", "candidate", {
      parentVersion: options.parentVersion,
      portableInstructions: result.source.steps.map((step) => step.text).join("\n"),
      portableExecution: result.portableExecution,
      compilationProvenance: result.provenance,
      sourceRef: options.sourceRef ?? result.provenance.sourceId,
    });
    return result.definition;
  }

  async promoteCompiledCandidate(
    registry: SkillRegistry,
    skillId: string,
    version: string,
    reason: string,
    events?: EventBus,
  ): Promise<void> {
    const record = registry.getRecord(skillId, version);
    if (!record) throw new Error(`Compiled candidate ${skillId}@${version} was not found.`);
    if (record.status !== "candidate" && record.status !== "review") {
      throw new Error(`Compiled candidate ${skillId}@${version} is ${record.status}, not candidate or review.`);
    }
    registry.transition(skillId, "active", reason, { version });
    registry.setDefaultVersion(skillId, version, reason);
    await events?.emit("skill.compile.promoted", {
      skillId,
      version,
      fingerprint: registry.getRecord(skillId, version)?.fingerprint ?? null,
    }, { actor: "skill-compiler" });
  }

  private toPlan(
    source: SkillSourceIR,
    diagnostics: CompilationDiagnostic[],
    limits: typeof DEFAULT_LIMITS,
    options: SkillMarkdownCompilationOptions,
  ): SkillPlanIR {
    const steps: SkillPlanStepIR[] = [];
    const stepIds = new Set<string>();
    const toolIds = new Set<string>();
    const permissions = new Set<Permission>();

    for (const sourceStep of source.steps) {
      if (stepIds.has(sourceStep.id)) {
        diagnostics.push(diagnostic("error", "INVALID_DEPENDENCY", `Duplicate step id ${sourceStep.id}.`, { stepId: sourceStep.id }));
        continue;
      }
      stepIds.add(sourceStep.id);
      const resolution = this.resolveTool(sourceStep, source);
      diagnostics.push(...resolution.diagnostics);
      const resolvedTool = resolution.tool;
      const inputs = resolvedTool ? inferInputs(resolvedTool, sourceStep, diagnostics) : {};
      const dependencies = inferDependencies(sourceStep, source.steps);
      const retry = inferRetry(sourceStep.text, diagnostics, sourceStep.id);
      const timeout = inferTimeout(sourceStep.text, diagnostics, sourceStep.id);

      if (retry !== undefined && retry > limits.maxRetriesPerStep) {
        diagnostics.push(diagnostic("error", "UNBOUNDED_STEP", `Step ${sourceStep.id} requested ${retry} retries; max is ${limits.maxRetriesPerStep}.`, {
          stepId: sourceStep.id,
          recommendation: "Use a retry count at or below the compiler bound.",
        }));
      }
      if (timeout !== undefined && timeout > limits.timeoutMs) {
        diagnostics.push(diagnostic("error", "UNBOUNDED_STEP", `Step ${sourceStep.id} requested timeout ${timeout}ms; max is ${limits.timeoutMs}ms.`, {
          stepId: sourceStep.id,
          recommendation: "Use a bounded timeout within policy.",
        }));
      }

      if (resolvedTool) {
        toolIds.add(resolvedTool.id);
        for (const permission of resolvedTool.permissions) permissions.add(permission);
        const validationInput = validationProbe(inputs);
        const tool = this.tools.get(resolvedTool.id);
        const validation = tool.ok ? validateToolInput(tool.data, validationInput) : undefined;
        if (validation && !validation.ok) {
          diagnostics.push(diagnostic("error", "INVALID_TOOL_INPUT", validation.error.message, {
            stepId: sourceStep.id,
            recommendation: "Declare all required tool inputs as constants or supported bindings.",
          }));
        }
      }

      steps.push({
        id: sourceStep.id,
        intent: sourceStep.text,
        candidateTool: resolution.candidateTool,
        resolvedTool,
        inputs,
        dependencies,
        expectedOutputs: [],
        retryPolicyRequest: retry,
        timeoutRequestMs: timeout,
        verificationRequirement: source.verification[0],
      });
    }

    for (const step of steps) {
      for (const dependency of step.dependencies) {
        if (!stepIds.has(dependency)) {
          diagnostics.push(diagnostic("error", "INVALID_DEPENDENCY", `Step ${step.id} depends on missing step ${dependency}.`, { stepId: step.id }));
        }
      }
      for (const binding of findNodeBindings(step.inputs)) {
        if (!stepIds.has(binding)) {
          diagnostics.push(diagnostic("error", "UNBOUND_OUTPUT", `Step ${step.id} references missing node ${binding}.`, { stepId: step.id }));
        }
      }
    }

    if (steps.length > limits.maxSteps) {
      diagnostics.push(diagnostic("error", "UNBOUNDED_STEP", `Plan has ${steps.length} steps; max is ${limits.maxSteps}.`));
    }
    if (steps.length > 0 && hasCycle(steps)) {
      diagnostics.push(diagnostic("error", "INVALID_DEPENDENCY", "Plan dependency graph contains a cycle."));
    }

    const permissionConflict = options.allowedPermissions
      ? [...permissions].find((permission) => !options.allowedPermissions!.includes(permission))
      : undefined;
    if (permissionConflict) {
      diagnostics.push(diagnostic("error", "PERMISSION_DENIED", `Permission ${permissionConflict} is not allowed by compiler policy.`));
    }
    for (const permission of permissions) {
      if (isProhibitedPermission(permission)) {
        diagnostics.push(diagnostic("error", "PERMISSION_DENIED", `Permission ${permission} cannot be granted to compiled portable skills.`));
      }
    }

    const risk = classifyRisk([...permissions], [...toolIds]);
    if (risk === "PRIVILEGED" || risk === "DESTRUCTIVE") {
      diagnostics.push(diagnostic("error", "PERMISSION_DENIED", `Risk ${risk} cannot be compiled into a portable skill.`));
    }

    return {
      schemaVersion: SKILL_PLAN_IR_SCHEMA_VERSION,
      skillId: options.skillId ?? slug(source.name ?? "compiled-skill"),
      name: source.name ?? "Compiled Skill",
      version: options.version ?? "0.1.0",
      description: source.description ?? source.purpose ?? "Compiled portable skill candidate.",
      category: options.category ?? "custom",
      tags: [...new Set([...(options.tags ?? []), ...source.requiredCapabilities.map(slug)].filter(Boolean))],
      steps: normalizePlanSteps(steps),
      requiredTools: [...toolIds].sort(),
      permissions: [...permissions].sort(),
      risk,
      diagnostics,
    };
  }

  private resolveTool(
    sourceStep: SkillSourceStepIR,
    source: SkillSourceIR,
  ): { readonly tool?: ToolMetadata; readonly candidateTool?: string; readonly diagnostics: readonly CompilationDiagnostic[] } {
    const diagnostics: CompilationDiagnostic[] = [];
    const textToolIds = extractToolIds(sourceStep.text);
    const candidates = textToolIds.length > 0 ? textToolIds : source.suggestedTools.length === 1 ? [source.suggestedTools[0]!] : [];
    if (candidates.length > 1) {
      diagnostics.push(diagnostic("error", "AMBIGUOUS_TOOL", `Step ${sourceStep.id} mentions multiple tools: ${candidates.join(", ")}.`, { stepId: sourceStep.id }));
      return { candidateTool: candidates[0], diagnostics };
    }
    if (candidates.length === 0) {
      const capabilityMatches = resolveByCapability(sourceStep.text, this.tools.list());
      if (capabilityMatches.length === 1) {
        return { tool: capabilityMatches[0], candidateTool: capabilityMatches[0].id, diagnostics };
      }
      diagnostics.push(diagnostic("error", capabilityMatches.length > 1 ? "AMBIGUOUS_TOOL" : "UNKNOWN_TOOL", `Step ${sourceStep.id} does not resolve to a unique registered tool.`, {
        stepId: sourceStep.id,
        recommendation: "Mention the exact tool id, for example core.workspace.list-files.",
      }));
      return { diagnostics };
    }

    const candidateTool = candidates[0]!;
    const tool = this.tools.get(candidateTool);
    if (!tool.ok) {
      diagnostics.push(diagnostic("error", "UNKNOWN_TOOL", `Tool ${candidateTool} is not registered.`, { stepId: sourceStep.id }));
      return { candidateTool, diagnostics };
    }
    diagnostics.push(diagnostic("info", "TOOL_COMPATIBILITY", `Resolved ${candidateTool}.`, { stepId: sourceStep.id }));
    return { tool: tool.data.describe(), candidateTool, diagnostics };
  }

  private toPortableExecution(plan: SkillPlanIR, limits: typeof DEFAULT_LIMITS): PortableSkillExecutionDefinition {
    const steps: PortableSkillStep[] = plan.steps.map((step) => ({
      id: step.id,
      description: step.intent,
      dependencies: step.dependencies,
      requiredTools: step.resolvedTool ? [step.resolvedTool.id] : [],
      toolInvocations: step.resolvedTool ? [{
        toolId: step.resolvedTool.id,
        input: step.inputs,
        reason: step.intent,
      }] : [],
      timeoutMs: step.timeoutRequestMs ?? limits.timeoutMs,
      retryPolicy: {
        maxRetries: step.retryPolicyRequest ?? 0,
        backoff: "fixed",
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
    }));

    return {
      schemaVersion: PORTABLE_SKILL_EXECUTION_SCHEMA_VERSION,
      steps,
      compiledAgainstTools: plan.requiredTools.map((toolId) => {
        const tool = this.tools.get(toolId);
        if (!tool.ok) throw new Error(`Resolved tool ${toolId} disappeared during compilation.`);
        const metadata = tool.data.describe();
        return {
          toolId,
          metadataFingerprint: toolMetadataFingerprint(metadata),
          permissions: metadata.permissions,
        };
      }).sort((a, b) => a.toolId.localeCompare(b.toolId)),
      risk: plan.risk,
      limits: {
        maxSteps: limits.maxSteps,
        maxToolCalls: Math.min(limits.maxToolCalls, steps.reduce((sum, step) => sum + step.toolInvocations.length, 0)),
        maxRetriesPerStep: limits.maxRetriesPerStep,
        timeoutMs: limits.timeoutMs,
      },
    };
  }
}

export function parseSkillMarkdown(markdown: string, options: Pick<SkillMarkdownCompilationOptions, "sourceId"> = {}): SkillSourceIR {
  const sections = new Map<SectionName, string[]>();
  const diagnostics: CompilationDiagnostic[] = [];
  let name: string | undefined;
  let current: SectionName | undefined;
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const heading = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const title = heading[2]!.trim();
      const normalized = title.toLowerCase().replace(/[:#]+$/g, "").trim();
      const alias = SECTION_ALIASES.get(normalized);
      if (heading[1] === "#" && !alias && !name) {
        name = title;
        current = "description";
        continue;
      }
      current = alias;
      if (current && !sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current) sections.set(current, [...(sections.get(current) ?? []), raw]);
  }

  if (!name) {
    const explicit = firstLabeledValue(markdown, "name");
    name = explicit;
  }
  if (!name) diagnostics.push(diagnostic("warning", "MISSING_SECTION", "No skill name was found."));

  const steps = parseSteps(sections.get("steps") ?? sections.get("instructions") ?? []);
  const tools = [...new Set([...extractToolIds(markdown), ...listItems(sections.get("tools") ?? []).flatMap(extractToolIds)])].sort();
  const description = paragraph(sections.get("description"));
  const purpose = paragraph(sections.get("purpose"));
  if (!description && !purpose) diagnostics.push(diagnostic("warning", "MISSING_SECTION", "No description or purpose section was found."));
  if (tools.length === 0) diagnostics.push(diagnostic("warning", "MISSING_SECTION", "No explicit registered tool ids were found."));
  if (steps.length === 0) diagnostics.push(diagnostic("warning", "MISSING_SECTION", "No steps section was found."));

  return {
    schemaVersion: SKILL_SOURCE_IR_SCHEMA_VERSION,
    name,
    description,
    purpose,
    inputs: listItems(sections.get("inputs") ?? []),
    outputs: listItems(sections.get("outputs") ?? []),
    requiredCapabilities: listItems(sections.get("preconditions") ?? []),
    suggestedTools: tools,
    constraints: listItems(sections.get("constraints") ?? []),
    steps,
    expectedResult: paragraph(sections.get("postconditions")),
    failureConditions: listItems(sections.get("failure") ?? []),
    safetyNotes: listItems(sections.get("safety") ?? []),
    verification: listItems(sections.get("verification") ?? []),
    examples: listItems(sections.get("examples") ?? []),
    provenance: {
      sourceType: "skill.md",
      sourceId: options.sourceId,
      sourceHash: sourceHash(markdown),
      parsedAt: new Date().toISOString(),
      parserVersion: SAFE_SKILL_COMPILER_VERSION,
    },
    diagnostics,
  };
}

function portableSkillDefinitionFromCompilation(
  source: SkillSourceIR,
  plan: SkillPlanIR,
  portableExecution: PortableSkillExecutionDefinition,
  options: SkillMarkdownCompilationOptions,
): SkillDefinition {
  const manifest: SkillManifest = {
    id: plan.skillId,
    name: plan.name,
    version: plan.version,
    description: plan.description,
    author: options.author ?? "QUACK Safe Skill Compiler",
    category: plan.category,
    tags: plan.tags,
    requiresPermissions: plan.permissions,
    requiresTools: plan.requiredTools,
    entry: "portable://compiled-skill",
    documentation: source.provenance.sourceId,
  };
  const provenance = compilationProvenance(source, plan, plan.diagnostics, outcomeFor(plan.diagnostics), options);
  return {
    manifest,
    portableExecution,
    compilationProvenance: provenance,
    execute: async () => ({
      ok: true,
      data: {
        compiled: true,
        executable: true,
        sourceId: source.provenance.sourceId,
        outcome: provenance.outcome,
      },
      durationMs: 0,
    }),
  };
}

function resultFromPlan(
  source: SkillSourceIR,
  plan: SkillPlanIR,
  portableExecution: PortableSkillExecutionDefinition | undefined,
  options: SkillMarkdownCompilationOptions,
  definition?: SkillDefinition,
  dryRun?: SkillCompilationDryRun,
): SkillCompilationResult {
  const outcome = portableExecution ? outcomeFor(plan.diagnostics) : failureOutcome(plan.diagnostics);
  const provenance = definition?.compilationProvenance ?? compilationProvenance(source, plan, plan.diagnostics, outcome, options);
  return {
    outcome,
    diagnostics: plan.diagnostics,
    source,
    plan,
    portableExecution,
    definition,
    dryRun,
    provenance,
  };
}

function rejectedResult(
  source: SkillSourceIR,
  diagnostics: CompilationDiagnostic[],
  outcome: SkillCompilationOutcome,
  options: SkillMarkdownCompilationOptions,
): SkillCompilationResult {
  const plan: SkillPlanIR = {
    schemaVersion: SKILL_PLAN_IR_SCHEMA_VERSION,
    skillId: options.skillId ?? slug(source.name ?? "compiled-skill"),
    name: source.name ?? "Compiled Skill",
    version: options.version ?? "0.1.0",
    description: source.description ?? source.purpose ?? "Rejected compiled skill candidate.",
    category: options.category ?? "custom",
    tags: options.tags ?? [],
    steps: [],
    requiredTools: [],
    permissions: [],
    risk: "PRIVILEGED",
    diagnostics,
  };
  return {
    outcome,
    diagnostics,
    source,
    plan,
    provenance: compilationProvenance(source, plan, diagnostics, outcome, options),
  };
}

function compilationProvenance(
  source: SkillSourceIR,
  plan: SkillPlanIR,
  diagnostics: readonly CompilationDiagnostic[],
  outcome: SkillCompilationOutcome,
  _options: SkillMarkdownCompilationOptions,
): SkillCompilationProvenance {
  return {
    sourceType: "skill.md",
    sourceId: source.provenance.sourceId,
    sourceHash: source.provenance.sourceHash,
    compilerVersion: SAFE_SKILL_COMPILER_VERSION,
    schemaVersion: 1,
    toolRegistryFingerprint: createHash("sha256").update(stableStringify(plan.steps.map((step) => step.resolvedTool ?? null))).digest("hex"),
    compiledAt: new Date().toISOString(),
    diagnostics,
    outcome,
    risk: plan.risk,
  };
}

function parseSteps(lines: readonly string[]): SkillSourceStepIR[] {
  const steps: SkillSourceStepIR[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (!line) continue;
    const match = line.match(/^(?:[-*]\s+|\d+[.)]\s+)?(?:`?([a-z0-9][a-z0-9._-]*)`?\s*:\s*)?(.*)$/i);
    const text = (match?.[2] ?? line).trim();
    if (!text) continue;
    steps.push({
      id: slug(match?.[1] ?? `step-${steps.length + 1}`),
      text,
      sourceLocation: `steps:${index + 1}`,
    });
  }
  return steps;
}

function listItems(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

function paragraph(lines?: readonly string[]): string | undefined {
  const text = (lines ?? []).map((line) => line.trim()).filter(Boolean).join(" ").trim();
  return text || undefined;
}

function firstLabeledValue(markdown: string, label: string): string | undefined {
  const match = markdown.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
  return match?.[1]?.trim();
}

function extractToolIds(text: string): string[] {
  return [...new Set([...text.matchAll(/\b(?:core|tool|plugin|workspace|admin)\.[a-z0-9._-]+\b/gi)].map((match) => match[0]))];
}

function rejectUnsafeSource(source: SkillSourceIR): CompilationDiagnostic[] {
  const text = sourceText(source);
  return UNSUPPORTED_PATTERNS
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => diagnostic("error", entry.code, entry.message, {
      recommendation: "Represent the operation with an existing bounded, permission-checked tool or leave it unsupported.",
    }));
}

function sourceText(source: SkillSourceIR): string {
  return [
    source.name,
    source.description,
    source.purpose,
    ...source.constraints,
    ...source.safetyNotes,
    ...source.steps.map((step) => step.text),
    ...source.verification,
  ].filter(Boolean).join("\n");
}

function hasExplicitMutationTool(source: SkillSourceIR): boolean {
  return source.suggestedTools.some((tool) => tool === "core.workspace.write-file");
}

function resolveByCapability(text: string, tools: readonly ToolMetadata[]): ToolMetadata[] {
  const lower = text.toLowerCase();
  if (/\blist\b.*\bfiles?\b/.test(lower)) return tools.filter((tool) => tool.id === "core.workspace.list-files");
  if (/\bread\b.*\bfiles?\b/.test(lower)) return tools.filter((tool) => tool.id === "core.workspace.read-file");
  if (/\becho\b|\breturn\b.*\bmessage\b/.test(lower)) return tools.filter((tool) => tool.id === "core.echo");
  return [];
}

function inferInputs(tool: ToolMetadata, step: SkillSourceStepIR, diagnostics: CompilationDiagnostic[]): JsonObject {
  const parsed = parseInputAssignments(step.text);
  if (tool.id === "core.echo") {
    return { message: parsed["message"] ?? { $fromInput: "goal" } };
  }
  if (tool.id === "core.workspace.list-files") {
    warnOnTraversal(parsed["path"], diagnostics, step.id);
    return {
      path: parsed["path"] ?? ".",
      depth: parsed["depth"] ?? 1,
    };
  }
  if (tool.id === "core.workspace.read-file") {
    const path = parsed["path"];
    if (path === undefined) {
      diagnostics.push(diagnostic("error", "MISSING_INPUT", "Read file step requires a path input.", {
        stepId: step.id,
        recommendation: "Use path=$parameter:path or a constant workspace-relative path.",
      }));
      return {};
    }
    warnOnTraversal(path, diagnostics, step.id);
    return { path };
  }
  if (tool.id === "core.workspace.write-file") {
    const path = parsed["path"];
    const content = parsed["content"];
    if (path === undefined || content === undefined) {
      diagnostics.push(diagnostic("error", "MISSING_INPUT", "Write file step requires path and content inputs.", { stepId: step.id }));
    }
    warnOnTraversal(path, diagnostics, step.id);
    return {
      path: path ?? "",
      content: content ?? "",
      createDirectories: parsed["createDirectories"] ?? false,
      overwrite: parsed["overwrite"] ?? false,
    };
  }
  if (tool.id === "core.terminal.execute") {
    diagnostics.push(diagnostic("error", "UNSUPPORTED_OPERATION", "Terminal execution is not compilable from SKILL.md prose.", { stepId: step.id }));
  }
  return parsed;
}

function warnOnTraversal(value: JsonValue | undefined, diagnostics: CompilationDiagnostic[], stepId: string): void {
  if (typeof value === "string" && /(^|[\\/])\.\.([\\/]|$)/.test(value)) {
    diagnostics.push(diagnostic("warning", "AMBIGUOUS_INSTRUCTION", "Path contains parent traversal; runtime workspace guards must authorize or reject it.", {
      stepId,
      recommendation: "Use a workspace-relative path that does not traverse upward.",
    }));
  }
}

function parseInputAssignments(text: string): JsonObject {
  const parsed: Record<string, JsonValue> = {};
  const assignmentPattern = /([a-zA-Z][\w.-]*)\s*[:=]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;]+)/g;
  for (const match of text.matchAll(assignmentPattern)) {
    const key = match[1]!;
    if (["tool", "uses", "use", "after", "depends"].includes(key.toLowerCase())) continue;
    parsed[key] = parseValue(match[2]!);
  }
  return parsed;
}

function parseValue(raw: string): JsonValue {
  const unquoted = raw.replace(/^["']|["']$/g, "");
  if (unquoted === "$goal" || unquoted === "$fromInput:goal") return { $fromInput: "goal" };
  if (unquoted.startsWith("$parameter:")) return { $fromParameter: unquoted.slice("$parameter:".length) };
  if (unquoted.startsWith("$fromParameter:")) return { $fromParameter: unquoted.slice("$fromParameter:".length) };
  if (unquoted.startsWith("$fromNode:")) return nodeBinding(unquoted.slice("$fromNode:".length));
  if (unquoted.startsWith("node:")) return nodeBinding(unquoted.slice("node:".length));
  if (/^\d+$/.test(unquoted)) return Number.parseInt(unquoted, 10);
  if (unquoted === "true") return true;
  if (unquoted === "false") return false;
  return unquoted;
}

function nodeBinding(path: string): JsonObject {
  const [nodeId, ...rest] = path.split(".");
  const outputPath = rest.join(".");
  return outputPath ? { $fromNode: nodeId ?? "", path: outputPath } : { $fromNode: nodeId ?? "" };
}

function inferDependencies(step: SkillSourceStepIR, allSteps: readonly SkillSourceStepIR[]): string[] {
  const dependencies = new Set<string>();
  const text = step.text;
  for (const match of text.matchAll(/\b(?:after|depends(?:\s+on)?)\s+`?([a-z0-9][a-z0-9._-]*)`?/gi)) {
    dependencies.add(slug(match[1]!));
  }
  for (const binding of findNodeBindings(parseInputAssignments(text))) dependencies.add(binding);
  return [...dependencies].filter((dependency) => allSteps.some((candidate) => candidate.id === dependency)).sort();
}

function inferRetry(text: string, diagnostics: CompilationDiagnostic[], stepId: string): number | undefined {
  if (/\bretry\s+forever\b/i.test(text)) {
    diagnostics.push(diagnostic("error", "UNBOUNDED_STEP", "Retry forever is not allowed.", { stepId }));
    return undefined;
  }
  const match = text.match(/\bretries?\s*[:=]?\s*(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function inferTimeout(text: string, _diagnostics: CompilationDiagnostic[], _stepId: string): number | undefined {
  const match = text.match(/\btimeout(?:Ms)?\s*[:=]?\s*(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function normalizePlanSteps(steps: readonly SkillPlanStepIR[]): SkillPlanStepIR[] {
  return [...steps].sort((a, b) => a.id.localeCompare(b.id)).map((step) => ({
    ...step,
    dependencies: [...step.dependencies].sort(),
    inputs: sortKeys(step.inputs) as JsonObject,
  }));
}

function dryRunPortable(plan: SkillPlanIR, portableExecution: PortableSkillExecutionDefinition): SkillCompilationDryRun {
  const selectedTools = plan.requiredTools.map((toolId) => plan.steps.find((step) => step.resolvedTool?.id === toolId)?.resolvedTool).filter(Boolean) as ToolMetadata[];
  return {
    resolvedDag: portableExecution.steps.map((step) => ({
      id: step.id,
      dependencies: step.dependencies ?? [],
      tools: step.requiredTools,
      bindings: step.toolInvocations.flatMap((invocation) => bindingDescriptions(invocation.input)),
      timeoutMs: step.timeoutMs,
      maxRetries: step.retryPolicy?.maxRetries ?? 0,
    })),
    selectedTools,
    permissions: plan.permissions,
    risk: plan.risk,
    sideEffects: sideEffectsFor(plan.permissions, plan.requiredTools),
    estimatedBounds: {
      maxSteps: portableExecution.limits?.maxSteps ?? DEFAULT_LIMITS.maxSteps,
      maxToolCalls: portableExecution.limits?.maxToolCalls ?? DEFAULT_LIMITS.maxToolCalls,
      maxRetriesPerStep: portableExecution.limits?.maxRetriesPerStep ?? DEFAULT_LIMITS.maxRetriesPerStep,
      timeoutMs: portableExecution.limits?.timeoutMs ?? DEFAULT_LIMITS.timeoutMs,
    },
  };
}

function outcomeFor(diagnostics: readonly CompilationDiagnostic[]): SkillCompilationOutcome {
  if (diagnostics.some((entry) => entry.severity === "error")) return failureOutcome(diagnostics);
  if (diagnostics.some((entry) => entry.severity === "warning")) return "COMPILED_WITH_WARNINGS";
  return "COMPILED";
}

function failureOutcome(diagnostics: readonly CompilationDiagnostic[]): SkillCompilationOutcome {
  if (diagnostics.some((entry) => entry.code === "UNKNOWN_TOOL" || entry.code === "PERMISSION_DENIED" || entry.code === "UNBOUNDED_STEP")) return "REJECTED";
  if (diagnostics.some((entry) => entry.code === "AMBIGUOUS_INSTRUCTION" || entry.code === "AMBIGUOUS_TOOL" || entry.code === "MISSING_INPUT" || entry.code === "MISSING_SECTION")) {
    return "NEEDS_CLARIFICATION";
  }
  if (diagnostics.some((entry) => entry.code === "UNSUPPORTED_OPERATION")) return "UNSUPPORTED";
  return "REJECTED";
}

function validationProbe(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(validationProbe);
  if (!isPlainObject(value)) return value;
  if (typeof value["$fromInput"] === "string") return "sample";
  if (typeof value["$fromParameter"] === "string") return "sample";
  if (typeof value["$fromNode"] === "string") return "sample";
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, validationProbe(nested)]));
}

function findNodeBindings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(findNodeBindings);
  if (!isPlainObject(value)) return [];
  if (typeof value["$fromNode"] === "string") return [value["$fromNode"]];
  return Object.values(value).flatMap(findNodeBindings);
}

function bindingDescriptions(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => bindingDescriptions(item, `${prefix}[${index}]`));
  if (!isPlainObject(value)) return [];
  if (typeof value["$fromInput"] === "string") return [`${prefix || "$"} <= input.${value["$fromInput"]}`];
  if (typeof value["$fromParameter"] === "string") return [`${prefix || "$"} <= parameter.${value["$fromParameter"]}`];
  if (typeof value["$fromNode"] === "string") return [`${prefix || "$"} <= node.${value["$fromNode"]}${value["path"] ? `.${value["path"]}` : ""}`];
  return Object.entries(value).flatMap(([key, nested]) => bindingDescriptions(nested, prefix ? `${prefix}.${key}` : key));
}

function classifyRisk(permissions: readonly Permission[], toolIds: readonly string[]): SkillCompilationRisk {
  if (permissions.some((permission) => isProhibitedPermission(permission)) || toolIds.includes("core.terminal.execute")) return "PRIVILEGED";
  if (permissions.some((permission) => permission.includes("delete") || permission.includes("external.write"))) return "DESTRUCTIVE";
  if (permissions.some((permission) => permission.includes("external") || permission.includes("network"))) return "EXTERNAL_SIDE_EFFECT";
  if (permissions.includes("workspace.write")) return "WORKSPACE_MUTATION";
  if (permissions.some((permission) => permission.includes("write"))) return "LOW_RISK_MUTATION";
  return "READ_ONLY";
}

function sideEffectsFor(permissions: readonly Permission[], toolIds: readonly string[]): string[] {
  const effects = new Set<string>();
  if (permissions.includes("workspace.read")) effects.add("Reads workspace files or metadata.");
  if (permissions.includes("workspace.write")) effects.add("Writes files inside the workspace when executed outside pure dry-run.");
  if (toolIds.includes("core.terminal.execute")) effects.add("Would execute terminal commands; compiler rejects this tool.");
  if (effects.size === 0) effects.add("No side effects predicted from registered tool metadata.");
  return [...effects].sort();
}

function summarizeDiagnostics(diagnostics: readonly CompilationDiagnostic[]): JsonObject {
  return {
    errors: diagnostics.filter((entry) => entry.severity === "error").length,
    warnings: diagnostics.filter((entry) => entry.severity === "warning").length,
    infos: diagnostics.filter((entry) => entry.severity === "info").length,
    codes: [...new Set(diagnostics.map((entry) => entry.code))].sort(),
  };
}

function hasCycle(steps: readonly Pick<SkillPlanStepIR, "id" | "dependencies">[]): boolean {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return steps.some((step) => visit(step.id));
}

function isProhibitedPermission(permission: string): boolean {
  return permission === "filesystem.write.external" ||
    permission === "secrets.read" ||
    permission === "secrets.write" ||
    permission === "plugin.install" ||
    permission === "everything" ||
    permission === "terminal.execute";
}

function sourceHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "compiled-skill";
}

function diagnostic(
  severity: CompilationDiagnostic["severity"],
  code: CompilationDiagnosticCode,
  message: string,
  options: Omit<CompilationDiagnostic, "severity" | "code" | "message"> = {},
): CompilationDiagnostic {
  return { severity, code, message, ...options };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, sortKeys(object[key])]));
}
