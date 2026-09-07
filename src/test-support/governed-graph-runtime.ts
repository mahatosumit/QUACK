import { createId } from "../core/types.js";
import { EventBus } from "../events/event-bus.js";
import { InMemoryMemoryStore } from "../memory/memory.js";
import { ProviderRegistry } from "../providers/provider.js";
import { QuackRuntime } from "../runtime/runtime.js";
import { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker, capabilityIdForPermission } from "../security/capability-broker.js";
import { AllowListPermissionPolicy, type Permission } from "../security/permissions.js";
import { EchoTool, type ToolRegistry, type ToolMetadata } from "../tools/tool.js";

export class FixtureEchoTool extends EchoTool {
  override describe(): ToolMetadata { return { ...super.describe(), permissions: ["workspace.read"] }; }
}

export function createGovernedGraphRuntime(tools: ToolRegistry, allowed: readonly Permission[]): QuackRuntime {
  const permissions = new AllowListPermissionPolicy(allowed);
  const grants = new InMemoryCapabilityGrantRegistry();
  const missionId = createId("graph_fixture");
  if (allowed.length) grants.createGrant({ missionId, capabilities: allowed.map(capabilityIdForPermission),
    scope: { toolIds: tools.list().map((tool) => tool.id) },
    approval: { approvedBy: "test-fixture", approvedAt: new Date().toISOString(), reason: "Authorize only declared fixture operations." },
  });
  return new QuackRuntime({ eventBus: new EventBus(), memory: new InMemoryMemoryStore(), tools, providers: new ProviderRegistry(),
    permissions, capabilityBroker: new PermissionBackedCapabilityBroker(permissions, grants), missionId });
}
