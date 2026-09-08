/**
 * Phase 7A provider validation tests: missing key, invalid key, successful
 * mock provider, secret leakage prevention, health record persistence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProviderRegistry, EchoProvider, type ProviderAdapter, type ProviderCapabilities, type GenerateRequest, type GenerateResult } from "./provider.js";
import { ProviderValidationService } from "./validation.js";
import { InMemoryProviderHealthStore, JsonFileProviderHealthStore, type ProviderHealthStore } from "./health.js";
import { EnvironmentSecretProvider, redactSecrets, PROVIDER_SECRET_DESCRIPTORS } from "../security/secret-provider.js";
import { PermissionBackedCapabilityBroker } from "../security/capability-broker.js";
import { DenyByDefaultPermissionPolicy, type Permission, type PermissionPolicy } from "../security/permissions.js";

class FakeProvider implements ProviderAdapter {
  constructor(readonly id: string, private readonly outcome: { healthy: boolean; message: string } | Error) {}
  async discover(): Promise<ProviderCapabilities> {
    return { providerId: this.id, models: ["fake-1"], supportsStreaming: false, supportsStructuredOutput: false, supportsToolCalling: false, supportsEmbeddings: false, supportsMultimodal: false };
  }
  async healthCheck(): Promise<{ readonly healthy: boolean; readonly message: string }> {
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    return { text: request.prompt, model: request.model };
  }
}

function registryWithEnv(...adapters: ProviderAdapter[]) {
  const registry = new ProviderRegistry();
  for (const adapter of adapters) registry.register(adapter);
  const credentialEnvFor = (id: string): readonly string[] =>
    id === "provider.fake-keyed" ? ["FAKE_PROVIDER_KEY"] : [];
  return { registry, credentialEnvFor };
}

test("provider list reports registered providers and credential state", async () => {
  const { registry, credentialEnvFor } = registryWithEnv(new EchoProvider(), new FakeProvider("provider.fake-keyed", { healthy: true, message: "ok" }));
  const service = new ProviderValidationService({ registry, credentialEnvFor });
  const entries = service.list();
  assert.equal(entries.length, 2);
  const echo = entries.find(entry => entry.providerId === "core.echo-provider")!;
  assert.equal(echo.configured, true, "providers without credential requirements are configured");
  const keyed = entries.find(entry => entry.providerId === "provider.fake-keyed")!;
  assert.deepEqual(keyed.credentialEnv, ["FAKE_PROVIDER_KEY"]);
  assert.equal(keyed.configured, false, "missing key must report unconfigured");
});

test("provider test: healthy provider records a live health record", async () => {
  process.env["FAKE_PROVIDER_KEY"] = "fake-key-set-for-test";
  try {
    const store = new InMemoryProviderHealthStore();
    const { registry, credentialEnvFor } = registryWithEnv(new FakeProvider("provider.fake-keyed", { healthy: true, message: "Connected to fake endpoint" }));
    const service = new ProviderValidationService({ registry, credentialEnvFor, healthStore: store });
    const report = await service.test("provider.fake-keyed");
    assert.equal(report.healthy, true);
    assert.equal(report.missingCredentials.length, 0, "keyed provider with env set reports no missing credentials");
    assert.equal(store.history().length, 1);
    assert.equal(store.latest()[0]?.providerId, "provider.fake-keyed");
  } finally {
    delete process.env["FAKE_PROVIDER_KEY"];
  }
});

test("provider test: missing key reports unconfigured and unhealthy", async () => {
  const { registry, credentialEnvFor } = registryWithEnv(new FakeProvider("provider.fake-keyed", { healthy: false, message: "auth not configured" }));
  const service = new ProviderValidationService({ registry, credentialEnvFor, healthStore: new InMemoryProviderHealthStore() });
  const report = await service.test("provider.fake-keyed");
  assert.equal(report.healthy, false);
  assert.deepEqual(report.missingCredentials, ["FAKE_PROVIDER_KEY"]);
});

test("provider test: invalid key fails closed through the provider's own healthCheck", async () => {
  // A provider whose healthCheck reports auth failure (status 401 style).
  const { registry, credentialEnvFor } = registryWithEnv(new FakeProvider("provider.fake-keyed", { healthy: false, message: "API returned status 401" }));
  process.env["FAKE_PROVIDER_KEY"] = "invalid-key-for-testing";
  try {
    const service = new ProviderValidationService({ registry, credentialEnvFor, healthStore: new InMemoryProviderHealthStore() });
    const report = await service.test("provider.fake-keyed");
    assert.equal(report.healthy, false, "invalid credentials must fail closed");
    assert.match(report.message, /401/);
    assert.equal(report.missingCredentials.length, 0, "key is set; it is invalid, not missing");
  } finally {
    delete process.env["FAKE_PROVIDER_KEY"];
  }
});

test("provider test: unknown provider id is a usage error", async () => {
  const { registry, credentialEnvFor } = registryWithEnv(new EchoProvider());
  const service = new ProviderValidationService({ registry, credentialEnvFor });
  const report = await service.test("provider.nope");
  assert.equal(report.healthy, false);
  assert.match(report.message, /not registered/);
});

test("provider test: throwing healthCheck fails closed with a redacted record", async () => {
  const store = new InMemoryProviderHealthStore();
  const { registry, credentialEnvFor } = registryWithEnv(new FakeProvider("provider.fake-keyed", new Error("Bearer sk-supersecretvalue12345 leaked in error")));
  const service = new ProviderValidationService({ registry, credentialEnvFor, healthStore: store });
  const report = await service.test("provider.fake-keyed");
  assert.equal(report.healthy, false);
  assert.ok(!report.message.includes("sk-supersecretvalue12345"), "bearer secrets must be redacted from provider messages");
  assert.match(report.message, /REDACTED/);
  assert.equal(store.history()[0]?.source, "live");
});

test("provider doctor aggregates all providers and persists health history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quack-prov-health-"));
  try {
    const { registry, credentialEnvFor } = registryWithEnv(
      new EchoProvider(),
      new FakeProvider("provider.fake-keyed", { healthy: false, message: "down" }),
    );
    const store = new JsonFileProviderHealthStore(join(dir, "providers", "health.json"));
    const service = new ProviderValidationService({ registry, credentialEnvFor, healthStore: store });
    const reports = await service.doctor();
    assert.equal(reports.length, 2);
    assert.equal(reports.some(report => report.healthy), true);
    assert.equal(reports.some(report => !report.healthy), true);
    // Persisted history survives a new store instance.
    const reloaded = new JsonFileProviderHealthStore(join(dir, "providers", "health.json"));
    assert.equal(reloaded.history().length, 2);
    assert.equal(new Set(reloaded.history().map(record => record.providerId)).size, 2);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

// --- SecretProvider ---------------------------------------------------------

test("SecretProvider: presence reports without reading values", () => {
  const provider = new EnvironmentSecretProvider();
  const nvidia = provider.presence("provider.nvidia-nim");
  assert.equal(nvidia.length, 1);
  assert.equal(nvidia[0]?.name, "NVIDIA_API_KEY");
  assert.equal(typeof nvidia[0]?.present, "boolean");
});

test("SecretProvider: resolution requires allowlist + consumer match + broker authority", async () => {
  const denyAll = new PermissionBackedCapabilityBroker(new DenyByDefaultPermissionPolicy());
  const denied = new EnvironmentSecretProvider(denyAll);
  process.env["NVIDIA_API_KEY"] = "nv-secret-test-value";
  try {
    // Wrong consumer.
    const wrongConsumer = await denied.resolve("NVIDIA_API_KEY", "provider.openai-compatible", { actor: "test" });
    assert.ok(!wrongConsumer.ok);
    // Not allowlisted.
    const unknown = await denied.resolve("TOTALLY_FAKE_KEY", "provider.nvidia-nim", { actor: "test" });
    assert.ok(!unknown.ok);
    // Allowlisted + right consumer but broker denies (deny-by-default policy).
    const blocked = await denied.resolve("NVIDIA_API_KEY", "provider.nvidia-nim", { actor: "test" });
    assert.ok(!blocked.ok);
    assert.match(blocked.error!.message, /denied/i);
  } finally {
    delete process.env["NVIDIA_API_KEY"];
  }
});

test("SecretProvider: broker-authorized resolution returns the value; missing key reports present=false", async () => {
  const allowSecrets: PermissionPolicy = {
    decide: async (request) => request.permission.startsWith("secrets.read:") && request.permission !== "secrets.read"
      ? { granted: true, reason: "test allowlist" }
      : { granted: false, reason: "deny" },
  };
  const broker = new PermissionBackedCapabilityBroker(allowSecrets);
  const provider = new EnvironmentSecretProvider(broker);
  delete process.env["QUACK_OPENAI_API_KEY"];
  const missing = await provider.resolve("QUACK_OPENAI_API_KEY", "provider.openai-compatible", { actor: "test" });
  assert.ok(missing.ok);
  assert.equal(missing.data.present, false);
  assert.equal(missing.data.value, undefined, "absent secrets must never carry a value");
  process.env["QUACK_OPENAI_API_KEY"] = "sk-openai-test";
  try {
    const resolved = await provider.resolve("QUACK_OPENAI_API_KEY", "provider.openai-compatible", { actor: "test" });
    assert.ok(resolved.ok);
    assert.equal(resolved.data.present, true);
    assert.equal(resolved.data.value, "sk-openai-test");
  } finally {
    delete process.env["QUACK_OPENAI_API_KEY"];
  }
});

test("secret leakage prevention: redactSecrets removes keys, tokens, and bearer values", () => {
  const leaky = [
    "NVIDIA_API_KEY=nv-live-secret-987654321",
    "Authorization: Bearer sk-abcdef1234567890",
    "QUACK_VLLM_API_KEY: vllm-secret-value-123",
    "my PASSWORD=hunter2longenough text",
    "token=ghp_0123456789abcdef",
  ].join(" | ");
  const redacted = redactSecrets(leaky);
  assert.ok(!redacted.includes("nv-live-secret"), "env-dumped values must be redacted");
  assert.ok(!redacted.includes("sk-abcdef1234567890"), "bearer tokens must be redacted");
  assert.ok(!redacted.includes("vllm-secret-value-123"));
  assert.ok(!redacted.includes("hunter2longenough"));
  assert.ok(!redacted.includes("ghp_0123456789abcdef"));
  assert.ok(redacted.includes("REDACTED"));
  // Secret names themselves remain visible for diagnostics.
  assert.ok(redacted.includes("NVIDIA_API_KEY"));
});

test("provider secret descriptors only pair each secret with its declaring consumer", () => {
  for (const descriptor of PROVIDER_SECRET_DESCRIPTORS) {
    assert.match(descriptor.consumer, /^provider\./);
    assert.ok(descriptor.name.length > 0);
    assert.ok(!descriptor.description.toLowerCase().includes("value"));
  }
});
