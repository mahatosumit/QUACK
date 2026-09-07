import { QUACK_CONTRACT_VERSION, type EvidenceRecordV1, type ExecutionContextV1, type VerificationRecordV1 } from "../contracts/v1/contracts.js";
import type { JsonObject } from "../core/types.js";
import type { WorkflowState } from "../engine/types.js";
import { createWorkflowEvidence } from "../engine/execution-recovery.js";
import type { ValidationProvider } from "../extensions/types.js";

export async function validateWorkflow(provider: ValidationProvider, execution: ExecutionContextV1, goal: string, state: WorkflowState, suppliedEvidence?: EvidenceRecordV1): Promise<{ success: boolean; reason: string; record?: VerificationRecordV1 }> {
  const evidence = suppliedEvidence ?? createWorkflowEvidence(execution, state);
  const invalid = { success: false, reason: "Validation provider returned an invalid or unbound verification record." };
  try {
    const result = structuredClone(await provider.validate({
      execution: { ...execution }, successCriteria: [goal],
      output: structuredClone(state.nodeResults) as unknown as JsonObject, evidence: [structuredClone(evidence)],
    }));
    if (!result || result.contractVersion !== QUACK_CONTRACT_VERSION
      || result.missionId !== execution.missionId || result.executionId !== execution.executionId
      || result.verifier !== provider.id || typeof result.id !== "string" || !result.id.trim()
      || typeof result.message !== "string" || !result.message.trim()
      || typeof result.checkedAt !== "string" || !Number.isFinite(Date.parse(result.checkedAt))
      || !["PASSED", "FAILED", "INCONCLUSIVE"].includes(result.status)
      || !Array.isArray(result.evidenceIds)
      || new Set(result.evidenceIds).size !== result.evidenceIds.length
      || result.evidenceIds.some((id) => id !== evidence.id)
      || (result.status === "PASSED" && result.evidenceIds.length === 0)) return invalid;
    return { success: result.status === "PASSED", reason: result.message, record: result };
  } catch {
    return invalid;
  }
}
