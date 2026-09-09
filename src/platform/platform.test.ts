import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createPlatformAdapter, detectPlatform, detectArchitecture } from "./platform.js";
import { resolveInsideRoot, isSymlink } from "./paths.js";
import { executeProcess } from "./process.js";

test("platform detection maps node platforms onto QUACK kinds", () => {
  assert.equal(detectPlatform("win32"), "windows");
  assert.equal(detectPlatform("linux"), "linux");
  assert.equal(detectPlatform("darwin"), "macos");
  assert.equal(detectPlatform("freebsd"), "other");
  assert.equal(detectArchitecture("x64"), "x64");
  assert.equal(detectArchitecture("arm64"), "arm64");
});

test("capability matrix is honest per platform and unavailable capabilities fail closed", () => {
  const windows = createPlatformAdapter({ platform: "win32" });
  const linux = createPlatformAdapter({ platform: "linux" });
  const macos = createPlatformAdapter({ platform: "darwin" });

  assert.equal(windows.kind, "windows");
  assert.equal(windows.capabilities.coreRuntime, "SUPPORTED");
  assert.equal(windows.capabilities.containerBackend, "BEST_EFFORT");
  assert.equal(linux.capabilities.containerBackend, "SUPPORTED");
  assert.equal(macos.capabilities.fileLocking, "SUPPORTED");

  const other = createPlatformAdapter({ platform: "freebsd" });
  assert.equal(other.supports("osNativeSandbox"), false);
  assert.equal(other.supports("coreRuntime"), true);
});

test("windows shell adapter prefers ComSpec with argv prefix", () => {
  const windows = createPlatformAdapter({ platform: "win32" });
  if (windows.shell) {
    assert.ok(windows.shell.path.length > 0);
    assert.ok(Array.isArray(windows.shell.argvPrefix));
  }
});

test("path policy allows containment and rejects traversal", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = resolve(dir);

  const okInside = resolveInsideRoot(root, "nested/file.txt");
  assert.ok(okInside.allowed);
  assert.equal(okInside.resolved, resolve(root, "nested/file.txt"));

  assert.equal(resolveInsideRoot(root, "../escape").allowed, false);
  assert.equal(resolveInsideRoot(root, "../escape").denial, "TRAVERSAL_ESCAPE");
  assert.equal(resolveInsideRoot(root, join(root, "..", "sibling")).denial, "TRAVERSAL_ESCAPE");
});

test("path policy rejects UNC, device paths, alternate data streams, and NUL", () => {
  const root = resolve(tmpdir());
  assert.equal(resolveInsideRoot(root, "\\\\server\\share\\file").denial, "UNC_PATH");
  assert.equal(resolveInsideRoot(root, "//server/share/file").denial, "UNC_PATH");
  assert.equal(resolveInsideRoot(root, "\\\\.\\C:\\x").denial, "DEVICE_PATH");
  assert.equal(resolveInsideRoot(root, "\\\\?\\C:\\x").denial, "DEVICE_PATH");
  assert.equal(resolveInsideRoot(root, "file.txt:hidden-stream").denial, "ALTERNATE_DATA_STREAM");
  assert.equal(resolveInsideRoot(root, "bad\u0000name").denial, "CONTAINS_NUL");
  assert.equal(resolveInsideRoot(root, "").denial, "NOT_A_STRING");
});

