import test from "node:test";
import assert from "node:assert/strict";
import { validateIsolationProfile, effectiveGuarantees } from "./contract.js";
import type { IsolationBackend, IsolationProfile, IsolationRequest, IsolationResult } from "./contract.js";

const profile = (overrides: Partial<IsolationProfile> = {}): IsolationProfile => ({
  level: "IN_PROCESS",
  filesystem: { workspaceRoot: "/workspace" },
  network: { mode: "DENY" },
  environment: { variables: {}, secrets: [] },
  limits: { wallClockMs: 1000 },
  ...overrides,
});

test("isolation profile validation rejects missing workspace and bad limits", () => {
  assert.throws(() => validateIsolationProfile({ ...profile(), filesystem: { workspaceRoot: "" } }));
  assert.throws(() => validateIsolationProfile({ ...profile(), limits: { wallClockMs: 0 } }));
  assert.throws(() => validateIsolationProfile({ ...profile(), network: { mode: "ALLOWLIST", hosts: [], schemes: ["https:"] } }));
});

test("IN_PROCESS isolation cannot mediate secrets and fails closed", () => {
  assert.throws(() => validateIsolationProfile({ ...profile(), environment: { variables: {}, secrets: ["API_KEY"] } }));
});

test("effective guarantees are honest per backend and unsupported levels", () => {
  const backend: IsolationBackend = {
    id: "fixture.backend", supportedLevels: ["IN_PROCESS"],
    guarantees: { filesystem: "BEST_EFFORT", network: "UNSUPPORTED", process: "UNSUPPORTED", environment: "UNSUPPORTED", resources: "BEST_EFFORT", secrets: "UNSUPPORTED" },
    execute: async (): Promise<IsolationResult> => { throw new Error("unused"); },
  };
  const inProcess = effectiveGuarantees(backend, profile());
  assert.equal(inProcess.filesystem, "BEST_EFFORT");
  assert.equal(inProcess.secrets, "UNSUPPORTED");

  const container = effectiveGuarantees(backend, profile({ level: "CONTAINER_ISOLATED" }));
  assert.equal(container.filesystem, "UNSUPPORTED");
  assert.equal(container.network, "UNSUPPORTED");
});

test("isolation request shape carries execution identity and provenance fields", () => {
  const request: IsolationRequest = {
    missionId: "mission-1", taskId: "task-1", executionId: "exec-1", actor: "observer",
    profile: profile(), workload: { kind: "function", run: async () => ({ ok: true }) },
  };
  assert.equal(request.profile.level, "IN_PROCESS");
  assert.equal(request.workload.kind, "function");
  assert.equal(request.missionId, "mission-1");
});