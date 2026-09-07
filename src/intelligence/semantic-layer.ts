import { type FileInfo, type SymbolInfo, type SearchQuery, type SearchResult, type WorkspaceMetadata, type Language, type Patch, type PatchValidationResult, type TestRunResult, type TestFile } from "./types.js";
import { type BrainContextData } from "./context/context-retriever.js";
import { type KnowledgeGraphStore } from "../memory/knowledge-graph.js";
import { type EventBus } from "../events/event-bus.js";
import { type MemoryStore } from "../memory/memory.js";
import { type ProviderRegistry } from "../providers/provider.js";

import { WorkspaceIndexer, type IndexerConfig, type IndexReport } from "./indexer/workspace-indexer.js";
import { SymbolDatabase, extractSymbolsFromFile } from "./symbols/symbol-database.js";
import { DependencyGraph } from "./repository/dependency-graph.js";
import { detectLanguages, detectBuildSystems, detectPackage, buildWorkspaceMetadata, scanFiles } from "./repository/repository-graph.js";
import { SemanticSearch } from "./search/semantic-search.js";
import { PatchEngine, type PatchEngineOptions } from "./patch/patch-engine.js";
import { ValidationPipeline } from "./validation/validation-pipeline.js";
import { TestRunner } from "./validation/test-runner.js";
import { GitIntegration } from "./git/git-integration.js";
import { ContextRetriever } from "./context/context-retriever.js";
import { WorkspaceMemory } from "./context/workspace-memory.js";
import { LspManager } from "./languages/lsp-manager.js";
import { detectLanguage } from "./languages/language-detector.js";
import { createId, now } from "../core/types.js";

export interface SemanticLayerConfig {
  readonly eventBus: EventBus;
  readonly memory: MemoryStore;
  readonly providers: ProviderRegistry;
  readonly kgStore: KnowledgeGraphStore;
  readonly workspaceRoot: string;
  readonly dataDir: string;
}

/**
 * SemanticLayer is the main facade for the QUACK Semantic Intelligence Layer.
 * All semantic operations go through this interface. The ExecutiveBrain
 * obtains a reference to this facade and uses it for workspace understanding,
 * symbol lookup, search, patching, validation, and context retrieval.
 */
export class SemanticLayer {
  readonly indexer: WorkspaceIndexer;
  readonly symbolDb: SymbolDatabase;
  readonly depGraph: DependencyGraph;
  readonly search: SemanticSearch;
  readonly patches: PatchEngine;
  readonly validator: ValidationPipeline;
  readonly testRunner: TestRunner;
  readonly git: GitIntegration;
  readonly context: ContextRetriever;
  readonly wsMemory: WorkspaceMemory;
  readonly lsp: LspManager;

  private cachedFiles: FileInfo[] = [];
  private metadata?: WorkspaceMetadata;

  constructor(private readonly config: SemanticLayerConfig) {
    const indexerConfig: IndexerConfig = {
      workspaceRoot: config.workspaceRoot,
      maxDepth: 50,
      incremental: true,
    };

    this.symbolDb = new SymbolDatabase();
    this.depGraph = new DependencyGraph();
    this.wsMemory = new WorkspaceMemory(config.dataDir);

    this.indexer = new WorkspaceIndexer(indexerConfig, this.symbolDb, config.kgStore, config.eventBus);
    this.search = new SemanticSearch(config.workspaceRoot, this.symbolDb, config.kgStore, config.memory);
    this.patches = new PatchEngine({ workspaceRoot: config.workspaceRoot, eventBus: config.eventBus });
    this.validator = new ValidationPipeline({ workspaceRoot: config.workspaceRoot, eventBus: config.eventBus, timeoutMs: 60_000 });
    this.testRunner = new TestRunner({ workspaceRoot: config.workspaceRoot, defaultTimeoutMs: 120_000 });
    this.git = new GitIntegration(config.workspaceRoot, config.eventBus);
    this.context = new ContextRetriever(config.workspaceRoot, this.symbolDb, config.memory, config.kgStore);
    this.lsp = new LspManager();
  }

  // ------------------------------------------------------------------
  // Indexing
  // ------------------------------------------------------------------

  /** Full workspace index. */
  async index(): Promise<IndexReport> {
    const report = await this.indexer.fullIndex();
    this.cachedFiles = this.indexer.getCachedFiles() as FileInfo[];
    await this.depGraph.build(this.cachedFiles);
    this.metadata = await buildWorkspaceMetadata(this.config.workspaceRoot, this.cachedFiles, []);
    await this.wsMemory.saveWorkspaceMetadata(this.metadata);
    return report;
  }

