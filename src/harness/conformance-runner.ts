import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { capabilityIdForPermission } from "../security/capability-broker.js";
import { createIsolatedQuackSystem } from "../test-support/isolated-system.js";
import { QuackNativeHarness } from "./registry.js";
import { runHarnessConformanceTests } from "./conformance.js";

async function run(): Promise<void> {
  const fixture = await createIsolatedQuackSystem({ permissions: ["workspace.read"] });
  await writeFile(join(fixture.system.config.workspaceRoot, "conformance.txt"), "fixture");
  fixture.system.capabilityGrants.ensureGrant({ missionId: "conformance", agentId: "conformance", capabilities: [capabilityIdForPermission("workspace.read")],
    scope: { workspacePaths: ["."], toolIds: ["core.workspace.list-files"], actions: ["READ"] },
    approval: { approvedBy: "fixture", reason: "Conformance listing fixture.", approvedAt: new Date().toISOString() },
  });
  const config = { harnessId: "QUACK_NATIVE" };
  const harness = new QuackNativeHarness(fixture.system, config);
  try {
    const result = await runHarnessConformanceTests(harness, config, {
      input: { goal: "list fixture", toolInvocations: [{ toolId: "core.workspace.list-files", input: { path: ".", depth: 1 } }] },
      context: { missionId: "conformance", runId: "fixture", iterationId: "fixture", actor: "conformance",
        workspaceRoot: process.cwd(), dataDir: process.cwd(), capabilities: [], trustClass: "SYSTEM" },
      assertOutput(output) {
        const calls = output.result?.toolCalls as { output: { files: string[] } }[];
        assert.ok(calls[0].output.files.some((file) => file.startsWith("conformance.txt ")));
        assert.equal(output.result?.goalVerified, false);
      },
    });
    for (const check of result.results) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.testId}: ${check.name}${check.error ? `: ${check.error}` : ""}`);
    console.log(`${result.passedTests}/${result.totalTests} contract checks passed. No production certification is issued.`);
    if (!result.overallPass) process.exitCode = 1;
  } finally { await harness.dispose(); await fixture.cleanup(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
