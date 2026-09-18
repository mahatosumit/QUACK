/**
 * QUACK Backward Compatibility Module
 *
 * Provides isolated aliases for legacy harness identifiers (e.g. DeepSeekHarness)
 * so existing callers remain functional while QUACK's canonical product identity
 * uses ComposableAgentHarness / QUACK Agent Harness exclusively.
 */

import { ComposableAgentHarness, type ComposableHarnessOptions } from "./composable-harness.js";
import { type HarnessRegistry } from "./registry.js";

export { ComposableAgentHarness as DeepSeekHarness };
export { SandboxPlugin, TrajectoryPlugin, SafetyGuardPlugin, ResourceBudgetPlugin, type HarnessPlugin } from "./composable-harness.js";

export function createDeepSeekHarness(system: any, harnessConfig: { harnessId: string }, options?: ComposableHarnessOptions): ComposableAgentHarness {
  return new ComposableAgentHarness(system, harnessConfig, options);
}

export function registerDeepSeekHarness(registry: HarnessRegistry, system: any, options?: ComposableHarnessOptions): void {
  registry.register({
    id: "DEEPSEEK_HARNESS",
    factory: async (config) => new ComposableAgentHarness(system, config, options),
    metadata: {
      id: "DEEPSEEK_HARNESS",
      name: "QUACK Agent Harness (Legacy Alias)",
      version: "1.0.0",
      description: "Backward compatibility alias for QUACK Composable Agent Harness.",
      vendor: "QUACK OS",
      homepage: "https://github.com/mahatosumit/QUACK",
      repository: "https://github.com/mahatosumit/QUACK",
      license: "MIT",
      capabilities: {
        tools: "NATIVE",
        mcp: "EMULATED",
        subagents: "UNSUPPORTED",
        continuableSubagents: "UNSUPPORTED",
        streaming: "NATIVE",
        structuredOutput: "NATIVE",
        checkpoint: "NATIVE",
        resume: "NATIVE",
        interrupt: "NATIVE",
        workspace: "NATIVE",
        isolatedEnvironment: "NATIVE",
        backgroundJobs: "UNSUPPORTED",
        humanApproval: "NATIVE",
      },
      minQuackVersion: "1.0.0",
      platforms: ["win32", "linux", "darwin"],
      requiredEnvVars: [],
      optionalEnvVars: [],
    },
    healthCheck: async () => "HEALTHY",
    certification: "H4_DURABLE",
    priority: 100,
    tags: ["compatibility", "legacy-alias"],
  });
}
