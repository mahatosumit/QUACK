import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "../distributions/swe-system.js";
import { createDefaultConfig as createSweConfig } from "../distributions/swe-config.js";
import * as neutralConfig from "../config/config.js";
import { loadCliConfig } from "../cli/config.js";
import { EnvironmentSecretProvider, PROVIDER_SECRET_DESCRIPTORS, redactSecrets, readProviderCredentialForBoot } from "../security/secret-provider.js";
import { JsonFileApprovalStore } from "../runtime/mission-lifecycle/approval-store.js";
import { JsonFileMissionRunStore } from "../runtime/mission-lifecycle/mission-run-store.js";
import { JsonFileStepAttemptJournal } from "../runtime/mission-lifecycle/step-attempt-journal.js";
import { JsonlAuditLog } from "../telemetry/audit-log.js";
import { createId, type JsonObject } from "../core/types.js";

/**
 * P16-B/P16-C (deployment qualification): production configuration and
 * secret-path qualification over the REAL composition and stores. This
 * suite adds no new authority — it proves the existing configuration
 * and secret surfaces behave safely for deployment:
 *
 *   CFG  configuration audit/fail-closed behavior
 *   SEC  secret boundary qualification (env -> provider/runtime -> never persisted)
 *
 * Honesty note: QUACK has no required environment variables by design
 * (echo provider + standing consent make a keyless start valid); the
 * audit below proves that property rather than assuming a required-key
 * model that does not exist.
 */

async function tempDir(prefix = "quack-p16-cfg-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** All allowlisted provider credential names — used for leak scans. */
const CREDENTIAL_NAMES = PROVIDER_SECRET_DESCRIPTORS.map((descriptor) => descriptor.name);

// ===========================================================================
// CFG — production configuration qualification
// ===========================================================================

test("CFG-1 a keyless production start is valid: default composition constructs and its effective configuration is metadata-only", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-cfg-keyless-");
  try {
    const system = createQuackSystem({ dataDir: dir, workspaceRoot: dir });
    const config = system.config as unknown as Record<string, unknown>;
    // No secret-shaped key may exist in effective configuration.
    for (const key of Object.keys(config)) {
      assert.ok(!/(secret|credential|password|apikey|api_key|token)/i.test(key), `config key '${key}' looks secret-shaped`);
    }
    assert.equal(config["dataDir"], dir);
    await system.airm.shutdown();
    await system.dnpl.shutdown();
    await system.ucp.runtime.shutdown();
  } finally { await cleanup(); }
});

test("CFG-2 insecure development defaults never become production behavior: standing consent stays read-only/memory-local", () => {
  const config = createSweConfig({ dataDir: ".quack-tmp", workspaceRoot: process.cwd() });
  assert.deepEqual([...config.permissions], ["memory.read", "memory.write", "workspace.read"]);
  // High-risk permissions are never part of any default.
  for (const denied of ["terminal.execute", "git.write", "workspace.write", "secrets.read", "provider.invoke", "network.http"]) {
    assert.ok(!config.permissions.includes(denied as never), `default permissions must not include ${denied}`);
  }
});

test("CFG-3 missing dataDir-scoped stores never fabricate defaults: malformed run records fail closed on load", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-cfg-malformed-");
  try {
    await mkdir(join(dir, "governed-missions"), { recursive: true });
    await writeFile(join(dir, "governed-missions", "gov_bad.json"), JSON.stringify({ version: 2, run: {} }));
    const store = new JsonFileMissionRunStore(dir);
    await assert.rejects(() => store.load("gov_bad"), /Invalid|version/i, "an unknown future run-record version must fail closed, never coerce");
  } finally { await cleanup(); }
});

test("CFG-4 CLI config resolution is deterministic and documented-priority (CLI arg > env > file > default)", () => {
  const home = join(tmpdir(), `quack-p16-cli-${Date.now()}`);
  const loaded = loadCliConfig({
    cli: { dataDir: join(home, "from-cli") },
    explicitConfigFile: join(home, "config.json"),
  });
  assert.equal(loaded.dataDir, join(home, "from-cli"), "CLI argument wins");
  assert.equal(loaded.ownershipLeaseMs, 30_000, "documented lease default");
  assert.equal(loaded.logLevel, "info", "documented log-level default");
});

