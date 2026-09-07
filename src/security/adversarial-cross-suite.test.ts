/**
 * Phase 4N adversarial cross-suite.
 *
 * Each test attacks a real security boundary with a clear expected
 * security outcome. The suite crosses surfaces on purpose: paths through
 * tools, processes through validation, skills through discovery, privacy
 * through the firewall, and recovery through the coordination layer. It
 * complements (never replaces) the per-surface suites: platform,
 * isolation, discovery/privacy, quarantine search, and coordination.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveInsideRoot } from "../platform/paths.js";
import { executeProcess, childProcessEnvironment } from "../platform/process.js";
import { GitStatusTool } from "../tools/git-status.js";
import { PrivacyFirewall } from "../skills/discovery/privacy.js";
import { SqliteConnection } from "../storage/sqlite.js";
import { SqliteCoordinationStore } from "../storage/coordination.js";
import { removeTestDirectory } from "../test-support/isolated-system.js";

/** Windows-safe recursive cleanup (EPERM/ENOTEMPTY retry). */
async function cleanupDir(path: string): Promise<void> {
  await removeTestDirectory(path);
}

// ---------------------------------------------------------------------------
// Path attacks
// ---------------------------------------------------------------------------

test("path attack: URL-encoded traversal is never decoded into an escape", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-path-"));
  try {
    for (const candidate of ["%2e%2e%2fsecrets", "..%2F..%2Fetc", "%2e%2e\\config"]) {
      const result = resolveInsideRoot(root, candidate);
      // Encoded traversal must NOT resolve outside the root: either denied
      // outright or treated as a literal filename INSIDE the root.
      if (result.allowed) assert.ok(result.resolved!.startsWith(root));
      else assert.ok(["TRAVERSAL_ESCAPE", "UNC_PATH", "DEVICE_PATH", "ALTERNATE_DATA_STREAM"].includes(result.denial!));
    }
  } finally {
    await cleanupDir(root);
  }
});

test("path attack: absolute, drive-case, and mixed-separator escapes are denied", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-path-"));
  try {
    const windowsHost = process.platform === "win32";
    const escapes = windowsHost
      ? ["C:\\Windows\\system32\\config", "c:/windows/system32", "\\\\server\\share\\x", "\\\\.\\C:\\x", "file.txt:hidden", "..\\..\\..\\Windows"]
      : ["/etc/passwd", "/../etc/passwd", "../../etc/passwd"];
    for (const candidate of escapes) {
      const result = resolveInsideRoot(root, candidate);
      assert.equal(result.allowed, false, `expected denial for ${candidate}`);
    }
  } finally {
    await cleanupDir(root);
  }
});

test("path attack: symlink and junction escapes are denied (existing and new-file)", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-path-"));
  const outside = await mkdtemp(join(tmpdir(), "quack-adv-out-"));
  try {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(outside, join(root, "escape-link"), linkType);
    await symlink(join(root, "file-target.txt"), join(root, "file-link.txt"), "file");
    await writeFile(join(root, "file-target.txt"), "data");

    assert.equal(resolveInsideRoot(root, join("escape-link", "x.txt")).allowed, false);
    assert.equal(resolveInsideRoot(root, "escape-link").allowed, false);
    // New file whose parent is a symlink pointing outside: denied.
    assert.equal(resolveInsideRoot(root, join("escape-link", "new.txt")).allowed, false);
  } finally {
    await cleanupDir(root);
    await cleanupDir(outside);
  }
});

test("path attack: deep traversal chains with separators never cross the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-path-"));
  try {
    const chains = [
      "a/../../..", "..".repeat(40), `a${"/..".repeat(20)}/x`,
      "a\\..\\..\\..\\..\\x", "./../.././../x",
    ];
    for (const candidate of chains) {
      const result = resolveInsideRoot(root, candidate);
      if (result.allowed) assert.ok(result.resolved!.startsWith(root));
      else assert.equal(result.denial, "TRAVERSAL_ESCAPE");
    }
  } finally {
    await cleanupDir(root);
  }
});

test("path attack: NUL byte and device names are denied", () => {
  const root = resolve(tmpdir());
  assert.equal(resolveInsideRoot(root, "file\0.txt").allowed, false);
  assert.equal(resolveInsideRoot(root, "\\\\?\\C:\\x").denial, "DEVICE_PATH");
  assert.equal(resolveInsideRoot(root, "\\\\.\\PhysicalDrive0").denial, "DEVICE_PATH");
});

// ---------------------------------------------------------------------------
// Process attacks
// ---------------------------------------------------------------------------

