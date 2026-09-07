import { createId, now } from "../core/types.js";
import { type EventBus } from "../events/event-bus.js";
import { type Brain } from "../brain/brain.js";
import { type SemanticLayer } from "../intelligence/semantic-layer.js";
import { type MemoryStore } from "../memory/memory.js";
import { type ToolRegistry } from "../tools/tool.js";
import { type Task } from "../runtime/task.js";
import { type SeaConfig, type SeaEventType, type EditingResult, type ReviewReport, type EngineeringReport, type RepositorySummary, type WorkspaceHealth, type TestSelection, type TestFailureAnalysis, type DefinitionResult, type ReferenceResult, type CrossFileImpact, type CallHierarchy, type EditOperation, type EditingPlan } from "./types.js";
import { RepositoryUnderstanding } from "./understanding/repository-understanding.js";
import { ArchitectureAnalyzer } from "./understanding/architecture-analyzer.js";
import { WorkspaceAwareness } from "./understanding/workspace-awareness.js";
import { SemanticNavigator } from "./navigation/semantic-navigator.js";
import { CrossFileAnalyzer } from "./navigation/cross-file-analyzer.js";
import { DependencyAnalyzer } from "./navigation/dependency-analyzer.js";
import { EditingWorkflow } from "./editing/editing-workflow.js";
import { IncrementalEditor } from "./editing/incremental-editor.js";
import { RefactoringEngine } from "./editing/refactoring-engine.js";
import { ReviewSystem } from "./review/review-system.js";
import { TestIntelligence } from "./testing/test-intelligence.js";
import { TestAnalyzer } from "./testing/test-analyzer.js";
import { EngineeringReporter } from "./reporting/engineering-reporter.js";
import { SeaMemory } from "./memory/sea-memory.js";
import { LearningStore } from "./memory/learning-store.js";

export class Sea {
  readonly understanding: RepositoryUnderstanding;
  readonly architecture: ArchitectureAnalyzer;
  readonly awareness: WorkspaceAwareness;
  readonly navigator: SemanticNavigator;
  readonly crossFile: CrossFileAnalyzer;
  readonly dependencyAnalyzer: DependencyAnalyzer;
  readonly editing: EditingWorkflow;
  readonly incrementalEditor: IncrementalEditor;
  readonly refactoring: RefactoringEngine;
  readonly review: ReviewSystem;
  readonly testIntelligence: TestIntelligence;
  readonly testAnalyzer: TestAnalyzer;
  readonly reporter: EngineeringReporter;
  readonly memory: SeaMemory;
  readonly learning: LearningStore;

  private indexed = false;

  constructor(
    private readonly deps: {
      eventBus: EventBus;
      brain: Brain;
      semanticLayer: SemanticLayer;
      tools: ToolRegistry;
      memory: MemoryStore;
    },
    readonly config: SeaConfig,
  ) {
    this.understanding = new RepositoryUnderstanding(deps.semanticLayer);
    this.architecture = new ArchitectureAnalyzer(deps.semanticLayer);
    this.awareness = new WorkspaceAwareness(deps.semanticLayer);
    this.navigator = new SemanticNavigator(deps.semanticLayer);
    this.crossFile = new CrossFileAnalyzer(deps.semanticLayer);
    this.dependencyAnalyzer = new DependencyAnalyzer(deps.semanticLayer);
    this.editing = new EditingWorkflow(deps.brain, deps.semanticLayer, deps.eventBus, config);
    this.incrementalEditor = new IncrementalEditor(deps.semanticLayer);
    this.refactoring = new RefactoringEngine(deps.brain, deps.semanticLayer, deps.eventBus, config);
    this.review = new ReviewSystem(deps.semanticLayer);
    this.testIntelligence = new TestIntelligence(deps.semanticLayer);
    this.testAnalyzer = new TestAnalyzer();
    this.reporter = new EngineeringReporter(deps.semanticLayer);
    this.memory = new SeaMemory(config.dataDir);
    this.learning = new LearningStore(config.dataDir);
  }

  async ensureIndexed(): Promise<void> {
    if (this.indexed) return;
    const sl = this.deps.semanticLayer;
    if (!sl.isIndexed()) {
      await sl.index();
    }
    this.indexed = true;
    await this.deps.memory.write({
      scope: "session",
      content: JSON.stringify({ action: "indexed", timestamp: now() }),
      metadata: { tags: ["sea", "indexed"] },
    });
  }

  async understandRepository(): Promise<RepositorySummary> {
    await this.ensureIndexed();
    await this.emit("sea.understanding", { phase: "repository" });
    return this.understanding.summarize();
  }

  async analyzeArchitecture(): Promise<RepositorySummary> {
    await this.ensureIndexed();
    await this.emit("sea.understanding", { phase: "architecture" });
    return this.architecture.analyze();
  }

  async getWorkspaceHealth(): Promise<WorkspaceHealth> {
    await this.ensureIndexed();
    return this.awareness.assess();
  }

  async goToDefinition(symbol: string, file?: string): Promise<DefinitionResult | undefined> {
    await this.ensureIndexed();
    return this.navigator.findDefinition(symbol, file);
  }

  async findReferences(symbol: string): Promise<ReferenceResult> {
    await this.ensureIndexed();
    return this.navigator.findReferences(symbol);
  }

  async getCallHierarchy(symbol: string): Promise<CallHierarchy> {
    await this.ensureIndexed();
    return this.navigator.getCallHierarchy(symbol);
  }

  async analyzeCrossFileImpact(symbol: string, file: string): Promise<CrossFileImpact> {
    await this.ensureIndexed();
    return this.crossFile.analyzeImpact(symbol, file);
  }

  async planEdit(goal: string, operations: EditOperation[]): Promise<EditingPlan> {
    await this.ensureIndexed();
    return this.incrementalEditor.plan(goal, operations);
  }

  async executeEdit(plan: EditingPlan): Promise<EditingResult> {
    await this.emit("sea.editing", { goal: plan.goal, files: plan.affectedFiles.length });
    const result = await this.editing.execute(plan);
    await this.memory.recordEdit(plan, result);
    return result;
  }

  async reviewChanges(target: string): Promise<ReviewReport> {
    await this.emit("sea.reviewing", { target });
    return this.review.review(target);
  }

  async runTests(goal: string): Promise<TestSelection> {
    await this.ensureIndexed();
    await this.emit("sea.testing", { goal });
    return this.testIntelligence.selectAndRun(goal);
  }

  async generateReport(type: EngineeringReport["type"]): Promise<EngineeringReport> {
    await this.ensureIndexed();
    await this.emit("sea.reporting", { type });
    return this.reporter.generate(type);
  }

  async learnFromFailure(fix: string, context: string): Promise<void> {
    await this.learning.record(fix, context);
  }

  async learnFromRepair(pattern: string, fix: string): Promise<void> {
    await this.learning.recordRepair(pattern, fix);
  }

  private async emit(type: SeaEventType, data: Record<string, unknown>): Promise<void> {
    await this.deps.eventBus.emit(type as any, data as any, { actor: "sea" });
  }
}
