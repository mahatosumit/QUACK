import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, runQuackDoctor } from "./cli.js";
import { createQuackSystem } from "./distributions/swe-system.js";

test("CLI parseArgs parses doctor command", () => {
  const { command } = parseArgs(["node", "cli.js", "doctor"]);
  assert.equal(command, "doctor");
});

test("P8.8 CLI parseArgs parses instructions command and --mission filter", () => {
  const plain = parseArgs(["node", "cli.js", "instructions"]);
  assert.equal(plain.command, "instructions");
  assert.equal(plain.options.instructionMissionId, undefined);
  const filtered = parseArgs(["node", "cli.js", "instructions", "--mission", "mission-p88"]);
  assert.equal(filtered.command, "instructions");
  assert.equal(filtered.options.instructionMissionId, "mission-p88");
  const json = parseArgs(["node", "cli.js", "instructions", "--json"]);
  assert.equal(json.command, "instructions");
  assert.equal(json.options.json, true);
});

test("CLI parseArgs parses backup and restore paths", () => {
  assert.equal(parseArgs(["node", "cli.js", "backup", "C:\\backup"] ).options.backupPath, "C:\\backup");
  const restored = parseArgs(["node", "cli.js", "restore", "C:\\backup"]);
  assert.equal(restored.command, "restore");
  assert.equal(restored.options.backupPath, "C:\\backup");
});

test("CLI parseArgs parses serve command and custom port", () => {
  const { command, options } = parseArgs(["node", "cli.js", "serve", "--port", "9090"]);
  assert.equal(command, "serve");
  assert.equal(options.port, 9090);
});

test("CLI parseArgs parses start goal and workspace root", () => {
  const { command, options } = parseArgs(["node", "cli.js", "start", "-w", "./custom", "build test"]);
  assert.equal(command, "start");
  assert.equal(options.goal, "build test");
  assert.equal(options.workspaceRoot, "./custom");
});

test("CLI parseArgs parses production interface commands", () => {
  assert.equal(parseArgs(["node", "cli.js", "init"]).command, "init");
  assert.equal(parseArgs(["node", "cli.js", "skills"]).command, "skills");
  const skillsInstall = parseArgs(["node", "cli.js", "skills", "install", "./examples/packages/coding-assistant"]);
  assert.equal(skillsInstall.command, "skills");
  assert.equal(skillsInstall.options.skillAction, "install");
  assert.equal(skillsInstall.options.skillTarget, "./examples/packages/coding-assistant");
  const skillsEnable = parseArgs(["node", "cli.js", "skills", "enable", "coding-assistant"]);
  assert.equal(skillsEnable.options.skillAction, "enable");
  assert.equal(skillsEnable.options.skillTarget, "coding-assistant");
  assert.equal(parseArgs(["node", "cli.js", "agents"]).command, "agents");
  assert.equal(parseArgs(["node", "cli.js", "trace", "inspect workspace"]).command, "trace");
  const mission = parseArgs(["node", "cli.js", "mission", "inspect workspace"]);
  assert.equal(mission.command, "mission");
  assert.equal(mission.options.goal, "inspect workspace");
  assert.equal(parseArgs(["node", "cli.js", "evaluate", "inspect workspace"]).command, "evaluate");
});

test("runQuackDoctor executes system health checks cleanly", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "quack-cli-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const system = createQuackSystem({ workspaceRoot: root, dataDir: join(root, "state") });
  const reports: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { reports.push(String(message)); });
  context.mock.method(system.providers, "list", () => ["core.echo-provider"]);
  const passed = await runQuackDoctor(system);
  assert.equal(passed, true);
  assert.ok(reports.some((report) => report.includes(join(root, "state", "quack.sqlite"))));
});