  /** Incremental index. */
  async incrementalIndex(changedFiles: readonly string[]): Promise<IndexReport> {
    const report = await this.indexer.incrementalIndex(changedFiles);
    if (this.cachedFiles.length > 0) {
      await this.depGraph.build(this.cachedFiles);
    }
    return report;
  }

  // ------------------------------------------------------------------
  // Files
  // ------------------------------------------------------------------

  getFiles(): readonly FileInfo[] {
    return this.cachedFiles;
  }

  getFileCount(): number {
    return this.cachedFiles.length;
  }

  // ------------------------------------------------------------------
  // Symbols
  // ------------------------------------------------------------------

  getSymbolsByName(name: string): Promise<SymbolInfo[]> {
    return this.symbolDb.getByName(name);
  }

  getSymbolsByKind(kind: string): Promise<SymbolInfo[]> {
    return this.symbolDb.getByKind(kind as any);
  }

  getSymbolsByFile(filePath: string): Promise<SymbolInfo[]> {
    return this.symbolDb.getByFile(filePath);
  }

  fuzzySearchSymbols(query: string): Promise<Array<SymbolInfo & { score: number }>> {
    return this.symbolDb.fuzzySearch(query);
  }

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------

  async searchAll(query: SearchQuery): Promise<SearchResult[]> {
    return this.search.search(query);
  }

  // ------------------------------------------------------------------
  // Repository
  // ------------------------------------------------------------------

  getLanguages(): Language[] {
    return detectLanguages(this.cachedFiles);
  }

  async getBuildSystems(): Promise<string[]> {
    const systems = await detectBuildSystems(this.config.workspaceRoot);
    return systems.map((b) => String(b));
  }

  async getPackage(): Promise<ReturnType<typeof detectPackage>> {
    return detectPackage(this.config.workspaceRoot);
  }

  getDependencies(filePath: string) {
    return this.depGraph.getDependencies(filePath);
  }

  getDependents(filePath: string) {
    return this.depGraph.getDependents(filePath);
  }

  detectCircularDeps() {
    return this.depGraph.detectCircularDependencies();
  }

  getDepGraphStats() {
    return this.depGraph.getStats();
  }

  // ------------------------------------------------------------------
  // Patching
  // ------------------------------------------------------------------

  async createPatch(description: string, edits: Array<{ path: string; content: string }>): Promise<Patch> {
    return this.patches.generatePatch(description, edits);
  }

  async validatePatch(patch: Patch): Promise<PatchValidationResult> {
    return this.patches.validatePatch(patch, [
      async () => (await this.validator.typeCheck()).slice(0, 50),
      async () => (await this.validator.lint()).slice(0, 50),
    ]);
  }

  async applyPatch(patch: Patch): Promise<{ success: boolean; error?: string }> {
    return this.patches.applyPatch(patch);
  }

  async rollbackPatch(patchId: string): Promise<{ success: boolean; error?: string }> {
    return this.patches.rollbackPatch(patchId);
  }

  // ------------------------------------------------------------------
  // Testing
  // ------------------------------------------------------------------

  async discoverTests(): Promise<TestFile[]> {
    const config = { workspaceRoot: this.config.workspaceRoot, defaultTimeoutMs: 120_000 };
    const runner = new TestRunner(config);
    return runner.discoverTests(this.cachedFiles);
  }

  async runAllTests(): Promise<TestRunResult> {
    const config = { workspaceRoot: this.config.workspaceRoot, defaultTimeoutMs: 120_000 };
    const runner = new TestRunner(config);
    return runner.runAllTests();
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  async typeCheck(): Promise<string[]> {
    return this.validator.typeCheck();
  }

  async lint(): Promise<string[]> {
    return this.validator.lint();
  }

  // ------------------------------------------------------------------
  // Git
  // ------------------------------------------------------------------

  getGitStatus() {
    return this.git.getStatus();
  }

  getGitLog(count?: number) {
    return this.git.getLog(count);
  }

  getGitDiff() {
    return this.git.getDiff();
  }

  // ------------------------------------------------------------------
  // Context
  // ------------------------------------------------------------------

  async retrieveContext(goal: string): Promise<BrainContextData> {
    return this.context.retrieveForGoal(goal, this.cachedFiles);
  }

  getWorkspaceSnapshot(): string {
    return this.context.getWorkspaceSnapshot(this.cachedFiles);
  }

  // ------------------------------------------------------------------
  // Workspace Metadata
  // ------------------------------------------------------------------

  getMetadata(): WorkspaceMetadata | undefined {
    return this.metadata;
  }

  isIndexed(): boolean {
    return this.cachedFiles.length > 0;
  }

  needsReindex(): boolean {
    return this.indexer.isStale(300_000);
  }
}
