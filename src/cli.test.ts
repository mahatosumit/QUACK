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
