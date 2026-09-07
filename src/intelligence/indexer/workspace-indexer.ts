import { readFile } from "node:fs/promises";
import { type FileInfo, type Language, type SymbolInfo } from "../types.js";
import { detectLanguage } from "../languages/language-detector.js";
import { type SymbolDatabase, extractSymbolsFromFile } from "../symbols/symbol-database.js";
import { scanFiles, detectLanguages, detectBuildSystems, extractImports, buildWorkspaceMetadata } from "../repository/repository-graph.js";
import { type KnowledgeGraphStore } from "../../memory/knowledge-graph.js";
import { type EventBus } from "../../events/event-bus.js";
import { createId } from "../../core/types.js";

export interface IndexerConfig {
  readonly workspaceRoot: string;
  readonly maxDepth: number;
  readonly incremental: boolean;
}

export interface IndexReport {
  readonly filesScanned: number;
  readonly filesIndexed: number;
  readonly symbolsExtracted: number;
  readonly dependenciesFound: number;
  readonly durationMs: number;
  readonly errors: readonly string[];
}

/**
 * WorkspaceIndexer orchestrates full or incremental indexing of the workspace.
 * Scans files, extracts symbols, discovers dependencies, and populates the
 * SymbolDatabase, RepositoryGraph data, and KnowledgeGraph.
 */
export class WorkspaceIndexer {
  private lastIndexed = 0;
  private cachedFiles: FileInfo[] = [];

  constructor(
    private readonly config: IndexerConfig,
    private readonly symbolDb: SymbolDatabase,
    private readonly kg?: KnowledgeGraphStore,
    private readonly eventBus?: EventBus,
  ) {}

  async fullIndex(): Promise<IndexReport> {
    const start = Date.now();
    const errors: string[] = [];

    try {
      if (this.eventBus) {
        await this.eventBus.emit("task.started", { phase: "workspace-index" }, { actor: "indexer" });
      }

      const files = await scanFiles(this.config.workspaceRoot, this.config.maxDepth);

      let symbolsExtracted = 0;
      for (const file of files) {
        try {
          const content = await readFile(file.path, "utf-8");
          const symbols = extractSymbolsFromFile(file.path, content, file.language);

          if (symbols.length > 0) {
            await this.symbolDb.bulkInsert(symbols);
            symbolsExtracted += symbols.length;
          }

          // Extract imports for dependency graph
          const imports = extractImports(content, file.language);

          // Populate Knowledge Graph
          if (this.kg) {
            const fileNode = await this.kg.addNode({
              label: file.relativePath,
              type: "file",
              description: `${file.language} file (${file.lines} lines)`,
              source: file.path,
              confidence: "extracted",
              confidenceScore: 1.0,
              properties: {
                path: file.relativePath,
                language: file.language,
                lines: file.lines,
                size: file.size,
              },
            });

            for (const sym of symbols) {
              const symNode = await this.kg.addNode({
                label: `${sym.name} (${sym.kind})`,
                type: "code",
                description: `${sym.kind} ${sym.name} in ${file.relativePath}:${sym.line}`,
                source: file.path,
                sourceLocation: `${file.path}:${sym.line}:${sym.column}`,
                confidence: "extracted",
                confidenceScore: 1.0,
                tags: [sym.kind, file.language],
                properties: { name: sym.name, kind: sym.kind, line: sym.line },
              });

              await this.kg.addEdge({
                sourceId: fileNode.id,
                targetId: symNode.id,
                relation: "contains",
                weight: 1.0,
                evidence: ["extracted"],
              });
            }

            for (const imp of imports) {
              await this.kg.addNode({
                label: imp,
                type: "concept",
                description: `Import of ${imp} in ${file.relativePath}`,
                confidence: "extracted",
                confidenceScore: 0.8,
                properties: {},
              });
            }
          }
        } catch (error) {
          errors.push(`Failed to index ${file.relativePath}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
      }

      this.cachedFiles = files;
      this.lastIndexed = Date.now();

      if (this.eventBus) {
        await this.eventBus.emit("task.completed", { phase: "workspace-index" }, { actor: "indexer" });
      }

      return {
        filesScanned: files.length,
        filesIndexed: files.length,
        symbolsExtracted,
        dependenciesFound: 0,
        durationMs: Date.now() - start,
        errors,
      };
    } catch (error) {
      if (this.eventBus) {
        await this.eventBus.emit("task.failed", { phase: "workspace-index", error: String(error) }, { actor: "indexer" });
      }
      return {
        filesScanned: 0,
        filesIndexed: 0,
        symbolsExtracted: 0,
        dependenciesFound: 0,
        durationMs: Date.now() - start,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  async incrementalIndex(changedFiles: readonly string[]): Promise<IndexReport> {
    const start = Date.now();
    const errors: string[] = [];

    for (const filePath of changedFiles) {
      try {
        await this.symbolDb.removeFile(filePath);
        const content = await readFile(filePath, "utf-8");
        const language = detectLanguage(filePath, content);
        const symbols = extractSymbolsFromFile(filePath, content, language);
        if (symbols.length > 0) {
          await this.symbolDb.bulkInsert(symbols);
        }
      } catch (error) {
        errors.push(`Failed incremental index of ${filePath}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    return {
      filesScanned: changedFiles.length,
      filesIndexed: changedFiles.length,
      symbolsExtracted: 0,
      dependenciesFound: 0,
      durationMs: Date.now() - start,
      errors,
    };
  }

  getCachedFiles(): readonly FileInfo[] {
    return this.cachedFiles;
  }

  isStale(maxAgeMs = 60_000): boolean {
    return Date.now() - this.lastIndexed > maxAgeMs;
  }
}