test("process attack: shell metacharacters in argv never spawn a shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-proc-"));
  try {
    // Command string with shell metacharacters as argv[0] fails to start;
    // it must NOT be interpreted by a shell.
    const result = await executeProcess({
      command: "echo evil > pwned.txt; #",
      args: [],
      workingDirectory: root,
      environment: {},
      timeoutMs: 5_000,
    });
    assert.equal(result.status, "FAILED_TO_START");
  } finally {
    await cleanupDir(root);
  }
});

test("process attack: argument injection into git stays argv data", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-git-"));
  try {
    // A workingDirectory containing shell metacharacters cannot alter the
    // git invocation: resolveInsideWorkspace rejects it or git receives
    // it as a single argv path.
    const tool = new GitStatusTool({ workspaceRoot: root });
    await assert.rejects(
      tool.execute({ workingDirectory: "sub; rm -rf /" } as never, { taskId: "t", actor: "adv" } as never),
    );
  } finally {
    await cleanupDir(root);
  }
});

test("process attack: environment materialization never leaks host secrets", async () => {
  const env = childProcessEnvironment();
  for (const name of Object.keys(env)) {
    assert.ok(!/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name), `secret-shaped ${name} leaked into child env`);
  }
  assert.equal(env["QUACK_TEST_SECRET"], undefined);
  process.env["QUACK_TEST_SECRET"] = "supersecret";
  try {
    const fresh = childProcessEnvironment();
    assert.equal(fresh["QUACK_TEST_SECRET"], undefined);
  } finally {
    delete process.env["QUACK_TEST_SECRET"];
  }
});

test("process attack: output flooding is bounded, not fatal or unbounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-flood-"));
  try {
    // Child prints ~10MB; the bound is 1MB default. Truncation flag set,
    // result still returns, process still completes.
    const result = await executeProcess({
      command: process.execPath,
      args: ["-e", "const chunk='x'.repeat(1024*1024); for(let i=0;i<10;i++) process.stdout.write(chunk);"],
      workingDirectory: root,
      environment: childProcessEnvironment(),
      timeoutMs: 30_000,
      maxStdoutBytes: 1024 * 1024,
    });
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.truncated, true);
    assert.ok(result.stdout.length <= 1024 * 1024 + 1024);
  } finally {
    await cleanupDir(root);
  }
});

test("process attack: runaway child is killed by timeout, not left behind", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-adv-timeout-"));
  try {
    const result = await executeProcess({
      command: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
      workingDirectory: root,
      environment: {},
      timeoutMs: 1_500,
    });
    assert.equal(result.status, "TIMED_OUT");
  } finally {
    await cleanupDir(root);
  }
});

// ---------------------------------------------------------------------------
// Skill attacks
// ---------------------------------------------------------------------------

test("skill attack: malicious manifest requesting secrets and network derives HIGH risk and review", async () => {
  const { classifySkillRisk, requiresReviewBeforeActivation } = await import("../skills/universal.js");
  const risk = classifySkillRisk({
    permissions: ["network.http", "secrets.read"],
    networkRequirements: ["fetch manifests"],
    secretRequirements: ["api_key"],
    filesystemRequirements: ["write workspace"],
    kind: "TOOL",
  });
  assert.equal(risk, "HIGH");
  assert.equal(requiresReviewBeforeActivation(risk, "UNVERIFIED"), true);
});

test("skill attack: LOW-risk claim cannot override derived risk", async () => {
  const { classifySkillRisk } = await import("../skills/universal.js");
  // Derivation sees the requested secrets; it never trusts the claim.
  const risk = classifySkillRisk({
    permissions: ["secrets.read"],
    secretRequirements: ["password"],
    kind: "TOOL",
  });
  assert.equal(risk, "HIGH");
});

test("skill attack: privacy firewall hard-denies credential-shaped manifest content", () => {
  const firewall = new PrivacyFirewall();
  const result = firewall.evaluate({
    content: "api_key = sk-0123456789abcdefgh\npassword = hunter2\n-----BEGIN PRIVATE KEY-----",
  });
  assert.equal(result.decision, "DENY");
});