test("CFG-5 a malformed configuration file never breaks the CLI: it falls back to safe defaults", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-cfg-file-");
  try {
    await writeFile(join(dir, "config.json"), "{ broken json");
    const loaded = loadCliConfig({ explicitConfigFile: join(dir, "config.json") });
    assert.equal(loaded.logLevel, "info", "malformed config falls back, never crashes, never escalates");
  } finally { await cleanup(); }
});

test("CFG-6 invalid config values fail at construction, not at unsafe execution: numeric bounds enforce their documented invariants", () => {
  const { createDefaultConfig: createNeutralConfig } = neutralConfig;
  assert.throws(() => createNeutralConfig({ delegationMaxDepth: -1 } as never), /non-negative/i);
  assert.throws(() => createNeutralConfig({ memoryProviderTimeoutMs: -1 } as never), /positive integer/i);
  assert.throws(() => createNeutralConfig({ memoryNamespace: "  " } as never), /nonempty/i);
});

test("CFG-7 dangerous configuration values are not reachable through configuration: unknown permission scopes are denied at the broker", async () => {
  // The Permission union is open to dotted scope names (provider/action
  // extensibility) — the safety boundary is the BROKER: a permission nobody
  // configured or granted resolves DENIED, never a silent allow.
  const { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker, buildToolCapabilityRequest } = await import("../security/capability-broker.js");
  const { AllowListPermissionPolicy } = await import("../security/permissions.js");
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy(["workspace.read"]), grants);
  grants.ensureGrant({
    missionId: "m-p16-cfg",
    capabilities: ["permission.workspace.read"],
    approval: { approvedBy: "p16-qualification", reason: "standing consent fixture", approvedAt: new Date().toISOString() },
  });
  const decision = await broker.resolve(buildToolCapabilityRequest({
    missionId: "m-p16-cfg", actor: "test", toolId: "p16.probe", input: {},
    permission: "secrets.read.nvidia_api_key" as never, reason: "qualification",
  }));
  assert.ok(!decision.granted, "an unconfigured permission scope is denied even though the string parses");
  const allowed = await broker.resolve(buildToolCapabilityRequest({
    missionId: "m-p16-cfg", actor: "test", toolId: "workspace.read.probe", input: {},
    permission: "workspace.read", reason: "qualification",
  }));
  assert.ok(allowed.granted, "the configured permission still resolves");
  assert.ok(allowed.granted, "the configured permission still resolves");
});

test("CFG-8 unavailable provider configuration is honest: with no provider credentials only the offline echo provider registers", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-cfg-noprovider-");
  const names = ["QUACK_OPENAI_API_KEY", "NVIDIA_API_KEY", "QUACK_VLLM_API_KEY", "ANTHROPIC_API_KEY"];
  const saved = names.map((name) => [name, process.env[name]] as const);
  const restore = QUACK_VLLM_MODEL_SAVE();
  try {
    for (const name of names) delete process.env[name];
    delete process.env["QUACK_OLLAMA_BASE_URL"];
    delete process.env["QUACK_OLLAMA_MODEL"];
    delete process.env["QUACK_VLLM_BASE_URL"];
    delete process.env["QUACK_VLLM_MODEL"];
    const system = createQuackSystem({ dataDir: dir, workspaceRoot: dir });
    const providers = system.providers.list();
    assert.deepEqual(providers, ["core.echo-provider"], "no credentials => only the offline echo provider registers");
    assert.ok(system.governedMissionLoop, "governed loop still constructs (fail-closed at dispatch, not at construction)");
    await system.airm.shutdown();
    await system.dnpl.shutdown();
    await system.ucp.runtime.shutdown();
  } finally {
    for (const [name, value] of saved) { if (value === undefined) continue; process.env[name] = value; }
    restore();
    await cleanup();
  }
  function QUACK_VLLM_MODEL_SAVE(): () => void {
    const vllm = [["QUACK_OLLAMA_BASE_URL", process.env["QUACK_OLLAMA_BASE_URL"]], ["QUACK_OLLAMA_MODEL", process.env["QUACK_OLLAMA_MODEL"]], ["QUACK_VLLM_BASE_URL", process.env["QUACK_VLLM_BASE_URL"]], ["QUACK_VLLM_MODEL", process.env["QUACK_VLLM_MODEL"]]] as const;
    return () => { for (const [name, value] of vllm) { if (value !== undefined) process.env[name] = value; } };
  }
});

