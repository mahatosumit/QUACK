import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoveryFixture } from "../test-support/recovery-child.js";
import { canonicalFixture } from "../test-support/canonical-runtime.js";
import type { Checkpoint } from "../engine/types.js";

test("a completed durable mission carries a receipt citing the durable evidence chain", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-receipt-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = recoveryFixture(dir);
  t.after(() => fixture.runtime.shutdown());

  const result = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.data.status, "completed");

  const receipt = result.data.result?.["receipt"] as Record<string, unknown> | undefined;
  assert.ok(receipt, "completed durable task result must carry a receipt");
  assert.equal(receipt.contractVersion, "1.0.0");
  assert.equal(receipt.missionId, "measurement");
  assert.equal(receipt.executionId, result.data.id);
  assert.equal(receipt.taskId, result.data.id);
  assert.equal(receipt.verificationStatus, "PASSED");
  assert.equal(receipt.verifier, "fixture.validator");
  assert.ok(typeof receipt.verificationId === "string" && (receipt.verificationId as string).length > 0);
  assert.match(String(receipt.evidenceDigest), /^[a-f0-9]{64}$/);
  assert.equal(receipt.independent, true);

  // The receipt must cite the evidence that the durable checkpoint stores.
  const identity = result.data.execution;
  assert.ok(identity);
  const envelope = JSON.parse(await readFile(join(dir, "sessions", identity.sessionId, "checkpoints.json"), "utf8")) as {
    version: number; checkpoints: Checkpoint[];
  };
  const checkpoint = envelope.checkpoints.find((value) => value.workflowId === identity.workflowId);
  assert.ok(checkpoint?.recovery?.evidence);
  assert.equal(receipt.evidenceId, checkpoint.recovery.evidence.id);
  assert.ok(checkpoint.recovery.verification?.record);
  assert.equal(receipt.verificationId, checkpoint.recovery.verification.record!.id);
});

test("a completed non-durable mission does not mint a receipt", async t => {
  const fixture = canonicalFixture();
  t.after(() => fixture.runtime.shutdown());
  const result = await fixture.runtime.submitGoal(fixture.graph.description, "observer");
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(result.data.status, "completed");
  assert.equal(result.data.result?.["receipt"], undefined);
});