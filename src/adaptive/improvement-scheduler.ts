import { createId } from "../core/types.js";
import type { ImprovementProposal } from "./types.js";

export function createAutonomousImprovementScheduler() {
  const proposals: ImprovementProposal[] = [];
  const maxProposals = 500;

  function proposeImprovement(proposal: ImprovementProposal): void {
    proposals.push({ ...proposal, id: proposal.id || createId("ip") });
    if (proposals.length > maxProposals) {
      proposals.splice(0, proposals.length - maxProposals);
    }
  }

  function getProposals(status?: string): ImprovementProposal[] {
    if (status) {
      return proposals.filter((p) => p.status === status);
    }
    return [...proposals];
  }

  function approveProposal(id: string): void {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) throw new Error(`Proposal ${id} not found`);
    proposal.status = "approved";
  }

  function rejectProposal(id: string, reason: string): void {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) throw new Error(`Proposal ${id} not found`);
    proposal.status = "rejected";
  }

  async function applyProposal(id: string): Promise<void> {
    const proposal = proposals.find((p) => p.id === id);
    if (!proposal) throw new Error(`Proposal ${id} not found`);
    if (proposal.status !== "approved") {
      throw new Error(`Proposal ${id} is not approved (status: ${proposal.status})`);
    }
    throw new Error("Applying proposals is unsupported: use the governed improvement controller.");
  }

  async function runCycle(): Promise<ImprovementProposal[]> {
    throw new Error("Automatic improvement generation is unsupported: no evidence evaluator is configured.");
  }

  return { proposeImprovement, getProposals, approveProposal, rejectProposal, applyProposal, runCycle };
}

