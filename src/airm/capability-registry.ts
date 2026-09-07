import type { AiCapability, CapabilityDefinition, CapabilityCategory } from "./types.js";

export class CapabilityRegistry {
  private capabilities: Map<string, CapabilityDefinition> = new Map();

  register(def: CapabilityDefinition): void {
    this.capabilities.set(def.id, def);
  }

  unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  get(id: string): CapabilityDefinition | undefined {
    return this.capabilities.get(id);
  }

  getAll(): CapabilityDefinition[] {
    return Array.from(this.capabilities.values());
  }

  getByCategory(category: CapabilityCategory): CapabilityDefinition[] {
    return this.getAll().filter((c) => c.category === category);
  }

  getByCapability(capability: AiCapability): CapabilityDefinition | undefined {
    return this.getAll().find((c) => c.name === capability);
  }

  hasCapability(name: AiCapability): boolean {
    return this.getAll().some((c) => c.name === name);
  }

  getDependencies(name: AiCapability): string[] {
    const def = this.getByCapability(name);
    return def?.dependencies ?? [];
  }

  getStats(): { total: number; categories: Record<string, number> } {
    const categories: Record<string, number> = {};
    for (const c of this.getAll()) {
      categories[c.category] = (categories[c.category] ?? 0) + 1;
    }
    return { total: this.capabilities.size, categories };
  }

  createDefaults(): void {
    const defs: CapabilityDefinition[] = [
      { id: "reasoning", name: "reasoning", description: "General reasoning and problem solving", category: "reasoning" },
      { id: "coding", name: "coding", description: "Code generation and analysis", category: "reasoning" },
      { id: "planning", name: "planning", description: "Task planning and decomposition", category: "reasoning" },
      { id: "architecture", name: "architecture", description: "Software architecture design", category: "reasoning" },
      { id: "vision", name: "vision", description: "Image understanding and analysis", category: "perception" },
      { id: "ocr", name: "ocr", description: "Optical character recognition", category: "perception" },
      { id: "speech-recognition", name: "speech-recognition", description: "Speech to text", category: "perception" },
      { id: "speech-synthesis", name: "speech-synthesis", description: "Text to speech", category: "generation" },
      { id: "embeddings", name: "embeddings", description: "Text embedding generation", category: "analysis" },
      { id: "reranking", name: "reranking", description: "Document reranking", category: "analysis" },
      { id: "summarization", name: "summarization", description: "Text summarization", category: "generation" },
      { id: "translation", name: "translation", description: "Language translation", category: "generation" },
      { id: "mathematics", name: "mathematics", description: "Mathematical reasoning", category: "reasoning" },
      { id: "scientific", name: "scientific", description: "Scientific reasoning", category: "reasoning" },
      { id: "tool-calling", name: "tool-calling", description: "External tool invocation", category: "interaction" },
      { id: "function-calling", name: "function-calling", description: "Structured function calls", category: "interaction" },
      { id: "json-generation", name: "json-generation", description: "Structured JSON output", category: "generation" },
      { id: "long-context", name: "long-context", description: "Extended context window handling", category: "memory" },
      { id: "multimodal", name: "multimodal", description: "Multi-modal input processing", category: "perception" },
      { id: "code-execution", name: "code-execution", description: "Running generated code", category: "execution" },
      { id: "chat", name: "chat", description: "Conversational interaction", category: "interaction" },
      { id: "computer-use", name: "computer-use", description: "Computer control and automation", category: "execution" },
    ];
    for (const d of defs) this.register(d);
  }
}
