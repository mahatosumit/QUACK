import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { removeTestDirectory } from "../test-support/isolated-system.js";

function cwdCommand(): string {
  return `"${process.execPath}" -e "console.log(process.cwd())"`;
}

/** Node's child cwd resolves symlinks (macOS /var -> /private/var); compare canonical forms. */
function canonical(path: string): string {
  try { return realpathSync(path); } catch { return path; }
}

test("terminal - runs in the configured workspace, not the process cwd", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  await mkdir(workspaceRoot, { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      { command: cwdCommand() },
      { taskId: "terminal-test", actor: "test" },
    );

    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(canonical((result.data.stdout as string).trim()), canonical(workspaceRoot));
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});

test("terminal - a relative workingDirectory stays inside the workspace", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  await mkdir(join(workspaceRoot, "sub"), { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      { command: cwdCommand(), workingDirectory: "sub" },
      { taskId: "terminal-test", actor: "test" },
    );

    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(canonical((result.data.stdout as string).trim()), canonical(join(workspaceRoot, "sub")));
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});

test("terminal - accepts an absolute workingDirectory inside the workspace", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  const subdir = join(workspaceRoot, "sub");
  await mkdir(subdir, { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      { command: cwdCommand(), workingDirectory: subdir },
      { taskId: "terminal-test", actor: "test" },
    );

    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(canonical((result.data.stdout as string).trim()), canonical(subdir));
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});

test("terminal - rejects workingDirectory paths outside the workspace", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  await mkdir(workspaceRoot, { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      { command: cwdCommand(), workingDirectory: ".." },
      { taskId: "terminal-test", actor: "test" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "tool.execution_failed");
    assert.match(result.error.message, /outside the workspace root/);
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});

test("terminal - rejects missing command before execution", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  await mkdir(workspaceRoot, { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      {},
      { taskId: "terminal-test", actor: "test" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "tool.invalid_input");
    assert.match(result.error.message, /non-empty string input.command/);
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});

test("terminal - rejects malformed input before execution", async () => {
  const workspaceRoot = join(tmpdir(), createId("quack_term_workspace"));
  const dataDir = join(tmpdir(), createId("quack_term_state"));
  await mkdir(workspaceRoot, { recursive: true });
  let system: QuackSystem | undefined;

  try {
    system = await createQuackSystem({
      workspaceRoot,
      dataDir,
      permissions: ["terminal.execute"],
      approver: { requestApproval: async () => true },
    });
    const result = await system.runtime.executeTool(
      "core.terminal.execute",
      { command: 42 } as never,
      { taskId: "terminal-test", actor: "test" },
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "tool.invalid_input");
  } finally {
    await system?.events.drain();
    await removeTestDirectory(workspaceRoot);
    await removeTestDirectory(dataDir);
  }
});
