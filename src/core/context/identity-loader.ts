import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { isMissingFile } from "../utils.js";
import { createId, now, type JsonObject } from "../types.js";
import { type UserIdentity, type UserPreferences, type TechnicalPreferences, type CommunicationStyle } from "./types.js";

const DEFAULT_PREFERENCES: UserPreferences = {
  codingStyle: "modular",
  explanationStyle: "detailed",
  language: "en",
  theme: "system",
  autoApproveLowRisk: true,
};

const DEFAULT_TECHNICAL: TechnicalPreferences = {
  languages: [],
  frameworks: [],
  tooling: [],
  testingFramework: "node:test",
  linter: "tsc",
  formatter: "prettier",
};

/**
 * Loads and persists a single user identity record. Works as additional context
 * provider on top of the existing memory system — never replaces it.
 */
export class IdentityLoader {
  private identity?: UserIdentity;
  private readonly filePath?: string;

  constructor(dataDir?: string) {
    this.filePath = dataDir ? join(dataDir, "identity.json") : undefined;
  }

  async load(): Promise<UserIdentity> {
    if (this.identity) return this.identity;
    if (this.filePath) {
      try {
        const raw = await readFile(this.filePath, "utf8");
        this.identity = JSON.parse(raw) as UserIdentity;
        return this.identity;
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    this.identity = this.createDefault();
    return this.identity;
  }

  async update(patch: Partial<Omit<UserIdentity, "id" | "createdAt">>): Promise<UserIdentity> {
    const current = await this.load();
    this.identity = {
      ...current,
      ...patch,
      preferences: { ...current.preferences, ...(patch.preferences ?? {}) },
      technicalPreferences: { ...current.technicalPreferences, ...(patch.technicalPreferences ?? {}) },
      updatedAt: now(),
    };
    await this.persist();
    return this.identity;
  }

  async setPreferences(prefs: Partial<UserPreferences>): Promise<UserIdentity> {
    const current = await this.load();
    this.identity = {
      ...current,
      preferences: { ...current.preferences, ...prefs },
      updatedAt: now(),
    };
    await this.persist();
    return this.identity;
  }

  async setCommunicationStyle(style: CommunicationStyle): Promise<UserIdentity> {
    return this.update({ communicationStyle: style });
  }

  async addGoal(goal: string): Promise<UserIdentity> {
    const current = await this.load();
    if (!current.goals.includes(goal)) {
      current.goals.push(goal);
    }
    return this.update({ goals: current.goals });
  }

  async removeGoal(goal: string): Promise<UserIdentity> {
    const current = await this.load();
    return this.update({ goals: current.goals.filter((g) => g !== goal) });
  }

  /** ContextProvider interface — returns identity as a JSON object slice. */
  readonly id = "identity";
  async loadContext(): Promise<JsonObject> {
    const identity = await this.load();
    const { id: _id, createdAt: _createdAt, ...rest } = identity;
    void _id; void _createdAt;
    return rest as unknown as JsonObject;
  }

  private createDefault(): UserIdentity {
    const ts = now();
    return {
      id: createId("user"),
      name: "User",
      role: "engineer",
      preferences: DEFAULT_PREFERENCES,
      goals: [],
      technicalPreferences: DEFAULT_TECHNICAL,
      communicationStyle: "technical",
      createdAt: ts,
      updatedAt: ts,
    };
  }

  private async persist(): Promise<void> {
    if (!this.filePath || !this.identity) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.identity, null, 2), "utf8");
  }
}