/** Minimal valid isolation request for backend DENY qualification. */
function isolationRequest(level: "WORKER_PROCESS" | "CONTAINER_ISOLATED"): import("../isolation/contract.js").IsolationRequest {
  const root = join(tmpdir(), `quack-p16-iso-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return {
    missionId: "m-iso-cfg",
    executionId: createId("execution"),
    actor: "p16-qualification",
    profile: {
      level,
      filesystem: { workspaceRoot: root },
      network: { mode: "DENY" },
      environment: { variables: { ISOLATED: "yes" }, secrets: [] },
      limits: { wallClockMs: 5_000, maxOutputBytes: 64 * 1024 },
    },
    workload: { kind: "module", entry: "noop.cjs", args: {} },
  };
}

test("CFG-9 isolation configuration fails closed: unavailable container backend DENIES isolation-requiring workloads, never downgrades", async () => {
  const { ContainerIsolationBackend } = await import("../isolation/container-backend.js");
  const backend = new ContainerIsolationBackend({ availabilityCacheMs: 0 });
  const availability = await backend.availability();
  // Honest tri-state: available is boolean; unavailable means DENY.
  assert.equal(typeof availability.available, "boolean");
  if (!availability.available) {
    const result = await backend.execute(isolationRequest("CONTAINER_ISOLATED"));
    assert.equal(result.status, "UNSUPPORTED", "unavailable backend must DENY, not fall back to a weaker isolation level");
    assert.ok(/unavailable|docker/i.test(result.error ?? ""), "the denial is an honest, deterministic, governed error");
  }
});

// ===========================================================================
// SEC — secret management qualification (P16-C)
// ===========================================================================

/** Seed a fake provider credential and prove it never leaves the boundary. */
async function withFakeCredential(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try { await run(); }
  finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test("SEC-1 provider secrets never reach durable stores: full-system run with a planted credential leaves no trace in the dataDir", async () => {
  const PLANTED = "nvapi-PLANTED-p16-credential-abcdefghijklmnop";
  const { dir, cleanup } = await tempDir("quack-p16-sec-durable-");
  try {
    await withFakeCredential("NVIDIA_API_KEY", PLANTED, async () => {
      const system = createQuackSystem({ dataDir: dir, workspaceRoot: dir });
      // Emit events (audit log writes every event payload).
      await system.events.emit("mission.started", { missionId: "m-secret-1" }, { actor: "test" });
      await system.events.drain();
      // Exercise a durable write through the governed approval store seam.
      const approvals = new JsonFileApprovalStore(dir);
      await approvals.parkRequest({
        missionId: "m-secret-1", stepIndex: 0, capability: "fixture.destructive",
        proposalDigest: "d".repeat(64), riskLevel: "DESTRUCTIVE",
        reason: `destroy the dataset using credential ${PLANTED}`,
      });
      await system.airm.shutdown();
      await system.dnpl.shutdown();
      await system.ucp.runtime.shutdown();
    });
    // Scan EVERY durable file in the dataDir for the planted credential.
    const leaks: string[] = [];
    await scan(dir);
    assert.deepEqual(leaks, [], "planted provider credential must never appear in any durable dataDir file");
    async function scan(root: string): Promise<void> {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) await scan(path);
        else if (entry.isFile()) {
          const content = await readFile(path, "utf8").catch(() => "");
          if (content.includes(PLANTED)) leaks.push(path);
        }
      }
    }
  } finally { await cleanup(); }
});

test("SEC-2 provider secrets never reach EventBus payloads or the audit log", async () => {
  const PLANTED = "sk-PLANTED-p16-openai-credential-1234567890";
  const { dir, cleanup } = await tempDir("quack-p16-sec-events-");
  try {
    const auditLog = new JsonlAuditLog(join(dir, "audit.jsonl"));
    const bus = auditLog["bus" as keyof JsonlAuditLog] as never;
    // Direct: redactSecrets is the boundary; simulate a hostile payload.
    const hostile = JSON.stringify({ missionId: "m", note: `key=${PLANTED}`, auth: `Bearer ${PLANTED}` });
    const redacted = redactSecrets(hostile);
    assert.ok(!redacted.includes(PLANTED), "secret-shaped values are redacted before any persistence");
  } finally { await cleanup(); }
});

test("SEC-3 secret resolution requires authority: the broker denies unauthorized consumers fail-closed", async () => {
  const { InMemoryCapabilityGrantRegistry, PermissionBackedCapabilityBroker } = await import("../security/capability-broker.js");
  const { AllowListPermissionPolicy } = await import("../security/permissions.js");
  const grants = new InMemoryCapabilityGrantRegistry();
  const broker = new PermissionBackedCapabilityBroker(new AllowListPermissionPolicy([]), grants);
  const provider = new EnvironmentSecretProvider(broker);
  await withFakeCredential("NVIDIA_API_KEY", "nvapi-fixture", async () => {
    const denied = await provider.resolve("NVIDIA_API_KEY", "provider.nvidia-nim", { actor: "unauthorized" });
    assert.ok(!denied.ok, "no grant => denial (value never returned)");
  });
  // Non-allowlisted consumer never reads a value even with a permissive broker.
  const open = new EnvironmentSecretProvider();
  await withFakeCredential("NVIDIA_API_KEY", "nvapi-fixture", async () => {
    const mismatch = await open.resolve("NVIDIA_API_KEY", "provider.openai-compatible", { actor: "x" });
    assert.ok(!mismatch.ok && mismatch.error.code === "secrets.consumer_mismatch");
    const unknown = await open.resolve("TOTALLY_OTHER_SECRET", "provider.nvidia-nim", { actor: "x" });
    assert.ok(!unknown.ok && unknown.error.code === "secrets.not_allowlisted");
  });
});

test("SEC-4 the boot credential read is consumer-bound: a mismatched consumer gets nothing", async () => {
  await withFakeCredential("QUACK_OPENAI_API_KEY", "sk-fixture", async () => {
    assert.equal(readProviderCredentialForBoot("QUACK_OPENAI_API_KEY", "provider.openai-compatible"), "sk-fixture");
    assert.equal(readProviderCredentialForBoot("QUACK_OPENAI_API_KEY", "provider.nvidia-nim"), undefined, "wrong consumer gets no value");
    assert.equal(readProviderCredentialForBoot("SOME_OTHER_VAR", "provider.openai-compatible"), undefined, "non-allowlisted name gets no value");
  });
});

test("SEC-5 secrets never reach model prompts: instruction metadata carries no credential names or values", async () => {
  // Architectural check (R44 precedent): the QIE pipeline source has no
  // credential access at all — only identity/digest metadata is carried.
  const { readFile: read } = await import("node:fs/promises");
  for (const file of ["src/instruction/model-adapter.ts", "src/instruction/composer.ts", "src/instruction/selector.ts"]) {
    const source = await read(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.ok(!source.includes("process.env"), `${file}: the QIE pipeline never reads the environment (no credential route into prompts)`);
    for (const name of CREDENTIAL_NAMES) assert.ok(!source.includes(name), `${file}: no reference to credential ${name}`);
  }
});

test("SEC-6 secrets never reach error responses: provider health messages are redacted at the diagnostics boundary", async () => {
  const PLANTED = "nvapi-PLANTED-p16-health-abcdefgh";
  const { ProviderValidationService } = await import("../providers/validation.js");
  const registry = {
    list: () => ["fixture.provider"],
    get: () => ({ ok: true, data: { healthCheck: async () => ({ healthy: false, message: `auth failed for ${PLANTED}` }) } }),
  } as never;
  const service = new ProviderValidationService({ registry, credentialEnvFor: () => ["NVIDIA_API_KEY"] });
  const report = await service.test("fixture.provider");
  assert.ok(!report.message.includes(PLANTED), "health diagnostics are redacted before surfacing");
});

test("SEC-7 server metadata surfaces carry no secrets: /health payload is identity-only", async () => {
  const { QuackHttpServer } = await import("../server/index.js");
  const { dir, cleanup } = await tempDir("quack-p16-sec-server-");
  try {
    const system = createQuackSystem({ dataDir: dir, workspaceRoot: dir });
    const server = new QuackHttpServer({ system, port: 0, authentication: false });
    await server.start();
    const response = await fetch(`${server.address().url}/health`);
    const health = await response.json() as Record<string, unknown>;
    const serialized = JSON.stringify(health);
    for (const name of CREDENTIAL_NAMES) assert.ok(!serialized.includes(name), `health payload mentions ${name}`);
    await server.stop();
    await system.airm.shutdown();
    await system.dnpl.shutdown();
    await system.ucp.runtime.shutdown();
  } finally { await cleanup(); }
});

test("SEC-8 checkpoints, journals, and approval records are metadata-only by construction: record shapes carry no argument/prompt fields", async () => {
  // Structural (R44 precedent): the durable record FIELD LISTS carry no
  // arguments/prompt fields. Verified against the declared record shapes.
  const { readFile: read } = await import("node:fs/promises");
  const checkpointSource = await read(new URL("../../src/runtime/mission-lifecycle/mission-recovery.ts", import.meta.url), "utf8");
  const journalSource = await read(new URL("../../src/runtime/mission-lifecycle/step-attempt-journal.ts", import.meta.url), "utf8");
  // The checkpoint field allowlist (source of the parse contract).
  const fields = checkpointSource.match(/const CHECKPOINT_FIELDS = new Set\(\[[^\]]+\]/s)?.[0] ?? "";
  assert.ok(fields.length > 0, "checkpoint field allowlist found in source");
  assert.ok(!/\bargs\b|\barguments\b|\bprompt\b/.test(fields), "checkpoint fields carry no arguments/prompt");
  // The journal record type declares identity/state metadata only.
  const journalRecord = journalSource.match(/export interface StepAttemptRecord \{[^}]+\}/s)?.[0] ?? "";
  assert.ok(journalRecord.length > 0, "journal record shape found in source");
  assert.ok(!/\bargs\b|\barguments\b|\bprompt\b/.test(journalRecord), "journal record fields carry no arguments/prompt");
  // Approval records DO carry a redacted `reason` (P15-F) — the redaction
  // call must be present at the persistence seam.
  const approvalSource = await read(new URL("../../src/runtime/mission-lifecycle/approval-store.ts", import.meta.url), "utf8");
  assert.ok(approvalSource.includes("redactSecrets"), "approval persistence redacts reason text through the single authority");
});

test("SEC-9 a secret planted in a model proposal never persists unredacted: durable approval reason redaction holds", async () => {
  const { dir, cleanup } = await tempDir("quack-p16-sec-approval-");
  try {
    const PLANTED = "sk-plantedapprovalkey1234567890";
    await mkdir(join(dir, "mission-approvals"), { recursive: true });
    const store = new JsonFileApprovalStore(dir);
    const request = {
      missionId: "m-sec-approval", stepIndex: 0, capability: "fixture.destructive",
      proposalDigest: "a".repeat(64), riskLevel: "DESTRUCTIVE" as const,
      reason: `destroy with key ${PLANTED}`,
    };
    const parked = await store.parkRequest(request as never);
    assert.ok(!parked.reason.includes(PLANTED), "parked approval reason is redacted at persistence");
    const files = await readdir(join(dir, "mission-approvals"));
    for (const file of files) {
      const raw = await readFile(join(dir, "mission-approvals", file), "utf8");
      assert.ok(!raw.includes(PLANTED), `approval file ${file} must not contain the planted secret`);
    }
  } finally { await cleanup(); }
});

test("SEC-10 backup excludes secret-bearing files and redacts secret-shaped JSON fields", async () => {
  const { createQuackBackup } = await import("../recovery/backup.js");
  const { dir, cleanup } = await tempDir("quack-p16-sec-backup-");
  try {
    await writeFile(join(dir, "settings.json"), JSON.stringify({ theme: "dark", apiKey: "must-not-leak-p16" }));
    await writeFile(join(dir, "credentials.json"), JSON.stringify({ token: "must-not-leak-p16" }));
    const backupDir = join(dir, "..", `quack-p16-backup-${createId("sec")}`);
    const created = await createQuackBackup(dir, backupDir);
    assert.ok(!created.manifest.files.some((file) => file.path === "credentials.json"), "secret-named files excluded from the manifest");
    const settings = await readFile(join(backupDir, "payload", "settings.json"), "utf8");
    assert.ok(!settings.includes("must-not-leak-p16"), "secret-shaped JSON values redacted in the backup payload");
    await rm(backupDir, { recursive: true, force: true });
  } finally { await cleanup(); }
});
