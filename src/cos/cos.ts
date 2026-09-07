import { type AgentRegistry } from "../organization/registry.js";
import { type AgentCommunicationBus } from "../organization/communication.js";
import { type OrganizationalMemory } from "../organization/memory.js";
import { type AgentMetricsCollector } from "../organization/metrics.js";
import { type AgentLifecycleManager } from "../organization/lifecycle.js";
import { GoalManager } from "./goal-manager.js";
import { TimeManager } from "./time-manager.js";
import { ResourceManager } from "./resource-manager.js";
import { PriorityManager } from "./priority-manager.js";
import { DecisionEngine } from "./decision-engine.js";
import { CouncilEngine } from "./council-engine.js";
import { MissionManager } from "./mission-manager.js";
import { StrategyEngine } from "./strategy-engine.js";
import { ExperienceEngine } from "./experience-engine.js";
import { LearningEngine } from "./learning-engine.js";
import { GovernanceEngine } from "./governance-engine.js";
import { OrganizationalIntelligence } from "./org-intelligence.js";
import { MetricsEngine } from "./metrics-engine.js";
import { ProgressTracker } from "./progress-tracker.js";
import { ContextManager } from "./context-manager.js";
import { CapabilityManager } from "./capability-manager.js";
import { SkillEvolutionEngine } from "./skill-evolution.js";
import { type MissionRepository } from "../storage/sqlite.js";

export interface CognitiveOperatingSystem {
  readonly goalManager: GoalManager;
  readonly timeManager: TimeManager;
  readonly resourceManager: ResourceManager;
  readonly priorityManager: PriorityManager;
  readonly decisionEngine: DecisionEngine;
  readonly councilEngine: CouncilEngine;
  readonly missionManager: MissionManager;
  readonly strategyEngine: StrategyEngine;
  readonly experienceEngine: ExperienceEngine;
  readonly learningEngine: LearningEngine;
  readonly governanceEngine: GovernanceEngine;
  readonly organizationalIntelligence: OrganizationalIntelligence;
  readonly metricsEngine: MetricsEngine;
  readonly progressTracker: ProgressTracker;
  readonly contextManager: ContextManager;
  readonly capabilityManager: CapabilityManager;
  readonly skillEvolutionEngine: SkillEvolutionEngine;
}

export interface CosDependencies {
  registry: AgentRegistry;
  comms: AgentCommunicationBus;
  orgMemory: OrganizationalMemory;
  agentMetrics: AgentMetricsCollector;
  lifecycleManager: AgentLifecycleManager;
  missionRepository?: MissionRepository;
}

export function createCos(deps: CosDependencies): CognitiveOperatingSystem {
  const goalManager = new GoalManager();
  const timeManager = new TimeManager();
  const resourceManager = new ResourceManager(deps.registry);
  const priorityManager = new PriorityManager();
  const decisionEngine = new DecisionEngine();
  const councilEngine = new CouncilEngine(deps.comms, deps.registry);
  const missionManager = new MissionManager(deps.missionRepository);
  const strategyEngine = new StrategyEngine();
  const experienceEngine = new ExperienceEngine();
  const learningEngine = new LearningEngine(deps.orgMemory);
  const governanceEngine = new GovernanceEngine();
  const organizationalIntelligence = new OrganizationalIntelligence(deps.registry, deps.orgMemory, goalManager, deps.lifecycleManager);
  const metricsEngine = new MetricsEngine(deps.registry, deps.orgMemory, deps.agentMetrics, goalManager, decisionEngine, experienceEngine, learningEngine, governanceEngine, deps.lifecycleManager);
  const progressTracker = new ProgressTracker(goalManager, timeManager);
  const contextManager = new ContextManager(goalManager, decisionEngine, experienceEngine, deps.registry);
  const capabilityManager = new CapabilityManager(deps.registry);
  const skillEvolutionEngine = new SkillEvolutionEngine(goalManager, organizationalIntelligence);

  return {
    goalManager,
    timeManager,
    resourceManager,
    priorityManager,
    decisionEngine,
    councilEngine,
    missionManager,
    strategyEngine,
    experienceEngine,
    learningEngine,
    governanceEngine,
    organizationalIntelligence,
    metricsEngine,
    progressTracker,
    contextManager,
    capabilityManager,
    skillEvolutionEngine,
  };
}
