import { createBuiltinSkillCatalog } from "../skills/builtins/index.js";
import { defaultSpecialistAgents, createSweToolPack } from "../extensions/packs/swe.js";
import { compileSkillContributions } from "../skills/graph-composition.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { ExecutiveBrain } from "../brain/executive-brain.js";
import { SimpleBrain } from "../brain/simple-brain.js";
import { SkillOrchestrator } from "../brain/skill-orchestrator.js";
import { createDefaultConfig, type QuackConfig } from "../distributions/swe-config.js";
import { EventBus } from "../events/event-bus.js";
import { type MemoryStore } from "../memory/memory.js";
import { MemoryManager } from "../memory/os.js";
import { InMemoryKnowledgeGraphStore } from "../memory/knowledge-graph.js";
import { EchoProvider, ProviderRegistry } from "../providers/provider.js";
import { OpenAiCompatibleProvider, createOllamaProvider, createVllmProvider } from "../providers/openai.js";
import { ProviderFallbackRouter } from "../providers/router.js";
import { CanonicalProviderRegistry, CapabilityProviderRouter } from "../providers/kernel.js";
import { GovernedProviderRouter } from "../providers/governed-router.js";
import { LegacyProviderV1Bridge, type LegacyProviderBridgeConfig } from "../providers/legacy-adapter.js";
import { type ProviderAdapter } from "../providers/provider.js";
import { NvidiaNimProvider } from "../providers/nvidia.js";
import { JsonFileTaskStore } from "../storage/task-store.js";
import { CompositeTaskStore, createSqliteStorage, type QuackStorage } from "../storage/sqlite.js";
import { JsonlAuditLog, type AuditLog } from "../telemetry/audit-log.js";
import { EchoTool, ToolRegistry } from "../tools/tool.js";
import { WorkspaceListFilesTool, WorkspaceReadFileTool } from "../tools/workspace-filesystem.js";
import { WorkspaceWriteFileTool } from "../tools/workspace-write.js";
import { CodeSearchTool } from "../tools/code-search.js";
import { TerminalTool } from "../tools/terminal.js";
import { GitStatusTool } from "../tools/git-status.js";
import { AgentReachTool, AgentReachToolAdapter } from "../tools/agent-reach.js";
import { AppRecipeRegistry, AWESOME_LLM_APPS_RECIPES } from "../recipes/index.js";
import { SemanticLayer } from "../intelligence/semantic-layer.js";
import { QuackRuntime } from "../runtime/runtime.js";
import { Sea, type SeaConfig } from "../sea/index.js";
import {
  JsonFileSkillRegistryStore,
  SkillRegistry,
  SkillLoader,
  SkillValidator,
  SkillExecutor,
  type SkillRegistryLoadResult,
} from "../skills/index.js";
import { createModelRuntime, ModelRegistry, ModelRouter, type ModelRuntime } from "../models/index.js";
import { GovernedModelRuntime, governModelRuntime } from "../models/governed-runtime.js";
import { WorkspaceManager } from "../workspace/index.js";
import { PluginRegistry } from "../plugins/index.js";
import { AgentRegistry, AgentCommunicationBus, OrganizationalMemory, AgentMetricsCollector, AgentLifecycleManager } from "../organization/index.js";
import {
  createCos,
  DeterministicObjectiveEvaluator,
  JsonFileEvidenceExperienceStore,
  ObjectiveRegistry,
  RuntimeLearningRecorder,
  type CognitiveOperatingSystem,
  type EvidenceExperienceStore,
} from "../cos/index.js";
import { createUCP, type UniversalComputerPlatform } from "../computer/index.js";
import { createDNPL, type DistributedNativePlatformLayer } from "../platform/index.js";
import { createAIRM, type AIRM } from "../airm/index.js";
import { createAdaptiveLayer, EvidenceDrivenSkillEvolution, ContextualSkillSelector, SkillFitnessIndex, SkillFitnessReviewLoop, EvidenceImprovementCycle, JsonFileImprovementCycleStateStore, ImprovementCoordinator, ImprovementProposalBridge, type AdaptiveLayer, type ImprovementCoordinatorConfig } from "../adaptive/index.js";
import { ContextLoader, type ContextBundle } from "../core/context/index.js";
import { IdentityMemoryStore } from "../memory/identity-memory.js";
import { DecisionMemoryStore } from "../memory/decision-memory.js";
import { RiskAwareApprovalPolicy } from "../security/approval-controller.js";
import { QueuedApprovalCallback } from "../security/approval-queue.js";
import { JsonFileCapabilityGrantRegistry, PermissionBackedCapabilityBroker, buildToolCapabilityRequest, type CapabilityBroker, type CapabilityGrantRegistry } from "../security/capability-broker.js";
import { readProviderCredentialForBoot } from "../security/secret-provider.js";
import { EvaluatorAgent, type QualityReport } from "../evaluation/evaluator-agent.js";
import { KnowledgeIngestionPipeline } from "../intelligence/ingestion-pipeline.js";
import { WorkflowLoader, type WorkflowDefinition } from "../engine/workflow-loader.js";
import { Planner } from "../engine/planner.js";
import { LifecycleManager as CoreLifecycleManager, AgentRegistry as CoreAgentRegistry, AgentMonitor as CoreAgentMonitor } from "../core/agents/index.js";
import { CodeImprovementController, JsonFileCodeExperimentStore } from "../selfmod/index.js";
import { AgentLoop } from "../agent-loop/index.js";
import { createHarness, type LegacyHarness } from "../harness/index.js";
import { QuackNativeHarness } from "../harness/registry.js";
import { ActionRuntime, ActionProviderRegistry } from "../actions/runtime.js";
import { type PermissionPolicy } from "../security/permissions.js";
import { InMemoryActionExecutionLedger } from "../actions/ledger.js";
import { SkillRuntime } from "../skills/runtime/index.js";
import { JsonFileSkillPackageStore, SkillPackageManager } from "../skills/packages/index.js";
import { createWorkforce, type Workforce } from "../agents/index.js";
import { buildPersonaWorkforce, PERSONAS, type PersonaDefinition } from "../agents/personas/personas.js";
import { QuackApi } from "../api/index.js";
import { DeveloperDashboard } from "../dashboard/index.js";
import { createId } from "../core/types.js";
import { isPermission } from "../security/permissions.js";
import { NetworkPolicyEngine } from "../security/network-policy.js";
import { PlaywrightBrowserActionProvider } from "../browser/index.js";
import { MissionCompanyRuntime, resolveCompanyExecutionPrincipal } from "../company/index.js";
import { McpServerRegistry } from "../actions/mcp.js";
import { validateWorkflow } from "../system/validation.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import type { ValidationProvider, ValidationRequest } from "../extensions/types.js";
import { ExperienceStore, createExperienceStore, ExperienceBroker, createExperienceBroker, DailyLearningRoutine, createDailyLearningRoutine } from "../learning/index.js";

