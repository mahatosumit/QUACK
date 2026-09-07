import type { DistillationRecord } from "./types.js";

export function createKnowledgeDistillationEngine() {
  const distillations: DistillationRecord[] = [];

  function distill(
    sourceType: string,
    sourceId: string,
    targetType: string,
    strategy?: string
  ): DistillationRecord {
    throw new Error("Knowledge distillation is unsupported: no distillation executor is configured.");
  }

  function getDistillations(sourceId: string): DistillationRecord[] {
    return distillations.filter((d) => d.sourceId === sourceId);
  }

  function getProvenance(distillationId: string): string[] {
    const record = distillations.find((d) => d.id === distillationId);
    return record?.provenance ?? [];
  }

  return { distill, getDistillations, getProvenance };
}

