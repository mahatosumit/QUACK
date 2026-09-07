import { AiRuntimeManager } from "./runtime-manager.js";
import type { AiCapability, RoutingRequest, RoutingDecision, DashboardData, RuntimeMonitorSnapshot } from "./types.js";

export interface AIRMConfig {
  autoStartScheduler?: boolean;
  schedulerIntervalMs?: number;
}

export interface AIRM {
  readonly manager: AiRuntimeManager;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  routeRequest(request: RoutingRequest): Promise<RoutingDecision | null>;
  executePipeline(pipelineId: string, input: unknown): Promise<unknown>;
  discoverModels(): Promise<void>;
  getDashboardData(): DashboardData;
  getMonitorSnapshot(): RuntimeMonitorSnapshot | undefined;
}

export function createAIRM(config: AIRMConfig = {}): AIRM {
  const manager = new AiRuntimeManager();

  const airm: AIRM = {
    manager,
    async initialize(): Promise<void> {
      await manager.initialize();
      if (config.autoStartScheduler !== false) {
        await manager.scheduler.start(config.schedulerIntervalMs ?? 1000);
      }
    },
    async shutdown(): Promise<void> {
      await manager.shutdown();
    },
    async routeRequest(request: RoutingRequest): Promise<RoutingDecision | null> {
      return manager.routeRequest(request);
    },
    async executePipeline(pipelineId: string, input: unknown): Promise<unknown> {
      return manager.executePipeline(pipelineId, input);
    },
    async discoverModels(): Promise<void> {
      await manager.discoverModels();
    },
    getDashboardData(): DashboardData {
      return manager.getDashboardData();
    },
    getMonitorSnapshot(): RuntimeMonitorSnapshot | undefined {
      return manager.getMonitorSnapshot();
    },
  };

  return airm;
}