/**
 * Deterministic workflow-evidence validator (contract v1). Certifies a
 * mission only when the bound workflow evidence record shows every node
 * completed with no failures or skips and at least one governed tool call —
 * the same completion contract the loop result enforces, issued as a bound
 * VerificationRecordV1 rather than a structural self-assertion.
 */
const workflowEvidenceValidator: ValidationProvider = {
  id: "quack.workflow-evidence",
  version: "1.0.0",
  validate(request: ValidationRequest) {
    const evidenceData = request.evidence[0]?.data as {
      readonly status?: string;
      readonly completedNodes?: readonly string[];
      readonly failedNodes?: readonly string[];
      readonly skippedNodes?: readonly string[];
      readonly nodeResults?: Record<string, { readonly toolCalls?: readonly unknown[] }>;
    } | undefined;
    const completed = evidenceData?.completedNodes ?? [];
    const failed = evidenceData?.failedNodes ?? [];
    const skipped = evidenceData?.skippedNodes ?? [];
    const callCount = completed.flatMap((id) => evidenceData?.nodeResults?.[id]?.toolCalls ?? []).length;
    const passed = Boolean(evidenceData)
      && evidenceData!.status === "completed"
      && completed.length > 0
      && failed.length === 0
      && skipped.length === 0
      && callCount > 0;
    return {
      contractVersion: QUACK_CONTRACT_VERSION,
      id: `verification-${request.execution.executionId}`,
      missionId: request.execution.missionId,
      executionId: request.execution.executionId,
      verifier: "quack.workflow-evidence",
      checkedAt: new Date().toISOString(),
      evidenceIds: request.evidence.map((record) => record.id),
      message: passed
        ? "Workflow evidence verified: all nodes completed with governed tool evidence."
        : `Workflow evidence rejected: status=${evidenceData?.status ?? "none"}, completed=${completed.length}, failed=${failed.length}, skipped=${skipped.length}, toolCalls=${callCount}.`,
      status: passed ? "PASSED" : "FAILED",
    };
  },
};

/**
 * Auto-approvable standing-consent permissions: safe to grant to fresh
 * missions by default because they are read-only or memory-local. Anything
 * else (terminal.execute, git.write, workspace.write, ...) requires an
 * explicit capability grant or an approver — never granted implicitly.
 */
const STANDING_CONSENT_PERMISSIONS: ReadonlySet<string> = new Set([
  "memory.read",
  "memory.write",
  "workspace.read",
]);