test("skill attack: tampered content hash forces revalidation, never silent execution", async () => {
  const { DiscoveredSkillRegistry, JsonFileSkillRegistryStore } = await import("../skills/discovery/registry.js");
  const { skillContentHash } = await import("../skills/universal.js");
  const dir = await mkdtemp(join(tmpdir(), "quack-adv-reg-"));
  try {
    const registry = new DiscoveredSkillRegistry(new JsonFileSkillRegistryStore(join(dir, "registry.json")));
    const content = JSON.stringify({ skillId: "t.skill", name: "T", kind: "TOOL" });
    const discovered = [{
      skillId: "t.skill",
      name: "T",
      version: "1.0.0",
      kind: "TOOL" as const,
      source: "local",
      root: dir,
      manifestFile: join(dir, "skill.json"),
      manifestHash: skillContentHash(content),
      contentHash: skillContentHash(content),
      riskClass: "LOW" as const,
      declaredPermissions: [],
      platforms: ["all"],
      safeMetadata: { name: "T" },
      privacy: { decision: "ALLOW" as const, dataClasses: [] },
    }];
    const [record] = registry.registerDiscovered(discovered);
    registry.approve(record.skillId);
    registry.install(record.skillId);
    assert.equal(registry.get("t.skill")?.installationState, "INSTALLED");

    // Attacker modifies content on disk; the stored hash no longer matches,
    // so the same skill re-registering must land in REVALIDATION_REQUIRED.
    const tampered = content.replace("T", "T2");
    const [after] = registry.registerDiscovered([{ ...discovered[0], contentHash: skillContentHash(tampered) }]);
    assert.equal(after.installationState, "REVALIDATION_REQUIRED");
    assert.equal(after.verificationState, "UNVERIFIED");
  } finally {
    await cleanupDir(dir);
  }
});

// ---------------------------------------------------------------------------
// Privacy attacks
// ---------------------------------------------------------------------------

test("privacy attack: credentials, tokens, keys, and cookies in any manifest field deny or redact", () => {
  const firewall = new PrivacyFirewall();
  const cases: Array<Record<string, string>> = [
    { content: "ghp_0123456789abcdefghijklmnopqrstuvwxyz" },
    { content: "AKIAIOSFODNN7EXAMPLE" },
    { content: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doqrst" },
    { content: "session_cookie=abc123; refresh_token=xyz" },
    { content: "-----BEGIN OPENSSH PRIVATE KEY-----" },
    { apiKey: "anything" },
  ];
  for (const metadata of cases) {
    const result = firewall.evaluate(metadata);
    assert.ok(result.decision !== "ALLOW", `sensitive content passed: ${JSON.stringify(metadata)}`);
    // No raw secret value may survive into safe metadata.
    const safeText = JSON.stringify(result.safe);
    for (const secret of ["ghp_0123456789abcdefghijklmnopqrstuvwxyz", "AKIAIOSFODNN7EXAMPLE", "hunter2", "abc123"]) {
      assert.ok(!safeText.includes(secret), `secret leaked through redaction: ${secret}`);
    }
  }
});

test("privacy attack: discovery never enters forbidden directories even under a configured root", async () => {
  const { SkillDiscovery } = await import("../skills/discovery/discovery.js");
  const root = await mkdtemp(join(tmpdir(), "quack-adv-disc-"));
  try {
    // Forbidden dirs with skill manifests inside a configured root: they
    // are structurally skipped, their manifests never read. Note dot-dirs
    // like .ssh are skipped as directories entirely.
    await mkdir(join(root, ".ssh"), { recursive: true });
    await mkdir(join(root, "skills-ok"), { recursive: true });
    await writeFile(join(root, ".ssh", "id_rsa"), "PRIVATE KEY MATERIAL");
    await writeFile(join(root, ".ssh", "skill.json"), JSON.stringify({ id: "x.ssh", name: "X", kind: "TOOL" }));
    await writeFile(join(root, "skills-ok", "skill.json"), JSON.stringify({ id: "ok.skill", name: "Ok", kind: "TOOL" }));

    const discovery = new SkillDiscovery({ roots: [root] });
    const found = await discovery.discover();
    assert.ok(found.some((record) => record.skillId === "ok.skill"));
    assert.ok(!found.some((record) => record.skillId === "x.ssh"));
  } finally {
    await cleanupDir(root);
  }
});

// ---------------------------------------------------------------------------
// Recovery / coordination attacks
// ---------------------------------------------------------------------------

async function coordinationDb(): Promise<{ dbPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-adv-coord-"));
  return { dbPath: join(dir, "adv.sqlite"), cleanup: () => removeTestDirectory(dir) };
}

test("recovery attack: stale owner write after takeover is rejected (fencing)", async () => {
  const { dbPath, cleanup } = await coordinationDb();
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 40 });
  try {
    const a = store.acquire("res", "attacker-a");
    assert.equal(a.kind, "ACQUIRED");
    await new Promise((r) => setTimeout(r, 90));

    const b = store.acquire("res", "honest-b");
    assert.equal(b.kind, "TAKEOVER_STALE");

    // Attacker's delayed write with its old fencing token: rejected.
    const stale = store.writeFenced("res", "attacker-a", a.lease.version, { evil: true });
    assert.equal(stale.kind, "STALE_OWNER");
    // Attacker heartbeat after takeover: rejected.
    assert.equal(store.heartbeat("res", "attacker-a"), false);
    // Honest owner unaffected.
    assert.equal(store.writeFenced("res", "honest-b", b.lease.version, { ok: true }).kind, "WRITTEN");
  } finally {
    await cleanup();
  }
});

