/**
 * Phase 7D — Reasoning Capability Pack.
 *
 * Native QUACK reasoning skills: ultrathink, skeptic, mirror, punch,
 * no-yap, blind-spots, OODA, artifacts. These are NOT privileged agents.
 * They are governed reasoning policies: declarative skill packages whose
 * workflow steps inject a reasoning discipline into the mission graph via
 * the canonical path (contextualSkillSelector → compileSkillContributions →
 * governed tool execution). Each skill is LOW risk: read-only grounding
 * step, no elevated permissions, no network, no secrets.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ReasoningSkillSpec {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly policy: readonly string[];
  readonly tags: readonly string[];
  readonly triggers: readonly string[];
}

/** The eight governed reasoning policies. Content is the contract. */
export const REASONING_SKILLS: readonly ReasoningSkillSpec[] = [
  {
    id: "reasoning.ultrathink",
    name: "Ultrathink",
    purpose: "Deep analysis mode: decompose the problem fully before acting.",
    policy: [
      "Restate the goal and success criteria in one sentence before any work.",
      "Decompose the problem into independently verifiable parts.",
      "For each part, list what is known, what is assumed, and what must be discovered.",
      "Choose the approach that satisfies the success criteria with the least irreversible change.",
      "Only begin execution after the decomposition covers every requested behavior.",
    ],
    tags: ["ultrathink", "deep", "analysis", "architecture", "decompose", "investigate", "design"],
    triggers: ["ultrathink", "analyze deeply", "architecture", "think hard", "decompose"],
  },
  {
    id: "reasoning.skeptic",
    name: "Skeptic",
    purpose: "Challenge assumptions: verify claims against evidence before relying on them.",
    policy: [
      "List every assumption the plan depends on.",
      "Mark each assumption as verified (evidence exists) or unverified.",
      "For unverified assumptions, state the cheapest check that would verify or refute them.",
      "Prefer plans that survive if the weakest assumption is false.",
      "Never present an unverified assumption as fact in output.",
    ],
    tags: ["skeptic", "challenge", "assumptions", "verify", "evidence", "doubt"],
    triggers: ["skeptic", "challenge assumptions", "verify claims", "are you sure"],
  },
  {
    id: "reasoning.mirror",
    name: "Mirror",
    purpose: "Self-review: critique the produced work as an independent reviewer would.",
    policy: [
      "After producing output, re-read it as if another engineer wrote it.",
      "Check correctness against the original goal, not against the effort spent.",
      "List the three weakest points of the produced work.",
      "Fix material weaknesses before declaring completion.",
      "Report what was checked and what was not.",
    ],
    tags: ["mirror", "self-review", "critique", "review", "quality", "reflect"],
    triggers: ["mirror", "self-review", "review your work", "critique"],
  },
  {
    id: "reasoning.punch",
    name: "Punch",
    purpose: "Direct concise execution: smallest correct action, no ceremony.",
    policy: [
      "Identify the single action that directly satisfies the goal.",
      "Execute it without preamble, scaffolding, or unrequested elaboration.",
      "Report result and evidence in the fewest words that remain unambiguous.",
      "Skip anything that does not change the outcome.",
    ],
    tags: ["punch", "direct", "concise", "minimal", "quick", "fast"],
    triggers: ["punch", "directly", "concise", "be brief", "just do it"],
  },
  {
    id: "reasoning.no-yap",
    name: "No Yap",
    purpose: "Verbosity control: strip filler from reasoning and output.",
    policy: [
      "State facts and actions only; omit restatements of the request.",
      "Delete hedging phrases unless uncertainty is material to the decision.",
      "Prefer lists over paragraphs when more than two items exist.",
      "If a sentence does not change a decision or record a fact, cut it.",
    ],
    tags: ["no-yap", "verbosity", "concise", "terse", "short", "filler"],
    triggers: ["no yap", "less verbose", "terse", "shorter"],
  },
  {
    id: "reasoning.blind-spots",
    name: "Blind Spots",
    purpose: "Risk discovery: hunt for what the plan fails to consider.",
    policy: [
      "Enumerate failure modes: what breaks under load, edge input, or partial failure.",
      "Check security boundaries: input validation, authorization, secrets, injection.",
      "Check data integrity: loss, duplication, corruption, leak paths.",
      "Check the quiet paths: error states, empty states, denied states.",
      "Name at least one risk the current plan does not handle.",
    ],
    tags: ["blind-spots", "risk", "failure", "edge", "security", "what-if", "danger"],
    triggers: ["blind spots", "risks", "failure modes", "what could go wrong"],
  },
  {
    id: "reasoning.ooda",
    name: "OODA",
    purpose: "Observe → Orient → Decide → Act loop for decisions under uncertainty.",
    policy: [
      "Observe: gather only facts relevant to the current decision.",
      "Orient: relate observations to the goal and known constraints.",
      "Decide: choose one action with an explicit reason and a reversibility check.",
      "Act: execute the decision, then observe the result before the next loop.",
      "If the observation contradicts the orientation, restart the loop instead of forcing the action.",
    ],
    tags: ["ooda", "loop", "observe", "orient", "decide", "act", "iterate"],
    triggers: ["ooda", "observe orient", "iteration loop", "feedback loop"],
  },
  {
    id: "reasoning.artifacts",
    name: "Artifacts",
    purpose: "Structured output generation: results as typed, checkable artifacts.",
    policy: [
      "Determine the output schema before generating content.",
      "Produce the artifact in the format the consumer validates (JSON, markdown, diff).",
      "Include provenance: source, generated-at, and inputs used.",
      "Make the artifact machine-checkable: no unstructured prose where structure is possible.",
    ],
    tags: ["artifacts", "structured", "output", "json", "schema", "format"],
    triggers: ["artifacts", "structured output", "json output", "schema"],
  },
];

