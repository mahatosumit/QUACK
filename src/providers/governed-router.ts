import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import { buildToolCapabilityRequest, type CapabilityBroker } from "../security/capability-broker.js";
import type { ExecutionContextV1 } from "../contracts/v1/contracts.js";
import {
  CapabilityProviderRouter, ProviderRoutingError, type ProviderRouteRequestV1, type ProviderRouteResultV1,
} from "./kernel.js";

/**
 * Governed provider dispatch boundary.
 *
 * Every provider/model operation must ultimately pass through the capability
 * broker. This wrapper resolves `provider.invoke` authority for the current
 * execution identity before contacting any provider, so a provider cannot
 * manufacture authority by calling the raw router directly. The raw
 * `CapabilityProviderRouter` remains a pure policy/capability/circuit router;
 * it is only reachable through this governed boundary inside the canonical
 * runtime composition.
 */
export class GovernedProviderRouter {
  constructor(
    private readonly router: CapabilityProviderRouter,
    private readonly capabilityBroker: CapabilityBroker,
  ) {}

  async route(input: ProviderRouteRequestV1): Promise<ProviderRouteResultV1> {
    const context: ExecutionContextV1 = input.context;
    const request = buildToolCapabilityRequest({
      taskId: context.taskId,
      missionId: context.missionId,
      agentId: context.metadata?.["agentId"] as string | undefined,
      skillId: context.metadata?.["skillId"] as string | undefined,
      actor: context.actor,
      toolId: `provider:${input.request.model}`,
      permission: "provider.invoke",
      input: { model: input.request.model },
      reason: `Model generation for ${input.request.model} requires provider invocation authority.`,
    });
    const decision = await this.capabilityBroker.resolve(request);
    if (!decision.granted) {
      throw new ProviderRoutingError({
        contractVersion: QUACK_CONTRACT_VERSION, category: "POLICY_DENIED", providerId: "router",
        model: input.request.model, message: decision.reason, retriable: false,
      });
    }
    const current = this.capabilityBroker.revalidateAuthority?.(request);
    if (current && !current.granted) {
      throw new ProviderRoutingError({
        contractVersion: QUACK_CONTRACT_VERSION, category: "POLICY_DENIED", providerId: "router",
        model: input.request.model, message: current.reason, retriable: false,
      });
    }
    return this.router.route(input);
  }
}