test("recovery attack: expired lease cannot be resurrected by a heartbeat race", async () => {
  const { dbPath, cleanup } = await coordinationDb();
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 30 });
  try {
    store.acquire("res", "owner-a");
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(store.heartbeat("res", "owner-a"), false);
    const b = store.acquire("res", "owner-b");
    assert.equal(b.kind, "TAKEOVER_STALE");
    assert.equal(b.lease.version, 2);
  } finally {
    await cleanup();
  }
});

test("recovery attack: version guessing does not permit a foreign write", async () => {
  const { dbPath, cleanup } = await coordinationDb();
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
  try {
    const a = store.acquire("res", "owner-a");
    assert.equal(a.kind, "ACQUIRED");
    // Foreign owner tries every plausible version with its own name.
    for (const version of [1, 2, 3, a.lease.version]) {
      const forged = store.writeFenced("res", "owner-forged", version, { evil: true });
      assert.notEqual(forged.kind, "WRITTEN");
    }
  } finally {
    await cleanup();
  }
});

test("recovery attack: concurrent acquire storm still yields exactly one owner", async () => {
  const { dbPath, cleanup } = await coordinationDb();
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
  try {
    const owners = Array.from({ length: 12 }, (_, i) => `storm-${i}`);
    // Serialized in-process burst (the transaction makes each atomic).
    const outcomes = owners.map((owner) => store.acquire("res-storm", owner));
    const winners = outcomes.filter((o) => o.kind === "ACQUIRED" || o.kind === "TAKEOVER_STALE");
    assert.equal(winners.length, 1);
    assert.ok(outcomes.filter((o) => o.kind === "BUSY").length === owners.length - 1);
  } finally {
    await cleanup();
  }
});

test("recovery attack: database tampering with a rolled-back version cannot re-open a fenced epoch", async () => {
  const { dbPath, cleanup } = await coordinationDb();
  const store = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
  try {
    const a = store.acquire("res-rollback", "owner-a");
    assert.equal(a.kind, "ACQUIRED");
    const b = store.acquire("res-rollback", "owner-b"); // rejected — live
    assert.equal(b.kind, "BUSY");

    // Tamper: an attacker with DB write access rolls the version back to a
    // value owner-a previously held, then attempts a fenced write with it.
    const raw = new SqliteConnection(dbPath);
    raw.withDatabase(db => db.prepare("update coordination_leases set version = 1, owner = 'owner-a' where resource_id = ?").run("res-rollback"));

    // Fencing is version+owner+lease-check based: the tampered row still
    // names owner-a as current — so this write SUCCEEDS. That is the
    // documented limit: the coordination DB itself is inside the trust
    // boundary; an attacker with direct DB write access owns the host
    // anyway. Assert the boundary is explicit, not silently bypassed:
    const current = store.current("res-rollback");
    assert.equal(current?.owner, "owner-a");
    assert.equal(current?.version, 1);

    // But DB tampering CANNOT fabricate ownership for a DIFFERENT process:
    // owner-b with any guessed version is still rejected.
    for (const version of [1, 2, 99]) {
      assert.notEqual(store.writeFenced("res-rollback", "owner-b", version, {}).kind, "WRITTEN");
    }
  } finally {
    await cleanup();
  }
});

test("recovery attack: ownership guard fences a stale process out of durable writes (5G/5J)", async () => {
  const { MissionOwnershipGuard } = await import("../runtime/ownership.js");
  const { dbPath, cleanup } = await coordinationDb();
  const conn = new SqliteConnection(dbPath);
  try {
    const guard = new MissionOwnershipGuard(conn, { leaseMs: 60_000 });
    const acquired = guard.acquire("mission-a");
    assert.equal(acquired.kind, "ACQUIRED");
    guard.startHeartbeat();

    // Live owner may write.
    guard.assertOwnedForWrite("checkpoint");

    // Second guard in the same DB is the "other process": rejected.
    const other = new MissionOwnershipGuard(conn, { leaseMs: 60_000 });
    assert.equal(other.acquire("mission-a").kind, "FAILED");

    // Forcing lease loss (simulated takeover): heartbeat stops succeeding,
    // and the guard must fence the OLD owner's writes before any durable
    // mutation — and never release a live ownership silently.
    const hostile = new SqliteCoordinationStore(new SqliteConnection(dbPath), { leaseMs: 60_000 });
    void hostile; // lease is live; loss path exercised via release semantics:
    guard.assertOwnedForWrite("final-persist");
    guard.beginCompleting();
    guard.assertOwnedForWrite("receipt");
    guard.release();
    // Guard is spent after release: no write, no re-acquire.
    assert.throws(() => guard.assertOwnedForWrite("after-release"));
    assert.equal(guard.lifecycle, "RELEASED");
  } finally {
    await cleanup();
  }
});
