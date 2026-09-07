import { type JsonObject, type QuackResult, ok, fail } from "../core/types.js";
import { type ModelRuntime } from "../models/runtime.js";
import { type ModelCapability } from "../models/types.js";
import { type SkillRuntime } from "../skills/runtime/index.js";
import { type SkillResult } from "../skills/types.js";

export type AgentTrustLevel = "builtin" | "trusted" | "verified" | "experimental";

export interface SpecialistAgentIdentity {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface SpecialistAgentDefinition {
  readonly identity: SpecialistAgentIdentity;
  readonly skills: readonly string[];
  readonly capabilities: readonly string[];
  readonly trustLevel: AgentTrustLevel;
  readonly specialization: readonly string[];
  readonly modelCapability?: ModelCapability;
}

export interface AgentSelectionRequest {
  readonly missionId?: string;
  readonly goal: string;
  readonly requiredCapabilities?: readonly string[];
  readonly requiredSkills?: readonly string[];
}

export interface AgentSelection {
  readonly agent: SpecialistAgentDefinition;
  readonly score: number;
  readonly reason: string;
  readonly modelId?: string;
}

export class AgentRegistry {
  private readonly agents = new Map<string, SpecialistAgentDefinition>();

  register(agent: SpecialistAgentDefinition): QuackResult<SpecialistAgentDefinition> {
    if (this.agents.has(agent.identity.id)) {
      return fail({
        code: "agent.duplicate",
        message: `Agent '${agent.identity.id}' is already registered.`,
        category: "runtime",
        recoverable: true,
      });
    }
    this.agents.set(agent.identity.id, clone(agent));
    return ok(clone(agent));
  }

  get(id: string): QuackResult<SpecialistAgentDefinition> {
    const agent = this.agents.get(id);
    return agent ? ok(clone(agent)) : fail({
      code: "agent.not_found",
      message: `Agent '${id}' was not found.`,
      category: "runtime",
      recoverable: true,
    });
  }

  list(): SpecialistAgentDefinition[] {
    return [...this.agents.values()].map(clone);
  }
}

export class AgentRouter {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly modelRuntime?: Pick<ModelRuntime, "selectModel">,
  ) {}

  select(request: AgentSelectionRequest): QuackResult<AgentSelection> {
    const candidates = this.registry.list()
      .map((agent) => scoreAgent(agent, request))
      .filter((selection) => selection.score > 0)
      .sort((a, b) => b.score - a.score || a.agent.identity.id.localeCompare(b.agent.identity.id));
    const selected = candidates[0];
    return selected ? ok(this.withModelHint(selected, request)) : fail({
      code: "agent.no_match",
      message: `No specialist agent can satisfy mission '${request.goal}'.`,
      category: "runtime",
      recoverable: true,
    });
  }

  private withModelHint(selection: AgentSelection, request: AgentSelectionRequest): AgentSelection {
    const capability = selection.agent.modelCapability;
    if (!this.modelRuntime || !capability) return selection;
    const model = this.modelRuntime.selectModel({ goal: request.goal, capability });
    return model.ok ? { ...selection, modelId: model.data.id } : selection;
  }
}

export class SpecialistAgent {
  constructor(
    readonly definition: SpecialistAgentDefinition,
    private readonly skillRuntime: Pick<SkillRuntime, "executeSkill">,
  ) {}

  async executeMission(input: {
    readonly missionId?: string;
    readonly goal: string;
    readonly skillId?: string;
    readonly parameters?: Record<string, unknown>;
  }): Promise<SkillResult> {
    const skillId = input.skillId ?? this.definition.skills[0];
    if (!skillId || !this.definition.skills.includes(skillId)) {
      return { ok: false, error: `Agent ${this.definition.identity.id} cannot execute unknown skill ${skillId ?? "none"}.`, durationMs: 0 };
    }
    return this.skillRuntime.executeSkill(skillId, {
      goal: input.goal,
      parameters: input.parameters ?? {},
    }, {
      missionId: input.missionId,
      agentId: this.definition.identity.id,
      actor: this.definition.identity.id,
    });
  }
}

export interface Workforce {
  readonly registry: AgentRegistry;
  readonly router: AgentRouter;
  selectAgent(request: AgentSelectionRequest): QuackResult<AgentSelection>;
  executeMission(request: AgentSelectionRequest & { readonly parameters?: Record<string, unknown> }): Promise<QuackResult<SkillResult>>;
}

export function createWorkforce(skillRuntime: Pick<SkillRuntime, "executeSkill">, modelRuntime?: Pick<ModelRuntime, "selectModel">, options: { readonly definitions?: readonly SpecialistAgentDefinition[] } = {}): Workforce {
  const registry = new AgentRegistry();
  for (const agent of options.definitions ?? []) {
    const result = registry.register(agent);
    if (!result.ok) throw new Error(result.error.message);
  }
  const router = new AgentRouter(registry, modelRuntime);
  return {
    registry,
    router,
    selectAgent: (request) => router.select(request),
    executeMission: async (request) => {
      const selected = router.select(request);
      if (!selected.ok) return selected;
      const agent = new SpecialistAgent(selected.data.agent, skillRuntime);
      return ok(await agent.executeMission({
        missionId: request.missionId,
        goal: request.goal,
        skillId: request.requiredSkills?.find((skill) => selected.data.agent.skills.includes(skill)),
        parameters: request.parameters,
      }));
    },
  };
}



function scoreAgent(agent: SpecialistAgentDefinition, request: AgentSelectionRequest): AgentSelection {
  const lower = request.goal.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const specializationHits = agent.specialization.filter((term) => lower.includes(term.toLowerCase())).length;
  if (specializationHits > 0) {
    score += specializationHits * 4;
    reasons.push(`${specializationHits} specialization match(es)`);
  }
  const requiredCapabilityMiss = (request.requiredCapabilities ?? []).find((capability) => !agent.capabilities.includes(capability));
  if (requiredCapabilityMiss) return { agent, score: 0, reason: `missing capability ${requiredCapabilityMiss}` };
  if (request.requiredCapabilities?.length) {
    score += request.requiredCapabilities.length * 3;
    reasons.push("required capabilities satisfied");
  }
  const requiredSkillMiss = (request.requiredSkills ?? []).find((skill) => !agent.skills.includes(skill));
  if (requiredSkillMiss) return { agent, score: 0, reason: `missing skill ${requiredSkillMiss}` };
  if (request.requiredSkills?.length) {
    score += request.requiredSkills.length * 3;
    reasons.push("required skills satisfied");
  }
  return { agent, score, reason: reasons.join(", ") || "default match" };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
