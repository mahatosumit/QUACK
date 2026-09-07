import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "./swe-system.js";
import type { GovernedModelRuntimeSurface } from "../models/governed-runtime.js";

test("SWE system model surface cannot bypass governed authority", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-govsurf-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const system = createQuackSystem({ dataDir: join(dir, "state"), workspaceRoot: dir });
  const modelRuntime = system.modelRuntime as unknown as GovernedModelRuntimeSurface;

  // The exposed modelRuntime shadows generate/stream with broker-gated versions.
  assert.equal(typeof system.governedModelRuntime.generate, "function");
  assert.equal(typeof system.governedProviderRouter.route, "function");

  // Without a mission grant, provider.invoke is denied: the gated surface fails
  // closed before contacting any provider endpoint.
  const denied = await modelRuntime.generate({ prompt: "hello", model: "echo-1" },
    { missionId: "mission-without-grant", actor: "observer" });
  assert.ok(!denied.ok);
  if (!denied.ok) {
    assert.equal(denied.error.code, "model.permission_denied");
  }

  // Without an execution context the gated surface refuses to dispatch at all.
  const noContext = await modelRuntime.generate({ prompt: "hello", model: "echo-1" });
  assert.ok(!noContext.ok);
  if (!noContext.ok) assert.equal(noContext.error!.code, "model.execution_context_required");

  // Metadata-only selectModel remains available (registry lookup, no network).
  const selected = modelRuntime.selectModel({});
  assert.ok(selected.ok);
  if (selected.ok) assert.equal(selected.data.status, "available");
});