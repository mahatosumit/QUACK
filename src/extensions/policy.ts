import { scopeAllows, type CapabilityBroker, type CapabilityDecision, type CapabilityRequest } from "../security/capability-broker.js";
import type { ApprovalCallback } from "../security/approval-controller.js";
import type { AgentProfile, PolicyProvider } from "./types.js";

/** Restricts an existing broker. Extension policy never supplies missing authority. */
export class ExtensionPolicyBroker implements CapabilityBroker {
  constructor(
    private readonly authority: CapabilityBroker,
    private readonly policies: readonly PolicyProvider[],
    private readonly profiles: readonly AgentProfile[],
    private readonly approver?: ApprovalCallback,
  ) {}

  revalidateAuthority(request: CapabilityRequest): CapabilityDecision {
    const denied = (reason: string): CapabilityDecision => ({ requestId: request.id, capabilityId: request.capabilityId, granted: false, reason, policyRef: "extension-policy" });
    const authority = this.authority.revalidateAuthority?.(request);
    if (!authority?.granted) return authority ?? denied("A live authority recheck is required.");
    if (request.agentId) {
      const profile = this.profiles.find((candidate) => candidate.id === request.agentId);
      if (!profile) return denied("The requested agent profile is not registered.");
      if (!profile.capabilityPolicy.ceiling.includes(request.capabilityId)) return denied("The agent profile excludes this capability.");
      if (request.toolId && !profile.allowedTools.includes(request.toolId)) return denied("The agent profile excludes this tool.");
      if (!scopeAllows(profile.capabilityPolicy.scope, request.resource, request)) return denied("The request exceeds the agent profile scope.");
    }
    return authority;
  }

  async resolve(request: CapabilityRequest): Promise<CapabilityDecision> {
    const live = this.revalidateAuthority(request);
    if (!live.granted) return live;
    const denied = (reason: string): CapabilityDecision => ({ ...live, granted: false, reason, policyRef: "extension-policy" });
    const questions: string[] = [];
    for (const policy of this.policies) {
      let restriction;
      try { restriction = await policy.restrict(structuredClone(request)); }
      catch { return denied(`Policy ${policy.id} could not evaluate this request.`); }
      if (!restriction || !["ALLOW", "ASK", "DENY"].includes(restriction.decision)) return denied(`Policy ${policy.id} returned an invalid decision.`);
      if (restriction.decision === "DENY") return denied(restriction.reason);
      if (restriction.decision === "ASK") questions.push(restriction.reason);
    }
    const decision = await this.authority.resolve(request);
    if (!decision.granted) return decision;
    if (questions.length) {
      if (!this.approver || !await this.approver.requestApproval(questions.join("\n"), { capabilityId: request.capabilityId, taskId: request.taskId ?? null })) {
        return denied("Extension policy approval was not granted.");
      }
    }
    const current = this.revalidateAuthority(request);
    return current.granted ? decision : current;
  }
}
