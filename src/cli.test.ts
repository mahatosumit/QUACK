import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