export interface QuackSystem {
  readonly runtime: QuackRuntime;
  readonly events: EventBus;
  readonly tools: ToolRegistry;
  readonly researchTool: AgentReachToolAdapter;
  readonly recipes: AppRecipeRegistry;
  readonly providers: ProviderRegistry;
  readonly providerRouter: ProviderFallbackRouter;
  readonly providerKernel: CanonicalProviderRegistry;
  readonly capabilityRouter: CapabilityProviderRouter;
  /** Authority-enforcing boundary over `capabilityRouter`; live model routing must use this. */
  readonly governedProviderRouter: GovernedProviderRouter;
  /** Authority-gated model generation surface; raw `modelRuntime.generate/stream` bypass is closed. */
  readonly governedModelRuntime: GovernedModelRuntime;
  readonly actionProviders: ActionProviderRegistry;
  readonly actionRuntime: ActionRuntime;
  readonly mcpServers: McpServerRegistry;
  readonly networkPolicy: NetworkPolicyEngine;
  readonly browser: PlaywrightBrowserActionProvider;
  readonly memory: MemoryStore;
  readonly memoryManager: MemoryManager;
  readonly storage: QuackStorage;
  readonly auditLog: AuditLog;
  readonly config: QuackConfig;
  readonly semanticLayer: SemanticLayer;
  readonly sea: Sea;
  readonly skills: SkillRegistry;
  readonly skillRegistryLoad: SkillRegistryLoadResult;
  readonly skillExecutor: SkillExecutor;
  readonly skillRuntime: SkillRuntime;
  readonly skillPackages: SkillPackageManager;
  readonly workforce: Workforce;
  /** Phase 7E: style-only persona workforce over the same base agents. */
  readonly personaWorkforce: Workforce;
  readonly personas: readonly PersonaDefinition[];
  readonly api: QuackApi;
  readonly dashboard: DeveloperDashboard;
  readonly skillOrchestrator: SkillOrchestrator;
  readonly models: ModelRegistry;
  readonly modelRouter: ModelRouter;
  readonly modelRuntime: ModelRuntime;
  readonly workspaces: WorkspaceManager;
  readonly plugins: PluginRegistry;
  readonly organization: {
    readonly registry: AgentRegistry;
    readonly comms: AgentCommunicationBus;
    readonly memory: OrganizationalMemory;
    readonly metrics: AgentMetricsCollector;
    readonly manager: AgentLifecycleManager;
  };
  readonly cognitiveSystem: CognitiveOperatingSystem;
  readonly objectives: ObjectiveRegistry;
  readonly objectiveEvaluator: DeterministicObjectiveEvaluator;
  readonly learningExperiences: EvidenceExperienceStore;
    readonly runtimeLearning: RuntimeLearningRecorder;
    readonly experienceStore: ExperienceStore;
    readonly experienceBroker: ExperienceBroker;
    readonly dailyLearning: DailyLearningRoutine;
    readonly ucp: UniversalComputerPlatform;
  readonly dnpl: DistributedNativePlatformLayer;
  readonly airm: AIRM;
  readonly adaptive: AdaptiveLayer;
  readonly adaptiveSkillEvolution: EvidenceDrivenSkillEvolution;
  readonly skillFitness: SkillFitnessIndex;
  readonly contextualSkillSelector: ContextualSkillSelector;
  readonly skillFitnessReviewLoop: SkillFitnessReviewLoop;
  readonly improvementCycle: EvidenceImprovementCycle;
  readonly improvementCoordinator: ImprovementCoordinator;
  readonly improvementProposalBridge: ImprovementProposalBridge;
  readonly contextBootloader: ContextLoader;
  readonly identityMemory: IdentityMemoryStore;
  readonly decisionMemory: DecisionMemoryStore;
  readonly approvalPolicy: RiskAwareApprovalPolicy;
  /**
   * P1 Approval Center surface: present only when the caller supplies a
   * queue-backed approver. Surfaces read/decide through it; they can never
   * grant capabilities directly (the policy path stays the only authority).
   */
  readonly approvals?: QueuedApprovalCallback;
  readonly capabilityBroker: CapabilityBroker;
  readonly capabilityGrants: CapabilityGrantRegistry;
  /** Mission-scoped temporary companies. Role templates persist; live workers do not. */
  readonly companyRuntime: MissionCompanyRuntime;
  readonly evaluator: EvaluatorAgent;
  readonly knowledgePipeline: KnowledgeIngestionPipeline;
  readonly workflowLoader: WorkflowLoader;
  readonly coreAgentRegistry: CoreAgentRegistry;
  readonly coreAgentMonitor: CoreAgentMonitor;
  readonly coreLifecycle: CoreLifecycleManager;
  readonly agentLoop: AgentLoop;
    readonly harness: LegacyHarness;
    /** Controlled self-modification gate: proposal -> isolated worktree -> verification -> human-gated review. Never auto-merges. */
    readonly selfModification: CodeImprovementController;
  }

