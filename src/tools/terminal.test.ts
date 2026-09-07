import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalTool } from "./terminal.js";

test("terminal tool never leaks secret-shaped environment variables to children", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-terminal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.QUACK_TEST_SECRET_TOKEN = "super-secret-value";
  process.env.QUACK_TEST_API_KEY = "api-key-value";
  try {
    await writeFile(join(dir, "probe.js"), "console.log(typeof process.env.QUACK_TEST_SECRET_TOKEN, typeof process.env.QUACK_TEST_API_KEY);");
    const tool = new TerminalTool({ workspaceRoot: dir });
    const result = await tool.execute({
      command: `"${process.execPath}" probe.js`,
      workingDirectory: ".",
    }, { taskId: "task-1", actor: "tester" });

    assert.equal(result.output.exitCode, 0, JSON.stringify(result.output.stderr));
    assert.ok(result.output.stdout.includes("undefined"), `secrets must be removed, got: ${result.output.stdout}`);
  } finally {
    delete process.env.QUACK_TEST_SECRET_TOKEN;
    delete process.env.QUACK_TEST_API_KEY;
  }
});

test("terminal tool blocks dangerous commands before execution", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-terminal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const tool = new TerminalTool({ workspaceRoot: dir });
  await assert.rejects(tool.execute({ command: "rm -rf /" }, { taskId: "task-1", actor: "tester" }), /blocked for safety/);
  await assert.rejects(tool.execute({ command: "dd if=/dev/zero of=/dev/sda" }, { taskId: "task-1", actor: "tester" }), /blocked for safety/);
});

test("terminal tool keeps non-secret environment usable by children", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-terminal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "probe-path.js"), "console.log(typeof process.env.PATH);");
  const tool = new TerminalTool({ workspaceRoot: dir });
  const result = await tool.execute({
    command: `"${process.execPath}" probe-path.js`,
    workingDirectory: ".",
  }, { taskId: "task-1", actor: "tester" });
  assert.equal(result.output.exitCode, 0, JSON.stringify(result.output.stderr));
  assert.ok(result.output.stdout.includes("string"), "PATH must remain available for normal tooling");
});