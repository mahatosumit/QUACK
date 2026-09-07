import { createHash } from "node:crypto";
import { createId, now } from "../core/types.js";
import type { Prompt, PromptVersion, PromptScore } from "./types.js";

export function createPromptRegistry() {
  const prompts = new Map<string, Prompt>();

  function createPrompt(name: string, content: string, category: string): Prompt {
    const version: PromptVersion = {
      id: createId("pv"),
      version: 1,
      content,
      hash: hashContent(content),
      scores: [],
      parentId: null,
      createdAt: now(),
      approved: false,
    };

    const prompt: Prompt = {
      id: createId("prompt"),
      name,
      versions: [version],
      activeVersion: 1,
      category,
      tags: [],
      createdAt: now(),
      updatedAt: now(),
    };

    prompts.set(prompt.id, prompt);
    return prompt;
  }

  function getPrompt(id: string): Prompt | undefined {
    return prompts.get(id);
  }

  function getActiveVersion(id: string): PromptVersion | undefined {
    const prompt = prompts.get(id);
    if (!prompt) return undefined;
    return prompt.versions.find((v) => v.version === prompt.activeVersion);
  }

  function addVersion(id: string, content: string): PromptVersion {
    const prompt = prompts.get(id);
    if (!prompt) throw new Error(`Prompt ${id} not found`);

    const latestVersion = Math.max(...prompt.versions.map((v) => v.version));
    const version: PromptVersion = {
      id: createId("pv"),
      version: latestVersion + 1,
      content,
      hash: hashContent(content),
      scores: [],
      parentId: prompt.versions[prompt.versions.length - 1]?.id ?? null,
      createdAt: now(),
      approved: false,
    };

    prompt.versions.push(version);
    prompt.updatedAt = now();
    return version;
  }

  function scoreVersion(promptId: string, versionId: string, score: PromptScore): void {
    const prompt = prompts.get(promptId);
    if (!prompt) throw new Error(`Prompt ${promptId} not found`);
    const version = prompt.versions.find((v) => v.id === versionId);
    if (!version) throw new Error(`Version ${versionId} not found`);
    version.scores.push(score);
  }

  function rollback(id: string, versionNumber: number): PromptVersion {
    const prompt = prompts.get(id);
    if (!prompt) throw new Error(`Prompt ${id} not found`);

    const version = prompt.versions.find((v) => v.version === versionNumber);
    if (!version) throw new Error(`Version ${versionNumber} not found`);

    prompt.activeVersion = versionNumber;
    prompt.updatedAt = now();
    return version;
  }

  function compareVersions(id: string, v1: number, v2: number): PromptScore[] {
    const prompt = prompts.get(id);
    if (!prompt) return [];

    const version1 = prompt.versions.find((v) => v.version === v1);
    const version2 = prompt.versions.find((v) => v.version === v2);
    if (!version1 || !version2) return [];

    return [...version1.scores, ...version2.scores];
  }

  function listPrompts(): Prompt[] {
    return Array.from(prompts.values());
  }

  function deletePrompt(id: string): boolean {
    return prompts.delete(id);
  }

  return { createPrompt, getPrompt, getActiveVersion, addVersion, scoreVersion, rollback, compareVersions, listPrompts, deletePrompt };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