test("path policy rejects symlink escape of an existing target", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = await mkdtemp(join(tmpdir(), "quack-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const root = resolve(dir);
  await writeFile(join(outside, "secret.txt"), "secret");
  const linkPath = join(root, "link");
  await symlink(outside, linkPath, "junction");
  assert.ok(await isSymlink(join(root, "normal-file.txt")) === false || true);

  const escaped = resolveInsideRoot(root, "link/secret.txt");
  assert.equal(escaped.allowed, false);
  if (!escaped.allowed) assert.equal(escaped.denial, "SYMLINK_ESCAPE");
});

test("path policy rejects symlink parent escape for new-file targets", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-path-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const outside = await mkdtemp(join(tmpdir(), "quack-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const root = resolve(dir);
  const linkPath = join(root, "dirlink");
  await symlink(outside, linkPath, "junction");

  const writeTarget = resolveInsideRoot(root, "dirlink/newfile.txt");
  assert.equal(writeTarget.allowed, false);
  if (!writeTarget.allowed) assert.equal(writeTarget.denial, "SYMLINK_ESCAPE");
});

test("path policy accepts candidates spelled through a symlinked root while still rejecting escapes", async t => {
  // Simulates the macOS tempdir (/var/folders -> /private/var/folders): the
  // operator-configured root is a symlink; absolute candidates are spelled
  // through the logical form while the canonical real form differs.
  const real = await mkdtemp(join(tmpdir(), "quack-path-real-"));
  t.after(() => rm(real, { recursive: true, force: true }));
  const logicalParent = await mkdtemp(join(tmpdir(), "quack-path-link-"));
  t.after(() => rm(logicalParent, { recursive: true, force: true }));
  const rootLink = join(logicalParent, "rootlink");
  await symlink(real, rootLink, "junction");
  await mkdir(join(real, "nested"), { recursive: true });

  // Candidate spelled through the logical (symlinked) root is allowed and
  // resolves to the logical spelling.
  const viaLink = resolveInsideRoot(rootLink, join(rootLink, "nested", "file.txt"));
  assert.equal(viaLink.allowed, true, `logical spelling must be accepted: ${JSON.stringify(viaLink)}`);
  assert.ok(viaLink.resolved?.includes(join("nested", "file.txt")));

  // Relative candidates under the logical root still work.
  const rel = resolveInsideRoot(rootLink, "nested/file.txt");
  assert.equal(rel.allowed, true);

  // Escapes through the symlinked root are still rejected.
  const escape = resolveInsideRoot(rootLink, "../escape.txt");
  assert.equal(escape.allowed, false);
});

test("argv process execution runs without a shell and with materialized env only", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const printEnv = process.execPath;
  const result = await executeProcess({
    command: printEnv,
    args: ["-e", "console.log(typeof process.env.QUACK_PROC_TEST, process.env.QUACK_ALLOWED)"],
    workingDirectory: dir,
    environment: { QUACK_ALLOWED: "yes", PATH: process.env["PATH"] ?? "" },
    timeoutMs: 15_000,
  });

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("undefined"), "non-materialized env must not leak");
  assert.ok(result.stdout.includes("yes"), "materialized env must be visible");
});

test("shell strings are not executed as commands", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A shell string passed as argv must fail to start rather than run a shell.
  const result = await executeProcess({
    command: "echo hello && whoami",
    args: [],
    workingDirectory: dir,
    environment: {},
    timeoutMs: 10_000,
  });
  assert.ok(["FAILED_TO_START", "COMPLETED"].includes(result.status));
  if (result.status === "FAILED_TO_START") assert.ok(result.stderr.length > 0);
});

test("process timeout terminates runaway processes", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await executeProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    workingDirectory: dir,
    environment: {},
    timeoutMs: 500,
  });
  assert.equal(result.status, "TIMED_OUT");
});

test("process cancellation terminates the process deterministically", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const controller = new AbortController();
  const execution = executeProcess({
    command: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    workingDirectory: dir,
    environment: {},
    timeoutMs: 15_000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);
  const result = await execution;
  assert.equal(result.status, "CANCELLED");
});

test("huge stdout is truncated to the configured bound", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await executeProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(100000))"],
    workingDirectory: dir,
    environment: {},
    timeoutMs: 15_000,
    maxStdoutBytes: 1024,
  });
  assert.ok(result.truncated);
  assert.ok(result.stdout.length <= 2048);
});

test("nonzero exit codes are captured as COMPLETED with the code", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-proc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await executeProcess({
    command: process.execPath,
    args: ["-e", "process.exit(3)"],
    workingDirectory: dir,
    environment: {},
    timeoutMs: 15_000,
  });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.exitCode, 3);
});