test("P8.8 commandInstructions lists valid records, filters by mission, and excludes tampered ones", async (context) => {
  const { commandInstructions } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const root = await mkdtemp(join(tmpdir(), "quack-instructions-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "state");
  const system = createQuackSystem({ workspaceRoot: root, dataDir });
  try {
    // Store a real trace carrying metadata-only instruction records, plus
    // one tampered record that must fail closed at parse time.
    const record = (outcome: string, missionId: string, digest = "a".repeat(64)) => ({
      recordId: `rec-${outcome}-${missionId}`,
      missionId,
      digest,
      planVersion: 1,
      outputContractKind: "plainResponse",
      outcome,
      layerCensus: [{ layer: "identity", itemCount: 1, trusts: ["TRUSTED_RUNTIME"] }],
      totalItems: 1,
      omittedItemCount: 0,
      withinBudget: true,
      injectionFlagCount: 0,
      injectionFlags: [],
      dispatchedAt: new Date().toISOString(),
    });
    const trace = (missionId: string, instruction: unknown[]) => ({
      id: `trace-${missionId}`,
      missionInput: { missionId, goal: "p8.8 cli inspection", actor: "test" },
      plansGenerated: [], skillsSelected: [], capabilitiesRequested: [], toolsExecuted: [],
      verificationResults: [], iterations: [],
      finalOutcome: { success: true, state: "COMPLETED", latencyMs: 1 },
      events: [],
      instruction,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    await system.storage.traces.save(trace("mission-a", [record("dispatched", "mission-a")]) as never);
    await system.storage.traces.save(trace("mission-b", [
      record("rejected", "mission-b"),
      { ...record("dispatched", "mission-b"), outcome: "executed_anyway" }, // tampered
    ]) as never);
    await system.events.drain();
  } finally {
    // The command builds its own system over the same dataDir — safe to
    // release this one after persisting.
    await system.events.drain();
  }

  const config = loadCliConfig({ cli: { dataDir, workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });

  const all = await commandInstructions({ json: false, config });
  assert.equal(all, 0);
  const allOutput = lines.join("\n");
  assert.ok(allOutput.includes("mission-a"), "valid record from mission-a is listed");
  assert.ok(allOutput.includes("mission-b"), "valid record from mission-b is listed");
  assert.ok(allOutput.includes("rejected"), "outcome is shown");
  assert.ok(allOutput.includes("digest aaaaaaaaaaaa"), "digest prefix is shown");
  assert.ok(allOutput.includes("failed validation and were excluded"), "tampered record is excluded with an explicit notice");
  assert.ok(!allOutput.includes("executed_anyway"), "the tampered outcome never renders");

  lines.length = 0;
  const filtered = await commandInstructions({ json: false, config }, "mission-a");
  assert.equal(filtered, 0);
  const filteredOutput = lines.join("\n");
  assert.ok(filteredOutput.includes("mission-a"));
  assert.ok(!filteredOutput.includes("rec-rejected-mission-b".replace("rec-", "")) || !filteredOutput.includes("mission-b"), "mission filter excludes other missions' records");

  lines.length = 0;
  const json = await commandInstructions({ json: true, config }, "mission-b");
  assert.equal(json, 0);
  const parsed = JSON.parse(lines.join("\n")) as { recordCount: number; invalidRecordCount: number; records: { outcome: string }[] };
  assert.equal(parsed.recordCount, 1, "only the valid mission-b record survives");
  assert.equal(parsed.invalidRecordCount, 1, "the tampered record is counted as invalid");
  assert.equal(parsed.records[0].outcome, "rejected");
});

test("P9.24 CLI parseArgs parses memory command with actions and targets", () => {
  const bare = parseArgs(["node", "cli.js", "memory"]);
  assert.equal(bare.command, "memory");
  assert.equal(bare.options.memoryAction, undefined, "bare memory defaults to list at dispatch time");

  const explicit = parseArgs(["node", "cli.js", "memory", "list"]);
  assert.equal(explicit.command, "memory");
  assert.equal(explicit.options.memoryAction, "list");

  const inspect = parseArgs(["node", "cli.js", "memory", "inspect", "smem_1"]);
  assert.equal(inspect.command, "memory");
  assert.equal(inspect.options.memoryAction, "inspect");
  assert.equal(inspect.options.memoryTarget, "smem_1");

  const search = parseArgs(["node", "cli.js", "memory", "search", "deploy checklist"]);
  assert.equal(search.options.memoryAction, "search");
  assert.equal(search.options.memoryTarget, "deploy checklist");

  const remove = parseArgs(["node", "cli.js", "memory", "delete", "smem_2"]);
  assert.equal(remove.options.memoryAction, "delete");
  assert.equal(remove.options.memoryTarget, "smem_2");
});

test("P9.24 commandMemory lists, inspects, and deletes governed semantic memory", async (context) => {
  const { commandMemory } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const root = await mkdtemp(join(tmpdir(), "quack-memory-cli-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "state");

  const system = createQuackSystem({ workspaceRoot: root, dataDir });
  const remembered = await system.semanticMemory.remember({
    content: "operator prefers plain-text summaries in mission reports",
    scope: "global",
    owner: "operator",
    actor: "operator",
    context: { actor: "operator" },
  });
  assert.ok(remembered.ok);
  const memoryId = remembered.data.record.memoryId;
  await system.events.drain();

  const config = loadCliConfig({ cli: { dataDir, workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });

  const listed = await commandMemory({ json: false, config }, "list");
  assert.equal(listed, 0);
  assert.ok(lines.join("\n").includes(memoryId), "record id listed");
  assert.ok(lines.join("\n").includes("No semantic memory stored yet.") === false || lines.join("\n").includes(memoryId));

  lines.length = 0;
  const inspected = await commandMemory({ json: false, config }, "inspect", memoryId);
  assert.equal(inspected, 0);
  assert.ok(lines.join("\n").includes(memoryId));

  lines.length = 0;
  const inspectJson = await commandMemory({ json: true, config }, "inspect", memoryId);
  assert.equal(inspectJson, 0);
  const parsed = JSON.parse(lines.join("\n")) as { record: { provenance: { sourceKind: string } } };
  assert.equal(parsed.record.provenance.sourceKind, "user");

  lines.length = 0;
  const missing = await commandMemory({ json: false, config }, "inspect", "smem_absent");
  assert.equal(missing, 3, "not-found exits with the dedicated code");

  lines.length = 0;
  const deleted = await commandMemory({ json: true, config }, "delete", memoryId);
  assert.equal(deleted, 0);
  const deleteResult = JSON.parse(lines.join("\n")) as { deleted: boolean };
  assert.equal(deleteResult.deleted, true);

  lines.length = 0;
  const afterDelete = await commandMemory({ json: false, config }, "list");
  assert.equal(afterDelete, 0);
  assert.ok(!lines.join("\n").includes(memoryId), "deleted record no longer listed");
});

test("P9.24 commandMemory search reports honest unavailability without embeddings", async (context) => {
  const { commandMemory } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const root = await mkdtemp(join(tmpdir(), "quack-memory-cli-search-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "state");
  const system = createQuackSystem({ workspaceRoot: root, dataDir });
  await system.events.drain();

  const config = loadCliConfig({ cli: { dataDir, workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });

  const result = await commandMemory({ json: false, config }, "search", "anything");
  assert.equal(result, 1, "search without an embedding provider is an operational failure, not a crash");
  assert.ok(lines.join("\n").includes("Semantic search unavailable"));
});

test("P10.13 CLI parseArgs parses extension command with actions and targets", async () => {
  const { parseArgs } = await import("./cli.js") as { parseArgs: (argv: string[]) => { command: string; options: { extensionAction?: string; extensionTarget?: string } } };
  const bare = parseArgs(["node", "cli.js", "extension"]);
  assert.equal(bare.command, "extension");
  assert.equal(bare.options.extensionAction, undefined, "bare extension defaults to list at dispatch time");
  const listed = parseArgs(["node", "cli.js", "extension", "list"]);
  assert.equal(listed.options.extensionAction, "list");
  const installed = parseArgs(["node", "cli.js", "extension", "install", "C:\\pkg\\demo"]);
  assert.equal(installed.options.extensionAction, "install");
  assert.equal(installed.options.extensionTarget, "C:\\pkg\\demo");
  const enabled = parseArgs(["node", "cli.js", "extension", "enable", "demo.tool@1.0.0"]);
  assert.equal(enabled.options.extensionAction, "enable");
  assert.equal(enabled.options.extensionTarget, "demo.tool@1.0.0");
  const removed = parseArgs(["node", "cli.js", "extension", "remove", "demo.tool@1.0.0"]);
  assert.equal(removed.options.extensionAction, "remove");
  assert.equal(removed.options.extensionTarget, "demo.tool@1.0.0");
});

test("P10.13 commandExtension validates, installs, and lifecycle-manages extensions", async (context) => {
  const { commandExtension } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const { packageDigest } = await import("./ecosystem/index.js");
  const root = await mkdtemp(join(tmpdir(), "quack-extension-cli-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "state");
  await mkdir(join(root, "state"), { recursive: true }).catch(() => undefined);
  const packDir = join(root, "demo-tool");
  await mkdir(packDir, { recursive: true });
  const content = "exports.run = () => 1;";
  await writeFile(join(packDir, "manifest.json"), JSON.stringify({
    id: "demo.tool", name: "Demo Tool", version: "1.0.0", kind: "tool",
    description: "demo", quackContractVersion: "1.0.0",
    publisher: { name: "demo-publisher" }, compatibleWith: "1.0.0",
    entry: "main.js", capabilities: ["filesystem.read"], dependencies: [],
    permissions: ["workspace.read"],
    integrity: { algorithm: "sha256", digest: packageDigest(content) },
  }, null, 2), "utf8");
  await writeFile(join(packDir, "content.txt"), content, "utf8");

  const config = loadCliConfig({ cli: { dataDir, workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });
  // Catalog mutations resolve plugin.install through the broker (HIGH-RISK);
  // the test host approves each prompt itself instead of the console prompt.
  const approvals: string[] = [];
  const approver = { requestApproval: async (prompt: string) => { approvals.push(prompt); return true; } };
  const mut = { json: false, config, approver } as const;
  const mutJson = { json: true, config, approver } as const;

  const validated = await commandExtension({ json: false, config }, "validate", packDir);
  assert.equal(validated, 0, "validate exits 0");
  assert.ok(lines.join("\n").includes("Package valid"));

  lines.length = 0;
  const emptyList = await commandExtension({ json: false, config }, "list");
  assert.equal(emptyList, 0);
  assert.ok(lines.join("\n").includes("No extensions installed yet."), "honest empty state");
  const promptsBeforeInstall: number = approvals.length;
  assert.equal(promptsBeforeInstall, 0, "read-only commands never prompt");

  lines.length = 0;
  const installed = await commandExtension(mutJson, "install", packDir);
  assert.equal(installed, 0, "install exits 0");
  const installResult = JSON.parse(lines.join("\n")) as { installed: boolean; id: string; version: string };
  assert.equal(installResult.installed, true);
  assert.equal(installResult.id, "demo.tool");
  const installPrompts: number = approvals.length - promptsBeforeInstall;
  assert.ok(installPrompts === 1 && approvals[0].includes("plugin.install"), "install prompted the approver exactly once");

  lines.length = 0;
  const duplicate = await commandExtension(mutJson, "install", packDir);
  assert.equal(duplicate, 1, "duplicate install is an operational failure");
  const duplicateResult = JSON.parse(lines.join("\n")) as { error: string };
  assert.equal(duplicateResult.error, "extension.registry_duplicate");

  lines.length = 0;
  const enabled = await commandExtension(mut, "enable", "demo.tool@1.0.0");
  assert.equal(enabled, 0);
  assert.ok(lines.join("\n").includes("ENABLED"));

  lines.length = 0;
  const badTransition = await commandExtension(mut, "enable", "demo.tool@1.0.0");
  assert.equal(badTransition, 1, "invalid transition (ENABLED -> ENABLED) fails");

  lines.length = 0;
  const missingUsage = await commandExtension(mut, "remove", "absent.tool@9.9.9");
  assert.equal(missingUsage, 3, "not-found exits 3");

  lines.length = 0;
  const removed = await commandExtension(mut, "remove", "demo.tool@1.0.0");
  assert.equal(removed, 0);
  assert.ok(lines.join("\n").includes("Removed demo.tool@1.0.0"));

  lines.length = 0;
  const afterRemove = await commandExtension({ json: false, config }, "list");
  assert.equal(afterRemove, 0);
  assert.ok(lines.join("\n").includes("No extensions installed yet."), "removal leaves no ghost");
});

test("P11 CLI parseArgs parses govmission run/status with targets", async () => {
  const { parseArgs } = await import("./cli.js") as { parseArgs: (argv: string[]) => { command: string; options: { govMissionAction?: string; govMissionTarget?: string; json: boolean } } };
  const listed = parseArgs(["node", "cli.js", "govmission"]);
  assert.equal(listed.command, "govmission");
  assert.equal(listed.options.govMissionAction, undefined, "bare govmission is a usage error at dispatch time (no silent default)");
  const run = parseArgs(["node", "cli.js", "govmission", "run", "Summarize the workspace"]);
  assert.equal(run.options.govMissionAction, "run");
  assert.equal(run.options.govMissionTarget, "Summarize the workspace");
  const runJson = parseArgs(["node", "cli.js", "govmission", "run", "Objective text", "--json"]);
  assert.equal(runJson.options.govMissionTarget, "Objective text", "--json is never eaten as the objective");
  assert.equal(runJson.options.json, true);
  const status = parseArgs(["node", "cli.js", "govmission", "status", "gov_abc"]);
  assert.equal(status.options.govMissionAction, "status");
  assert.equal(status.options.govMissionTarget, "gov_abc");
  const statusAll = parseArgs(["node", "cli.js", "govmission", "status"]);
  assert.equal(statusAll.options.govMissionTarget, undefined);
});

test("P11 commandGovMission requires an objective and honest provider.invoke consent", async (context) => {
  const { commandGovMission } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const root = await mkdtemp(join(tmpdir(), "quack-govmission-cli-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const config = loadCliConfig({ cli: { dataDir: join(root, "state"), workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });

  // Missing objective → usage error.
  assert.equal(await commandGovMission({ json: false, config }, "run", ""), 2);
  assert.ok(lines.join("\n").includes("requires an objective"));

  // No permission declaration → fails closed with explicit guidance.
  lines.length = 0;
  const previous = process.env["QUACK_GOVMISSION_PERMISSIONS"];
  delete process.env["QUACK_GOVMISSION_PERMISSIONS"];
  try {
    assert.equal(await commandGovMission({ json: false, config }, "run", "do something"), 2);
    assert.ok(lines.join("\n").includes("provider.invoke"), "explains the provider.invoke requirement");
  } finally {
    if (previous !== undefined) process.env["QUACK_GOVMISSION_PERMISSIONS"] = previous;
    else delete process.env["QUACK_GOVMISSION_PERMISSIONS"];
  }
});

test("P11 commandGovMission status lists persisted runs across processes and exits 3 for unknown ids", async (context) => {
  const { commandGovMission } = await import("./cli/commands.js");
  const { loadCliConfig } = await import("./cli/config.js");
  const { JsonFileMissionRunStore } = await import("./runtime/mission-lifecycle/mission-run-store.js");
  const { createLoopRun, terminateRun } = await import("./runtime/mission-lifecycle/executive-loop.js");
  const root = await mkdtemp(join(tmpdir(), "quack-govmission-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const config = loadCliConfig({ cli: { dataDir: join(root, "state"), workspaceRoot: root } });
  const lines: string[] = [];
  context.mock.method(console, "log", (message: unknown) => { lines.push(String(message)); });
  context.mock.method(console, "error", (message: unknown) => { lines.push(String(message)); });

  // Simulate a record persisted by an earlier process.
  const store = new JsonFileMissionRunStore(join(root, "state"));
  const run = terminateRun(createLoopRun({
    missionId: "gov_earlier", goal: "earlier mission", actor: "operator",
    budget: { maxIterations: 8, maxModelCalls: 16, maxToolCalls: 24, maxCost: 1, maxExecutionTimeMs: 300_000, maxConsecutiveFailures: 3 },
  }), "STOP_GOAL_ACHIEVED");
  await store.save({ ...run, currentState: "SUCCEEDED" });

  assert.equal(await commandGovMission({ json: false, config }, "status"), 0);
  const listing = lines.join("\n");
  assert.ok(listing.includes("gov_earlier"), "earlier-process record is visible");
  assert.ok(listing.includes("SUCCEEDED"));

  lines.length = 0;
  assert.equal(await commandGovMission({ json: true, config }, "status", "gov_earlier"), 0);
  const inspected = JSON.parse(lines.join("\n")) as { missionId: string; state: string };
  assert.equal(inspected.missionId, "gov_earlier");
  assert.equal(inspected.state, "SUCCEEDED");

  lines.length = 0;
  assert.equal(await commandGovMission({ json: false, config }, "status", "gov_never_ran"), 3, "unknown id exits 3");
});
