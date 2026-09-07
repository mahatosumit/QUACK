export type ActionConformanceCaseId =
  | "ACT-001" | "ACT-002" | "ACT-003" | "ACT-004" | "ACT-005"
  | "ACT-006" | "ACT-007" | "ACT-008" | "ACT-009" | "ACT-010"
  | "ACT-011" | "ACT-012" | "ACT-013" | "ACT-014" | "ACT-015";

export interface ActionConformanceResult {
  readonly id: ActionConformanceCaseId;
  readonly name: string;
  readonly status: "PASS" | "FAIL" | "BLOCKED";
  readonly durationMs: number;
  readonly reason?: string;
}
export interface ActionConformanceFixture {
  readonly providerId: string;
  readonly hooks: Partial<Record<ActionConformanceCaseId, () => Promise<void>>>;
  readonly blockedReason?: string;
}

const CASES: readonly { readonly id: ActionConformanceCaseId; readonly name: string }[] = [
  { id: "ACT-001", name: "discovery" },
  { id: "ACT-002", name: "schema normalization" },
  { id: "ACT-003", name: "permissions" },
  { id: "ACT-004", name: "risk metadata" },
  { id: "ACT-005", name: "approval" },
  { id: "ACT-006", name: "read" },
  { id: "ACT-007", name: "mock write" },
  { id: "ACT-008", name: "timeout" },
  { id: "ACT-009", name: "provider unavailable" },
  { id: "ACT-010", name: "malformed response" },
  { id: "ACT-011", name: "authentication failure" },
  { id: "ACT-012", name: "cancellation" },
  { id: "ACT-013", name: "idempotency" },
  { id: "ACT-014", name: "audit" },
  { id: "ACT-015", name: "evidence" },
];

/** A provider is conformant only when every mandatory action case passes. */
export async function runActionConformance(fixture: ActionConformanceFixture): Promise<{
  readonly providerId: string;
  readonly results: readonly ActionConformanceResult[];
  readonly conformant: boolean;
}> {
  if (fixture.blockedReason) {
    return {
      providerId: fixture.providerId,
      results: CASES.map((item) => ({ id: item.id, name: item.name, status: "BLOCKED", durationMs: 0, reason: fixture.blockedReason })),
      conformant: false,
    };
  }
  const results: ActionConformanceResult[] = [];
  for (const item of CASES) {
    const started = Date.now();
    try {
      const hook = fixture.hooks[item.id];
      if (!hook) throw new Error(`Mandatory action conformance fixture hook ${item.id} is missing.`);
      await hook();
      results.push({ id: item.id, name: item.name, status: "PASS", durationMs: Date.now() - started });
    } catch (error) {
      results.push({ id: item.id, name: item.name, status: "FAIL", durationMs: Date.now() - started, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { providerId: fixture.providerId, results, conformant: results.every((result) => result.status === "PASS") };
}