export interface ReasoningPackOptions {
  /** Destination root, e.g. skills/ */
  readonly destinationRoot: string;
  /** Skip writing when the target already exists (idempotent installs). */
  readonly overwrite?: boolean;
}

export interface ReasoningPackResult {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

/** Materialize the reasoning pack as governed skill packages. */
export function writeReasoningSkillPack(options: ReasoningPackOptions): ReasoningPackResult {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const skill of REASONING_SKILLS) {
    const packageRoot = join(options.destinationRoot, skill.id.replace("reasoning.", ""));
    try {
      mkdirSync(join(packageRoot, "tests"), { recursive: true });
    } catch {
      skipped.push(packageRoot);
      continue;
    }
    writeFileSync(join(packageRoot, "manifest.json"), JSON.stringify(reasoningManifest(skill), null, 2) + "\n", "utf8");
    writeFileSync(join(packageRoot, "workflow.json"), JSON.stringify(reasoningWorkflow(skill), null, 2) + "\n", "utf8");
    writeFileSync(join(packageRoot, "instructions.md"), reasoningInstructions(skill) + "\n", "utf8");
    writeFileSync(join(packageRoot, "permissions.yaml"), reasoningPermissions(skill) + "\n", "utf8");
    writeFileSync(join(packageRoot, "README.md"), reasoningReadme(skill) + "\n", "utf8");
    writeFileSync(join(packageRoot, "tests", "policy.test.json"), JSON.stringify({
      skillId: skill.id,
      checks: skill.policy.map((rule, index) => ({
        id: `policy-${index + 1}`,
        rule,
        /** A goal naming the trigger must select this skill; the mission
         * graph must carry every policy rule as a node description. */
        assertion: "manifest-and-workflow carry this rule verbatim",
      })),
    }, null, 2) + "\n", "utf8");
    written.push(packageRoot);
  }
  return { written, skipped };
}

function reasoningManifest(skill: ReasoningSkillSpec) {
  return {
    id: skill.id,
    name: skill.name,
    version: "1.0.0",
    description: `${skill.purpose} Governed reasoning policy: ${skill.triggers.slice(0, 3).join(", ")}.`,
    author: "QUACK",
    trustLevel: "verified",
    requiredCapabilities: ["permission.workspace.read"],
    allowedTools: ["core.workspace.list-files"],
    inputSchema: { type: "object", properties: { goal: { type: "string" } } },
    outputSchema: { type: "object", properties: { discipline: { type: "string" } } },
    executionLimits: { timeoutMs: 30_000, maxIterations: 2, maxToolCalls: 2, maxRetriesPerStep: 0 },
    category: "reasoning",
    tags: [...skill.tags, "reasoning-policy"],
  };
}

function reasoningWorkflow(skill: ReasoningSkillSpec) {
  return {
    steps: [
      {
        id: "ground",
        description: "Ground the reasoning discipline in the actual workspace before applying it.",
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 1 }, reason: `Ground ${skill.name} policy in real files.` }],
        timeoutMs: 5_000,
      },
      {
        id: "apply-policy",
        description: `Apply ${skill.name} policy: ${skill.policy.join(" ")}`,
        requiredTools: ["core.workspace.list-files"],
        toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 1 }, reason: "Read-only policy application anchor; no state is mutated." }],
        timeoutMs: 5_000,
      },
    ],
  };
}

function reasoningInstructions(skill: ReasoningSkillSpec): string {
  return [
    `# ${skill.name} (${skill.id})`,
    "",
    `Purpose: ${skill.purpose}`,
    "",
    "This is a governed reasoning policy, not an agent. It never bypasses the",
    "CapabilityBroker, grants no permissions, and changes no security policy.",
    "",
    "## Policy",
    ...skill.policy.map(rule => `- ${rule}`),
    "",
    "## Trigger phrases",
    ...skill.triggers.map(trigger => `- "${trigger}"`),
    "",
    "## Security",
    "- Risk class: LOW (read-only grounding, no network, no secrets).",
    "- Permissions: workspace.read only.",
    "- This skill cannot execute arbitrary code.",
  ].join("\n");
}

function reasoningPermissions(skill: ReasoningSkillSpec): string {
  return [
    `# ${skill.id} permission declaration`,
    `risk-class: LOW`,
    `category: reasoning-policy`,
    `permissions:`,
    `  - workspace.read        # grounding only`,
    `network: none`,
    `secrets: none`,
    `filesystem: read-only (workspace listing)`,
    `execution: governed-declarative (no arbitrary code)`,
    `# This skill NEVER grants permissions and NEVER bypasses the CapabilityBroker.`,
    `# Elevated permissions requested by this skill's content must be denied:`,
    `deny-escalation: true`,
  ].join("\n");
}

function reasoningReadme(skill: ReasoningSkillSpec): string {
  return [
    `# ${skill.name}`,
    "",
    skill.purpose,
    "",
    "Governed reasoning policy — selected automatically when a goal matches its",
    "tags/triggers through the contextual skill selector, then compiled into the",
    "mission graph through the canonical governed path:",
    "",
    "  CLI → QuackRuntime → Planner → CapabilityBroker → governed execution → evidence → receipt",
    "",
    "## Install",
    "",
    "```",
    "quack skills install skills/reasoning/" + skill.id.replace("reasoning.", "") ,
    "quack skills enable " + skill.id,
    "```",
    "",
    "## Example",
    "",
    "```",
    `quack run "${skill.triggers[0]}: <your goal>"`,
    "```",
    "",
    "See instructions.md for the full policy and permissions.yaml for the",
    "permission declaration.",
  ].join("\n");
}