export function createQuackSystem(configOverrides: Partial<QuackConfig> = {}): QuackSystem {
  const config = createDefaultConfig(configOverrides);
  const events = new EventBus();
  const tools = new ToolRegistry();
  const researchTool = new AgentReachToolAdapter(config.research?.agentReach);
  const recipes = new AppRecipeRegistry(AWESOME_LLM_APPS_RECIPES);
  const providers = new ProviderRegistry();
  const providerRouter = new ProviderFallbackRouter(providers);
  const providerKernel = new CanonicalProviderRegistry();
  const capabilityRouter = new CapabilityProviderRouter(providerKernel);
  const actionProviders = new ActionProviderRegistry();
  const mcpServers = new McpServerRegistry(actionProviders);
  const registerProvider = (provider: ProviderAdapter, bridge: LegacyProviderBridgeConfig): void => {
    const registration = providers.register(provider);
    if (!registration.ok) throw new Error(registration.error.message);
    providerKernel.register(new LegacyProviderV1Bridge(provider, bridge));
  };
  const storage = createSqliteStorage(join(config.dataDir, "quack.sqlite"));
  const browserHosts = (process.env["QUACK_BROWSER_ALLOW_HOSTS"] ?? "").split(",").map((host) => host.trim()).filter(Boolean);
  const openAiHosts = [process.env["QUACK_OPENAI_BASE_URL"], process.env["QUACK_VLLM_BASE_URL"]].flatMap((url) => {
    try { return url ? [new URL(url).hostname] : []; } catch { return []; }
  });
  const networkPolicy = new NetworkPolicyEngine({
    rules: [
      { id: "ollama-loopback", mode: "LOCAL_SERVICE", purposes: ["provider.ollama", "model.provider"], requesters: ["provider.ollama", "model.runtime"], hosts: ["127.0.0.1", "localhost"], ports: [11434], schemes: ["http:"] },
      { id: "nvidia-api", mode: "ALLOWLIST", purposes: ["provider.nvidia"], requesters: ["provider.nvidia-nim"], hosts: ["integrate.api.nvidia.com"], ports: [443], schemes: ["https:"] },
      // Configured provider endpoints only: the host must come from the same
      // env var the provider was registered with, not from an arbitrary URL.
      ...(openAiHosts.length > 0 ? [{ id: "provider-configured-endpoints", mode: "ALLOWLIST" as const, purposes: ["provider.openai-compatible", "provider.vllm", "model.provider"], requesters: ["provider.openai-compatible", "provider.vllm", "model.runtime"], hosts: [...new Set(openAiHosts)], schemes: ["http:" as const, "https:" as const] }] : []),
      ...(browserHosts.length > 0 ? [{ id: "browser-hosts", mode: "ALLOWLIST" as const, purposes: ["browser.navigation"], requesters: ["browser.playwright"], hosts: browserHosts, schemes: ["http:" as const, "https:" as const] }] : []),
    ],
    audit: async (decision) => {
      await storage.memory.write({
        scope: "task",
        content: JSON.stringify(decision),
        metadata: { recordType: "network-policy", requester: decision.requester, purpose: decision.purpose, allowed: decision.allowed },
      });
    },
  });
  const browserExecutable = findBrowserExecutable();
  const browser = new PlaywrightBrowserActionProvider({
    executablePath: browserExecutable,
    networkPolicy,
    allowedFileRoots: [config.workspaceRoot],
    downloadDirectory: join(config.dataDir, "browser", "downloads"),
    artifactDirectory: join(config.dataDir, "browser", "artifacts"),
  });
  actionProviders.register(browser);
  const memory = storage.memory;
  const memoryManager = new MemoryManager(storage.memoryItems);
  const auditLog = new JsonlAuditLog(join(config.dataDir, "audit.jsonl"));

  // --- Register core tools ---
  tools.register(new EchoTool());
  for (const tool of createSweToolPack({ workspaceRoot: config.workspaceRoot }).contributions.tools) {
    const registered = tools.register(tool);
    if (!registered.ok) throw new Error(registered.error.message);
  }
  tools.register(new AgentReachTool(researchTool));

  // --- Register providers ---
  registerProvider(new EchoProvider(), {
    displayName: "QUACK Echo",
    runtime: "in-process",
    boundary: "local",
  });
  // Provider credential resolution flows through the SecretProvider boundary
  // (Phase 7A contract): allowlist + consumer binding enforced at boot; raw
  // process.env credential reads live ONLY in the security layer.
  const openAiKey = readProviderCredentialForBoot("QUACK_OPENAI_API_KEY", "provider.openai-compatible");
  if (openAiKey) {
    const baseUrl = process.env["QUACK_OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
    registerProvider(
      new OpenAiCompatibleProvider({
        apiKey: openAiKey,
        baseUrl,
        defaultModel: process.env["QUACK_OPENAI_MODEL"] ?? "gpt-4o",
        fetch: (input, init) => networkPolicy.fetch({ url: String(input), purpose: "provider.openai-compatible", requester: "provider.openai-compatible" }, init),
      }),
      {
        displayName: "OpenAI-compatible",
        runtime: "openai-compatible",
        boundary: "cloud",
        endpoint: baseUrl,
        credentialEnvironmentVariables: ["QUACK_OPENAI_API_KEY"],
      },
    );
  }
  const nvidiaKey = readProviderCredentialForBoot("NVIDIA_API_KEY", "provider.nvidia-nim");
  if (nvidiaKey) {
    const baseUrl = process.env["QUACK_NVIDIA_BASE_URL"] ?? "https://integrate.api.nvidia.com/v1";
    registerProvider(
      new NvidiaNimProvider({
        apiKey: nvidiaKey,
        baseUrl,
        defaultModel: process.env["QUACK_NVIDIA_MODEL"],
        fetch: (input, init) => networkPolicy.fetch({ url: String(input), purpose: "provider.nvidia", requester: "provider.nvidia-nim" }, init),
      }),
      {
        displayName: "NVIDIA NIM",
        runtime: "nim-api",
        boundary: "cloud",
        endpoint: baseUrl,
        credentialEnvironmentVariables: ["NVIDIA_API_KEY"],
      },
    );
  }

  // --- Wire event bus to audit log ---
  events.onAny((event) => auditLog.append(event));

  // --- Wire Organization (Phase 5) ---
  const agentRegistry = new AgentRegistry();
  const agentComms = new AgentCommunicationBus();
  const orgMemory = new OrganizationalMemory();
  const agentMetrics = new AgentMetricsCollector();
  const orgManager = new AgentLifecycleManager(agentRegistry, agentComms, orgMemory, agentMetrics, events);

  // --- Wire Cognitive Operating System (Phase 6) ---
  const cognitiveSystem = createCos({
    registry: agentRegistry,
    comms: agentComms,
    orgMemory,
    agentMetrics,
    lifecycleManager: orgManager,
    missionRepository: storage.missions,
  });

  // --- Wire evidence-driven learning foundation ---
  const objectives = new ObjectiveRegistry();
  const objectiveEvaluator = new DeterministicObjectiveEvaluator();
  const learningExperiences = new JsonFileEvidenceExperienceStore(join(config.dataDir, "learning", "experiences.json"));
  // --- Wire continuous learning system ---
    const experienceStore = new ExperienceStore({
        storagePath: join(config.dataDir, "learning"),
        retentionDays: 90,
        maxRawTraces: 1000,
        compressionEnabled: false,
      });
      // Initialize synchronously for test compatibility
      experienceStore.initialize().catch(err => console.error("ExperienceStore initialization failed:", err));

    const experienceBroker = createExperienceBroker({ store: experienceStore });

    const dailyLearning = createDailyLearningRoutine({
      experienceStore,
      experienceBroker,
      maxExperiencesPerRun: 100,
      maxCandidatesPerType: 10,
      minConfidenceForVerification: 0.7,
      verifierHarness: "QUACK_NATIVE",
      verifierModel: "echo",
      learningVersion: "1.0.0",
    });

    const runtimeLearning = new RuntimeLearningRecorder({
      objectives,
      evaluator: objectiveEvaluator,
      experiences: learningExperiences,
      missionManager: cognitiveSystem.missionManager,
      learningExperienceStore: experienceStore,
    });

    // --- Wire the semantic intelligence layer ---
  const kgStore = new InMemoryKnowledgeGraphStore();
  const semanticLayer = new SemanticLayer({
    eventBus: events,
    memory,
    providers,
    kgStore,
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
  });

  // --- Wire the Brain ---
  const hasRealProvider = providers.list().some((id) => id !== "core.echo-provider");
  const brain = hasRealProvider
    ? new ExecutiveBrain({ eventBus: events, tools, providers, memory })
    : new SimpleBrain();

  // --- Wire the SEA ---
  const seaConfig: SeaConfig = {
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    maxParallelNodes: 4,
    defaultTimeoutMs: 30_000,
    maxRetries: 3,
    reviewThreshold: 0.7,
    autoTest: true,
    autoReview: true,
    autoDocument: false,
    maxIndexFiles: 10_000,
  };
  const sea = new Sea({ eventBus: events, brain, semanticLayer, tools, memory }, seaConfig);

  // --- Wire Skill System ---
  const skillRegistry = new SkillRegistry();
  const skillLoader = new SkillLoader(createBuiltinSkillCatalog());
  const skillValidator = new SkillValidator();
  let runtime: QuackRuntime;
  const skillExecutor = new SkillExecutor(skillRegistry, skillValidator, {
    executeGraph: (graph, context) => runtime.executeGraph(graph, "skill-executor", { skillId: context.skillId, deadline: context.deadline }),
    tools,
    allowedPermissions: config.permissions,
    executeTool: async (invocation, context) => {
      const result = await runtime.executeTool(invocation.toolId, invocation.input, {
        taskId: context.taskId,
        actor: context.actor,
      });
      return result.ok
        ? { toolId: invocation.toolId, success: true, output: result.data }
        : { toolId: invocation.toolId, success: false, error: result.error.message };
    },
  });
  const builtinSkills = skillLoader.loadBuiltins();
  for (const skill of builtinSkills) {
    skillRegistry.register(skill);
  }
  const skillRegistryStore = new JsonFileSkillRegistryStore(join(config.dataDir, "skills", "registry.json"));
  const skillRegistryLoad = skillRegistryStore.load();
  const reconciliation = skillRegistryLoad.snapshot
    ? skillRegistry.loadSnapshot(skillRegistryLoad.snapshot)
    : { issues: [], loadedVersions: [] };
  skillRegistry.attachStore(skillRegistryStore);

  // --- Wire Model Manager ---
  const modelRegistry = new ModelRegistry();
  const modelRouter = new ModelRouter();
  // Provider egress flows through the SAME network policy as the other
  // provider adapters (model.ollama / model.openai-compatible purposes).
  const modelRuntime = createModelRuntime(
    undefined,
    (input, init) => networkPolicy.fetch({ url: String(input), purpose: "model.provider", requester: "model.runtime" }, init),
  );
  modelRegistry.register({
    id: "echo",
    name: "Local Echo",
    provider: "local",
    capabilities: ["balanced"],
    contextWindow: 4096,
    supportsTools: false,
    latencyMs: 5,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    status: "available",
  });

  // --- Wire Skill Orchestrator ---
  const skillOrchestrator = new SkillOrchestrator(skillRegistry, modelRegistry, modelRouter);

  // --- Wire Workspace Manager ---
  const workspaceManager = new WorkspaceManager();
  workspaceManager.create("default", config.workspaceRoot);

  // --- Wire Plugin Registry ---
  const pluginRegistry = new PluginRegistry();

  // --- Wire Universal Computer Platform (Phase 7) ---
  const ucp = createUCP();

  // --- Wire Distributed Native Platform Layer (Phase 8) ---
  const dnpl = createDNPL();

  // --- Wire AI Runtime Manager (Phase 9) ---
  const airm = createAIRM();

  // --- Wire Adaptive Intelligence Layer (Phase 12) ---
  const adaptive = createAdaptiveLayer();
  const skillFitness = new SkillFitnessIndex();
  const contextualSkillSelector = new ContextualSkillSelector({
    skills: skillRegistry,
    tools,
    fitness: skillFitness,
    allowedPermissions: config.permissions,
  });
  const skillFitnessReviewLoop = new SkillFitnessReviewLoop({
    experiences: learningExperiences,
    fitness: skillFitness,
    skills: skillRegistry,
    adaptiveLayer: adaptive,
  });
  const adaptiveSkillEvolution = new EvidenceDrivenSkillEvolution({
    experiences: learningExperiences,
    skills: skillRegistry,
    tools,
    adaptiveLayer: adaptive,
    evaluator: objectiveEvaluator,
    allowedPermissions: config.permissions,
  });
  const improvementCycle = new EvidenceImprovementCycle({
    experiences: learningExperiences,
    fitness: skillFitness,
    skillEvolution: adaptiveSkillEvolution,
    skills: skillRegistry,
    tools,
    adaptiveLayer: adaptive,
    objectives,
    state: new JsonFileImprovementCycleStateStore(join(config.dataDir, "learning", "improvement-cycle.json")),
    events,
  });

  const improvementCoordinatorConfig: ImprovementCoordinatorConfig = {
    enabled: config.improvement?.enabled ?? true,
    autoEvaluate: config.improvement?.autoEvaluate ?? true,
    minimumEvidence: config.improvement?.minimumEvidence ?? 3,
    cooldownMs: config.improvement?.cooldownMs ?? 5 * 60 * 1000,
  };
  const improvementCoordinator = new ImprovementCoordinator({
    events,
    experiences: learningExperiences,
    fitness: skillFitness,
    improvementCycle,
    skills: skillRegistry,
    config: improvementCoordinatorConfig,
  });

  // The capability broker gates every tool call in the runtime and delegates legacy
  // permission decisions to this same approval policy.
  // Medium/high-risk permissions (terminal.execute, git.write, ...) are denied unless
  // `config.approver` is supplied, so a missing approver fails closed instead of silently
  // falling back to an unconditional allow-list.
  const approvalPolicy = new RiskAwareApprovalPolicy(config.permissions, config.approver, { autoApproveLow: true });
  // P1: expose the queue only when the caller opted into a queued approver,
  // and bind it to this composition's bus (the queue is built before it).
  const approvals = config.approver instanceof QueuedApprovalCallback ? config.approver : undefined;
  approvals?.attach(events);
  const configuredCapabilityGrants = config.capabilityGrants ?? [];
  const capabilityGrants = new JsonFileCapabilityGrantRegistry(join(config.dataDir, "security", "capability-grants.json"));
  for (const grant of configuredCapabilityGrants) {
    capabilityGrants.ensureGrant(grant);
  }
  if (process.env["QUACK_OLLAMA_BASE_URL"] || process.env["QUACK_OLLAMA_MODEL"]) {
    const baseUrl = process.env["QUACK_OLLAMA_BASE_URL"] ?? "http://127.0.0.1:11434/v1";
    registerProvider(
      createOllamaProvider({ baseUrl, model: process.env["QUACK_OLLAMA_MODEL"], fetch: (input, init) => networkPolicy.fetch({ url: String(input), purpose: "provider.ollama", requester: "provider.ollama" }, init) }),
      { displayName: "Ollama", runtime: "ollama", boundary: "local", endpoint: baseUrl },
    );
  }
  if (process.env["QUACK_VLLM_BASE_URL"] && process.env["QUACK_VLLM_MODEL"]) {
    const vllmKey = readProviderCredentialForBoot("QUACK_VLLM_API_KEY", "provider.vllm");
    registerProvider(
      createVllmProvider({ baseUrl: process.env["QUACK_VLLM_BASE_URL"], model: process.env["QUACK_VLLM_MODEL"], apiKey: vllmKey, fetch: (input, init) => networkPolicy.fetch({ url: String(input), purpose: "provider.vllm", requester: "provider.vllm" }, init) }),
      {
        displayName: "vLLM",
        runtime: "vllm",
        boundary: "remote-private",
        endpoint: process.env["QUACK_VLLM_BASE_URL"],
        credentialEnvironmentVariables: vllmKey ? ["QUACK_VLLM_API_KEY"] : [],
      },
    );
  }
  cognitiveSystem.missionManager.onActivate((mission) => {
    for (const grant of configuredCapabilityGrants.filter((candidate) => candidate.missionId === mission.id)) {
      capabilityGrants.ensureGrant(grant);
    }
  });
  const capabilityBroker = new PermissionBackedCapabilityBroker(approvalPolicy, capabilityGrants);
  // Governed execution surfaces (ADR 0036): the exposed `modelRuntime` shadows
  // generate/stream with broker-gated versions; metadata lookups stay ungated.
  const governedModelRuntime = new GovernedModelRuntime(modelRuntime, capabilityBroker);
  const gatedModelRuntime = governModelRuntime(modelRuntime, capabilityBroker);
  const governedProviderRouter = new GovernedProviderRouter(capabilityRouter, capabilityBroker);
  const companyRuntime = new MissionCompanyRuntime({
    repository: storage.missionCompanies,
    lifecycle: orgManager,
    registry: agentRegistry,
    grants: capabilityGrants,
  });
  const actionRuntime = new ActionRuntime(actionProviders, {
    ledger: storage.actionExecutions,
    validateExecutionContext: (context) => {
      if (!companyRuntime.isActiveMission(context.missionId)) return { allowed: true, reason: "No active mission company boundary." };
      const claims = resolveCompanyExecutionPrincipal(context.companyPrincipal);
      if (!claims || claims.missionId !== context.missionId || claims.agentInstanceId !== context.actor) {
        return { allowed: false, reason: "A valid Company Runtime execution principal with matching mission and actor is required before action discovery." };
      }
      return { allowed: true, reason: "Company execution principal is active." };
    },
    decidePermission: async (permission, descriptor, context, request) => {
      if (!isPermission(permission)) return { allowed: false, reason: `Unknown permission scope ${permission}.` };
      if (companyRuntime.isActiveMission(context.missionId)) {
        const claims = resolveCompanyExecutionPrincipal(context.companyPrincipal);
        if (!claims || claims.missionId !== context.missionId) return { allowed: false, reason: "Company execution principal is invalid." };
        const decision = await capabilityBroker.resolve(buildToolCapabilityRequest({
          taskId: context.taskId,
          missionId: claims.missionId,
          agentId: claims.agentInstanceId,
          actor: claims.agentInstanceId,
          permission,
          toolId: descriptor.id,
          input: request.input,
          reason: `Action ${descriptor.id} requires ${permission}.`,
        }));
        return { allowed: decision.granted, reason: decision.reason };
      }
      const decision = await capabilityBroker.resolve(buildToolCapabilityRequest({
        taskId: context.taskId,
        missionId: context.missionId,
        agentId: context.actor,
        actor: context.actor,
        permission,
        toolId: descriptor.id,
        input: request.input,
        reason: `Action ${descriptor.id} requires ${permission}.`,
      }));
      return { allowed: decision.granted, reason: decision.reason };
    },
    revalidateAuthority: (descriptor, context, request) => {
      const claims = context.companyPrincipal ? resolveCompanyExecutionPrincipal(context.companyPrincipal) : undefined;
      if ((companyRuntime.isActiveMission(context.missionId) || context.companyPrincipal)
        && (!claims || claims.missionId !== context.missionId || claims.agentInstanceId !== context.actor)) {
        return { allowed: false, reason: "Company execution authority expired or was revoked before dispatch." };
      }
      for (const permission of descriptor.requiredPermissions) {
        if (!isPermission(permission)) return { allowed: false, reason: `Unknown permission scope ${permission}.` };
        const decision = capabilityBroker.revalidateAuthority(buildToolCapabilityRequest({
          taskId: context.taskId, missionId: context.missionId, agentId: claims?.agentInstanceId ?? context.actor,
          actor: claims?.agentInstanceId ?? context.actor, permission, toolId: descriptor.id, input: request.input,
          reason: `Revalidate action ${descriptor.id} authority before dispatch.`,
        }));
        if (!decision.granted) return { allowed: false, reason: decision.reason };
      }
      return { allowed: true, reason: "Previously approved action authority remains active." };
    },
    requestApproval: config.approver
      ? async (descriptor, _request, context) => ({
        approved: await config.approver!.requestApproval(
          `${context.actor} requests action ${descriptor.name} (${descriptor.riskClass}).`,
          { missionId: context.missionId, executionId: context.executionId, providerId: descriptor.providerId, actionId: descriptor.id },
        ),
        actor: "human",
        reason: "Explicit action approval decision.",
      })
      : undefined,
    recordEvidence: async (evidence) => {
      await storage.memory.write({
        scope: "task",
        content: JSON.stringify(evidence),
        metadata: { recordType: "action-evidence", evidenceId: evidence.id, missionId: evidence.missionId, executionId: evidence.executionId },
      });
    },
    audit: async (event) => {
      await storage.memory.write({
        scope: "task",
        content: JSON.stringify(event),
        metadata: { recordType: "action-audit", actionId: event.actionId, missionId: event.missionId, executionId: event.executionId, phase: event.phase },
      });
    },
  });

runtime = new QuackRuntime({
    // Standing consent: each fresh mission receives default capability grants
    // derived from the operator's configured permission set (swe-config
    // defaults: memory.read/write, workspace.read). Auto-approvable only —
    // elevated permissions (terminal, git.write, ...) still require explicit
    // grants or an approver. Grants are persisted, auditable, revocable.
    missionGrantProvisioner: (missionId, actor) => {
      for (const permission of config.permissions) {
        if (STANDING_CONSENT_PERMISSIONS.has(permission)) {
          capabilityGrants.ensureGrant({
            missionId,
            capabilities: [`permission.${permission}`],
            approval: { approvedBy: "standing-consent", reason: `Default grant from configured permission set (${permission}).`, approvedAt: new Date().toISOString() },
          });
        }
      }
      void actor;
    },
    prepareGraph: async (graph, task, selection) => compileSkillContributions(graph,
      (selection?.selected ?? []).flatMap((selected) => {
        const definition = skillRegistry.get(selected.skillId, selected.version);
        return definition?.portableExecution ? [{ definition, record: skillRegistry.getRecord(selected.skillId, selected.version) }] : [];
      }), { goal: task.goal, parameters: {}, context: { workspaceRoot: config.workspaceRoot, dataDir: config.dataDir, sessionId: task.id } }, tools, config.permissions),

    brain,
    eventBus: events,
    memory,
    permissions: approvalPolicy,
    capabilityBroker,
    providers,
    taskStore: new CompositeTaskStore(storage.tasks, [new JsonFileTaskStore(join(config.dataDir, "tasks.json"))]),
    tools,
    learning: runtimeLearning,
    skillSelector: contextualSkillSelector,
    skillFitness,
    skillExecutor,
    skills: skillRegistry,
    // Mission completion certification (see QuackConfig.workflowVerification):
    // "evidence" (default) wires the deterministic workflow-evidence
    // validator — a bound VerificationRecordV1 over governed workflow
    // evidence (all nodes completed, none failed/skipped, tool evidence
    // present) is required to complete a mission. The runtime-supplied
    // recoveryEvidence is passed through as the bound evidence record so the
    // durable checkpoint's recovery.evidence.id and the record's evidenceIds
    // agree (execution-recovery binding contract). "brain"/"none" leave
    // certification to the brain's verifyExecution or an explicit
    // verifyExecution dependency — without one, missions fail closed.
    ...(config.workflowVerification === "evidence" ? {
      verifyExecution: (task: import("../runtime/task.js").Task, state: import("../engine/types.js").WorkflowState, context: import("../brain/brain.js").BrainContext) => validateWorkflow(workflowEvidenceValidator, {
        contractVersion: QUACK_CONTRACT_VERSION,
        missionId: context.missionId ?? task.id,
        taskId: task.id,
        executionId: task.id,
        actor: context.actor,
        signal: context.signal,
        deadline: context.deadline,
      }, task.goal, state, context.recoveryEvidence),
    } : {}),
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    missionId: config.missionId,
    improvementCoordinator,
    experiences: learningExperiences,
    companyAccess: {
      isActiveMission: (missionId) => companyRuntime.isActiveMission(missionId),
      resolvePrincipal: resolveCompanyExecutionPrincipal,
    },
  });

  const agentLoopPlanner = new Planner({
    defaultRetryPolicy: { maxRetries: 1, backoff: "fixed", baseDelayMs: 100, maxDelayMs: 1000 },
    defaultTimeoutMs: 30_000,
    maxNodesPerGraph: 20,
    modelRuntime: gatedModelRuntime,
  });
const agentLoop = new AgentLoop({
          runtime,
          missionManager: cognitiveSystem.missionManager,
          planner: agentLoopPlanner,
          skills: skillRegistry,
          harness: new QuackNativeHarness(
            { runtime: { executeTool: (toolId, input, options) => runtime.executeTool(toolId, input, options) } },
            { harnessId: "QUACK_NATIVE" }
          ),
          capabilityBroker,
          eventBus: events,
          memory,
          memoryManager,
        });
    
      const legacyHarness = createHarness({
              eventBus: events,
              traceRepository: storage.traces,
              evaluationRepository: storage.evaluations,
            });

            const skillRuntime = new SkillRuntime({
    executeGraph: (graph, actor, options) => runtime.executeGraph(graph, actor, options),
    registry: skillRegistry,
    tools,
    capabilityBroker,
    executeTool: (toolId, input, options) => runtime.executeTool(toolId, input, options),
    eventBus: events,
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
  });
  const skillPackages = new SkillPackageManager({
    runtime: skillRuntime,
    registry: skillRegistry,
    tools,
    capabilityBroker,
    eventBus: events,
    store: new JsonFileSkillPackageStore(join(config.dataDir, "skills", "packages.json")),
  });
  const workforce = createWorkforce(skillRuntime, gatedModelRuntime, { definitions: defaultSpecialistAgents() });
  // Phase 7E: persona workforce — style-only decorated variants of the same
  // base agents; they carry identical capabilities/skills/trust and never
  // widen authority (enforced by src/agents/personas tests).
  const personaWorkforce = createWorkforce(skillRuntime, gatedModelRuntime, {
    definitions: buildPersonaWorkforce(defaultSpecialistAgents()),
  });

    // --- Wire the controlled self-modification gate (never auto-merges) ---
  const selfModification = new CodeImprovementController({
    toolExecute: (toolId, input, options) => runtime.executeTool(toolId, input, options),
    workspaceRoot: config.workspaceRoot,
    store: new JsonFileCodeExperimentStore(join(config.dataDir, "selfmod", "experiments.json")),
    events,
    evidence: learningExperiences,
    objectives,
  });
  const improvementProposalBridge = new ImprovementProposalBridge({ controller: selfModification });
  improvementCoordinator.setProposalBridge(improvementProposalBridge);

  // --- Wire QUACK OS Evolution modules (quackos.md) ---
  const contextBootloader = ContextLoader.create({
    workspaceRoot: config.workspaceRoot,
    dataDir: config.dataDir,
    enabled: true,
  });
  const identityMemory = new IdentityMemoryStore(config.dataDir);
  const decisionMemory = new DecisionMemoryStore(config.dataDir);
  const evaluator = new EvaluatorAgent({ threshold: 0.7 });
  const knowledgePipeline = new KnowledgeIngestionPipeline();
  const workflowLoader = new WorkflowLoader();
  const coreAgentRegistry = new CoreAgentRegistry(agentRegistry);
  const coreAgentMonitor = new CoreAgentMonitor(coreAgentRegistry);
  const coreLifecycle = new CoreLifecycleManager(coreAgentRegistry, orgManager);

    // Create api early so it can be referenced in the system object
    const api = new QuackApi();

    const system: QuackSystem = {
      runtime,
      events,
      tools,
      researchTool,
      recipes,
      providers,
      providerRouter,
      providerKernel,
      capabilityRouter,
      governedProviderRouter,
      governedModelRuntime,
      actionProviders,
      actionRuntime,
      mcpServers,
      networkPolicy,
      browser,
      memory,
      memoryManager,
      storage,
      auditLog,
      config,
      semanticLayer,
      sea,
      skills: skillRegistry,
      skillRegistryLoad: {
        snapshot: skillRegistryLoad.snapshot,
        issues: [...skillRegistryLoad.issues, ...reconciliation.issues],
      },
      skillExecutor,
      skillRuntime,
      skillPackages,
      workforce,
      personaWorkforce,
      personas: PERSONAS,
      api,
      dashboard: undefined as unknown as DeveloperDashboard,
      skillOrchestrator,
      models: modelRegistry,
      modelRouter,
      modelRuntime: gatedModelRuntime,
      workspaces: workspaceManager,
      plugins: pluginRegistry,
      organization: {
        registry: agentRegistry,
        comms: agentComms,
        memory: orgMemory,
        metrics: agentMetrics,
        manager: orgManager,
      },
      cognitiveSystem,
                        objectives,
                        objectiveEvaluator,
                        learningExperiences,
                        runtimeLearning,
                        experienceStore,
                        experienceBroker,
                        dailyLearning,
                        ucp,
            dnpl,
            airm,
            adaptive,
            adaptiveSkillEvolution,
            skillFitness,
            contextualSkillSelector,
            skillFitnessReviewLoop,
            improvementCycle,
            improvementCoordinator,
            improvementProposalBridge,
            contextBootloader,
            identityMemory,
            decisionMemory,
            approvalPolicy,
            approvals,
            capabilityBroker,
            capabilityGrants,
            companyRuntime,
            evaluator,
            knowledgePipeline,
            workflowLoader,
            coreAgentRegistry,
                                    coreAgentMonitor,
                                    coreLifecycle,
                                    agentLoop,
                                    harness: legacyHarness,
                                    selfModification,
          };
          api.setSystem(system);
          Object.assign(system, {
            api,
            dashboard: new DeveloperDashboard(system),
          });
        return system;
      }

function findBrowserExecutable(): string | undefined {
  const configured = process.env["QUACK_BROWSER_EXECUTABLE"];
  if (configured && existsSync(configured)) return configured;
  const candidates = process.platform === "win32" ? [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ] : [];
  return candidates.find((path) => existsSync(path));
}
