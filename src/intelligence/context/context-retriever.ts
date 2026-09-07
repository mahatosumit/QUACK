import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { type FileInfo, type SymbolInfo, type Language } from "../types.js";
import { type SymbolDatabase } from "../symbols/symbol-database.js";
import { type KnowledgeGraphStore } from "../../memory/knowledge-graph.js";
import { type MemoryStore, type MemoryRecord } from "../../memory/memory.js";

export interface BrainContextData {
  readonly goal: string;
  readonly relevantFiles: readonly FileInfo[];
  readonly relevantSymbols: readonly SymbolInfo[];
  readonly memoryHits: readonly MemoryRecord[];
  readonly workspaceSummary: string;
  readonly recentChanges: string;
}

/**
 * ContextRetriever gathers relevant context from the workspace, symbols,
 * memory, and knowledge graph to provide the ExecutiveBrain with a rich
 * understanding of the current task and workspace.
 */
export class ContextRetriever {
  constructor(
    private readonly workspaceRoot: string,
    private readonly symbolDb: SymbolDatabase,
    private readonly memory: MemoryStore,
    private readonly kg?: KnowledgeGraphStore,
  ) {}

  /**
   * Gather comprehensive context for a given goal.
   */
  async retrieveForGoal(goal: string, files: readonly FileInfo[]): Promise<BrainContextData> {
    const goalWords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    // Score files by relevance
    const scoredFiles = files.map((file) => {
      let score = 0;
      const path = file.relativePath.toLowerCase();
      const fileName = path.split("/").pop()?.toLowerCase() ?? "";

      for (const word of goalWords) {
        if (path.includes(word)) score += 3;
        if (fileName.includes(word)) score += 2;
        if (file.language.toLowerCase().includes(word)) score += 1;
      }

      // Boost commonly relevant files
      if (path.includes("package.json") && goalWords.some((w) => ["depend", "package", "install"].includes(w))) score += 5;
      if (path.includes("tsconfig") && goalWords.some((w) => ["config", "typescript"].includes(w))) score += 5;
      if (path.includes("readme")) score += 2;

      return { file, score };
    });

    const relevantFiles = scoredFiles
      .filter((f) => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((f) => f.file);

    // Search symbols for relevant symbols
    const relevantSymbols: SymbolInfo[] = [];
    for (const word of goalWords) {
      const symbols = await this.symbolDb.fuzzySearch(word, 5);
      relevantSymbols.push(...symbols);
    }

    // Search memory for relevant context
    const memoryHits = await this.memory.search({ text: goal, limit: 10 });

    // Build workspace summary
    const languages = [...new Set(files.map((f) => f.language))];
    const totalLines = files.reduce((s, f) => s + f.lines, 0);
    const workspaceSummary = [
      `Workspace: ${this.workspaceRoot}`,
      `Files: ${files.length}`,
      `Lines: ${totalLines.toLocaleString()}`,
      `Languages: ${languages.join(", ")}`,
      `Relevant files: ${relevantFiles.map((f) => f.relativePath).join(", ")}`,
    ].join("\n");

    return {
      goal,
      relevantFiles,
      relevantSymbols: [...new Set(relevantSymbols)].slice(0, 20),
      memoryHits,
      workspaceSummary,
      recentChanges: "",
    };
  }

  /**
   * Get the content of specific files for the Brain to read.
   */
  async getFileContent(filePath: string, maxLines = 200): Promise<string | undefined> {
    try {
      const fullPath = resolve(this.workspaceRoot, filePath);
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      if (lines.length <= maxLines) return content;
      return lines.slice(0, maxLines).join("\n") + `\n... (${lines.length - maxLines} more lines)`;
    } catch {
      return undefined;
    }
  }

  /**
   * Get symbol details for a specific name.
   */
  async getSymbolDetails(name: string): Promise<SymbolInfo | undefined> {
    const symbols = await this.symbolDb.getByName(name, 1);
    return symbols[0];
  }

  /**
   * Search knowledge graph for relevant nodes.
   */
  async searchKnowledgeGraph(query: string): Promise<ReadonlyArray<{ id: string; label: string; type: string }>> {
    if (!this.kg) return [];
    const nodes = await this.kg.searchNodes({ query, limit: 10 });
    return nodes.map((n) => ({ id: n.id, label: n.label, type: n.type }));
  }

  /**
   * Generate a structured summary of the workspace for the Brain.
   */
  getWorkspaceSnapshot(files: readonly FileInfo[]): string {
    const languages = [...new Set(files.map((f) => f.language))];
    const dirs = new Set(files.map((f) => {
      const parts = f.relativePath.split("/");
      return parts.length > 1 ? parts[0] : "/";
    }));

    const dirList = [...dirs].slice(0, 20).join(", ");
    const langList = languages.join(", ");
    const totalFiles = files.length;
    const totalLines = files.reduce((s, f) => s + f.lines, 0);

    return [
      `Directory overview: ${dirList}`,
      `Languages: ${langList}`,
      `Total: ${totalFiles} files, ${totalLines.toLocaleString()} lines`,
    ].join("\n");
  }
}
