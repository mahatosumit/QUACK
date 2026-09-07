import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { GitStatusTool } from "./git-status.js";

const context = { taskId: "t", actor: "tester" };

function createTempWorkspace(): { root: string; cleanup: () => void } {
  const root = join(tmpdir(), `quack-git-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("GitStatusTool validates input shape", () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const tool = new GitStatusTool({ workspaceRoot: root });
    assert.ok(tool.validateInput({}).ok);
    const bad = tool.validateInput({ workingDirectory: 42 });
    assert.ok(!bad.ok);
  } finally {
    cleanup();
  }
});

test("GitStatusTool reports branch, clean status from argv git", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const { execFileSync } = await import("node:child_process");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(join(root, "a.txt"), "a");
    git("add", "a.txt");
    git("commit", "-q", "-m", "init");

    const tool = new GitStatusTool({ workspaceRoot: root });
    const result = await tool.execute({}, context);
    assert.ok(["master", "main"].includes(result.output.branch));
    assert.equal(result.output.clean, true);
    assert.equal(result.output.raw, "");
    assert.equal(result.output.aheadBehind, undefined);

    // Dirty the tree: untracked files surface.
    writeFileSync(join(root, "b.txt"), "b");
    const dirty = await tool.execute({}, context);
    assert.equal(dirty.output.clean, false);
    assert.ok(dirty.output.untracked.includes("b.txt"));
  } finally {
    cleanup();
  }
});

test("GitStatusTool argv execution fails closed outside a git repo", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const tool = new GitStatusTool({ workspaceRoot: root });
    await assert.rejects(tool.execute({}, context));
  } finally {
    cleanup();
  }
});

test("GitStatusTool rejects traversal workingDirectory", async () => {
  const { root, cleanup } = createTempWorkspace();
  try {
    const tool = new GitStatusTool({ workspaceRoot: root });
    await assert.rejects(tool.execute({ workingDirectory: ".." }, context));
  } finally {
    cleanup();
  }
});
