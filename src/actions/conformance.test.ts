import assert from "node:assert/strict";
import test from "node:test";
import { runActionConformance, type ActionConformanceCaseId } from "./conformance.js";

test("action conformance requires all fifteen cases", async () => {
  const ids = Array.from({ length: 15 }, (_, index) => `ACT-${String(index + 1).padStart(3, "0")}` as ActionConformanceCaseId);
  const hooks = Object.fromEntries(ids.map((id) => [id, async () => undefined]));
  const report = await runActionConformance({ providerId: "fake", hooks });
  assert.equal(report.results.length, 15);
  assert.equal(report.conformant, true);
});
test("missing action conformance fixture cannot be reported conformant", async () => {
  const report = await runActionConformance({ providerId: "fake", hooks: {} });
  assert.equal(report.conformant, false);
  assert.equal(report.results.every((result) => result.status === "FAIL"), true);
});
