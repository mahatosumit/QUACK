import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMissingFile, atomicWriteFile } from "../core/utils.js";
import { type EvidenceBackedExperience, type ExecutionProvenance } from "./types.js";

export interface EvidenceExperienceQuery {
  readonly objectiveId?: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly strategyId?: string;
  readonly workflowId?: string;
  readonly skillId?: string;
  readonly skillVersion?: string;
  readonly variantId?: string;
}

export interface EvidenceExperienceStore {
  save(experience: EvidenceBackedExperience): Promise<EvidenceBackedExperience>;
  get(id: string): Promise<EvidenceBackedExperience | undefined>;
  list(query?: EvidenceExperienceQuery): Promise<EvidenceBackedExperience[]>;
  latestForObjective(objectiveId: string, beforeRunId?: string): Promise<EvidenceBackedExperience | undefined>;
}

export class InMemoryEvidenceExperienceStore implements EvidenceExperienceStore {
  private readonly experiences = new Map<string, EvidenceBackedExperience>();

  async save(experience: EvidenceBackedExperience): Promise<EvidenceBackedExperience> {
    const cloned = normalizeExperience(experience);
    this.experiences.set(cloned.id, cloned);
    return clone(cloned);
  }

  async get(id: string): Promise<EvidenceBackedExperience | undefined> {
    const experience = this.experiences.get(id);
    return experience ? clone(experience) : undefined;
  }

  async list(query: EvidenceExperienceQuery = {}): Promise<EvidenceBackedExperience[]> {
    return filterExperiences([...this.experiences.values()], query).map(clone);
  }

  async latestForObjective(objectiveId: string, beforeRunId?: string): Promise<EvidenceBackedExperience | undefined> {
    const experiences = await this.list({ objectiveId });
    return latestComparable(experiences, beforeRunId);
  }
}

export class JsonFileEvidenceExperienceStore implements EvidenceExperienceStore {
  private loaded = false;
  private readonly experiences = new Map<string, EvidenceBackedExperience>();

  constructor(private readonly filePath: string) {}

  async save(experience: EvidenceBackedExperience): Promise<EvidenceBackedExperience> {
    await this.ensureLoaded();
    const cloned = normalizeExperience(experience);
    this.experiences.set(cloned.id, cloned);
    await this.flush();
    return clone(cloned);
  }

  async get(id: string): Promise<EvidenceBackedExperience | undefined> {
    await this.ensureLoaded();
    const experience = this.experiences.get(id);
    return experience ? clone(experience) : undefined;
  }

  async list(query: EvidenceExperienceQuery = {}): Promise<EvidenceBackedExperience[]> {
    await this.ensureLoaded();
    return filterExperiences([...this.experiences.values()], query).map(clone);
  }

  async latestForObjective(objectiveId: string, beforeRunId?: string): Promise<EvidenceBackedExperience | undefined> {
    const experiences = await this.list({ objectiveId });
    return latestComparable(experiences, beforeRunId);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { readonly experiences?: readonly EvidenceBackedExperience[] };
      for (const experience of parsed.experiences ?? []) {
        const normalized = normalizeExperience(experience);
        this.experiences.set(normalized.id, normalized);
      }
    } catch (error) {
      if (isMissingFile(error)) return;
      throw error;
    }
  }

  private async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const experiences = [...this.experiences.values()].map(clone);
    await atomicWriteFile(this.filePath, JSON.stringify({ experiences }, null, 2));
  }
}

function filterExperiences(
  experiences: readonly EvidenceBackedExperience[],
  query: EvidenceExperienceQuery,
): EvidenceBackedExperience[] {
  return experiences
    .filter((experience) => query.objectiveId ? experience.objective.id === query.objectiveId : true)
    .filter((experience) => query.runId ? experience.runId === query.runId : true)
    .filter((experience) => query.taskId ? experience.taskId === query.taskId : true)
    .filter((experience) => query.strategyId ? executionOf(experience).strategyId === query.strategyId : true)
    .filter((experience) => query.workflowId ? executionOf(experience).workflowId === query.workflowId : true)
    .filter((experience) => query.variantId ? executionOf(experience).variant?.id === query.variantId : true)
    .filter((experience) => query.skillId ? executionOf(experience).selectedSkills.some((skill) => skill.skillId === query.skillId) : true)
    .filter((experience) => query.skillVersion ? executionOf(experience).selectedSkills.some((skill) => skill.version === query.skillVersion) : true)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function normalizeExperience(experience: EvidenceBackedExperience): EvidenceBackedExperience {
  const cloned = clone(experience);
  const legacy = cloned as EvidenceBackedExperience & { readonly execution?: ExecutionProvenance };
  const execution = legacy.execution ?? {
    strategyId: legacy.strategyId,
    selectedSkills: [],
  };

  return {
    ...cloned,
    strategyId: cloned.strategyId ?? execution.strategyId,
    execution,
  };
}

function executionOf(experience: EvidenceBackedExperience): ExecutionProvenance {
  return (experience as EvidenceBackedExperience & { readonly execution?: ExecutionProvenance }).execution ?? {
    strategyId: experience.strategyId,
    selectedSkills: [],
  };
}

function latestComparable(
  experiences: readonly EvidenceBackedExperience[],
  beforeRunId?: string,
): EvidenceBackedExperience | undefined {
  const comparable = experiences.filter((experience) =>
    experience.runId !== beforeRunId && experience.metricObservations.length > 0
  );
  return comparable.length > 0 ? comparable[comparable.length - 1] : undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
