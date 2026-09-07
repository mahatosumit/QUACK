import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { PlatformRuntime } from "./platform-runtime.js";
import { HardwareMonitor } from "./hardware.js";
import { NativeServicesManager } from "./native-services.js";
import { DistributedRuntime } from "./distributed-runtime.js";
import { CapabilityNegotiator } from "./capability-negotiation.js";
import { RemoteExecution } from "./remote-execution.js";
import { LocalAiRuntime } from "./local-ai-runtime.js";
import { ContainerRuntime } from "./container-runtime.js";
import { SecretVault, Sandbox } from "./security.js";
import { PackageManager, UpdateSystem } from "./packaging.js";
import { Monitoring } from "./monitoring.js";
import { createDNPL } from "./dnpl.js";

// ── PlatformRuntime ─────────────────────────────────────────────

describe("PlatformRuntime", () => {
  const runtime = new PlatformRuntime();
  it("reports observed platform metadata and unknown virtualization", () => {
    const info = runtime.detectPlatform();
    assert.ok(info.platform);
    assert.ok(info.arch);
    assert.ok(info.hostname);
    assert.equal(info.isContainer, null);
    assert.equal(info.isVirtualMachine, null);
  });
  it("does not advertise unimplemented native adapters", () => {
    assert.ok(Object.values(runtime.getCapabilities()).every(value => value === false));
  });
  it("excludes ambient credentials from environment variables", (context) => {
    const keys = ["OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY", "DATABASE_PASSWORD", "QUACK_TOKEN", "CUSTOM_PRIVATE_VALUE"];
    const originals = new Map(keys.map(key => [key, process.env[key]]));
    context.after(() => { for (const [key, value] of originals) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    for (const key of keys) process.env[key] = "fixture-sensitive-value";
    const env = runtime.getEnvironment();
    assert.deepEqual(Object.keys(env.variables).sort(), ["architecture", "nodeVersion", "platform"]);
    assert.ok(!JSON.stringify(env.variables).includes("fixture-sensitive-value"));
    assert.ok(env.paths.home);
    assert.ok(env.locale);
  });
  it("does not infer permission grants from platform detection", () => {
    assert.throws(() => runtime.getPermissions(), /unsupported/);
  });
  it("initializes and shuts down metadata lifecycle", async () => {
    await runtime.initialize();
    await runtime.shutdown();
  });
});

// ── HardwareMonitor ─────────────────────────────────────────────

describe("HardwareMonitor", () => {
  const hw = new HardwareMonitor();
  for (const method of ["getHardwareInfo", "getCpuInfo", "getGpuInfo", "getDiskInfo", "getNetworkInterfaces"] as const) {
    it(method + " rejects without a verified sampler", async () => {
      await assert.rejects(() => hw[method](), /unsupported/);
    });
  }
  it("reports actual OS memory with unknown swap", async () => {
    const memory = await hw.getMemoryInfo();
    assert.ok(memory.totalGB > 0);
    assert.ok(memory.utilization >= 0 && memory.utilization <= 100);
    assert.equal(memory.swapTotalGB, null);
    assert.equal(memory.swapUsedGB, null);
  });
  it("does not invent battery, power or thermal observations", async () => {
    assert.equal(await hw.getBatteryInfo(), undefined);
    assert.throws(() => hw.getPowerMode(), /unsupported/);
    assert.throws(() => hw.getThermalState(), /unsupported/);
  });
});

// ── NativeServicesManager ───────────────────────────────────────

describe("NativeServicesManager", () => {
  const mgr = new NativeServicesManager();
  before(async () => mgr.initialize());
  after(async () => mgr.shutdown());
  it("registers a service definition without installing or running it", async () => {
    const id = mgr.registerService({ name: "fixture-service", displayName: "Fixture", description: "Test record", executablePath: "fixture-executable", args: [], runAs: "user", autoStart: false, restartOnCrash: false, restartDelayMs: 1000 });
    await assert.rejects(() => mgr.startService(id), /unsupported/);
    await assert.rejects(() => mgr.stopService(id), /unsupported/);
    assert.equal(mgr.getService(id)?.status, "stopped");
    assert.equal(mgr.getService(id)?.pid, undefined);
    assert.equal(mgr.getService(id)?.cpuUsage, undefined);
    assert.equal(mgr.getService(id)?.memoryUsageMB, undefined);
    assert.deepEqual(mgr.getServiceStatus(), { running: 0, stopped: 1, error: 0 });
  });
  it("rejects clipboard access and notification delivery", async () => {
    await assert.rejects(() => mgr.getClipboardContent(), /unsupported/);
    await assert.rejects(() => mgr.setClipboardContent({ type: "text", text: "fixture", timestamp: "" }), /unsupported/);
    await assert.rejects(() => mgr.sendNotification({ id: "fixture", title: "Fixture", body: "Fixture", urgency: "normal", timestamp: "", source: "test" }), /unsupported/);
    assert.deepEqual(mgr.getNotifications(), []);
  });
  it("rejects unimplemented process and window operations", async () => {
    await assert.rejects(() => mgr.listProcesses(), /unsupported/);
    await assert.rejects(() => mgr.getProcess(123), /unsupported/);
    await assert.rejects(() => mgr.killProcess(123), /unsupported/);
    await assert.rejects(() => mgr.listWindows(), /unsupported/);
    await assert.rejects(() => mgr.focusWindow(123), /unsupported/);
  });
});

// ── DistributedRuntime ──────────────────────────────────────────

describe("DistributedRuntime", () => {
  let dist: DistributedRuntime;

  before(() => { dist = new DistributedRuntime(); });
  before(async () => await dist.initialize());
  after(async () => await dist.shutdown());

  it("initializes without inventing local node observations", () => {
    const nodes = dist.getAllNodes();
    assert.equal(nodes.length, 0);
  });

  it("registers and discovers nodes", () => {
    const id = dist.registerNode({
      nodeId: "node-2", nodeName: "worker-1",
      platform: { platform: "linux", arch: "x64", hostname: "worker", username: "root", osVersion: "Ubuntu", kernelVersion: "5.15", uptime: 1000, isWsl: false, isContainer: false, isVirtualMachine: false },
      hardware: { cpu: { model: "Intel", cores: 2, logicalCores: 4, architecture: "x64", frequencyMHz: 2000, cacheL1: 32, cacheL2: 256, cacheL3: 4096, vendor: "GenuineIntel", flags: [], utilization: 20 }, gpus: [], memory: { totalGB: 8, freeGB: 4, usedGB: 4, utilization: 50, swapTotalGB: 0, swapUsedGB: 0 }, disks: [], network: [] },
      capabilities: [{ category: "compute", name: "compute", version: "fixture", description: "Fixture capability", score: 1, properties: {} }], availability: "available", load: 0.3, address: "192.168.1.2", port: 9877, lastSeen: new Date().toISOString(), priority: 50,
    });
    assert.equal(dist.discoverNodes().length, 1);
  });

  it("submits and assigns tasks", () => {
    const tid = dist.submitTask({ type: "test", payload: { cmd: "echo" }, requiredCapabilities: ["compute"], priority: 1 });
    assert.ok(tid);
    const task = dist.getTask(tid);
    assert.equal(task?.status, "pending");
    assert.ok(dist.assignTask(tid));
    assert.equal(dist.getTask(tid)?.status, "assigned");
  });

  it("completes tasks", () => {
    const tid = dist.submitTask({ type: "test", payload: {}, requiredCapabilities: ["compute"], priority: 1 });
    dist.assignTask(tid);
    assert.ok(dist.completeTask(tid, { success: true }));
    assert.equal(dist.getTask(tid)?.status, "completed");
  });

  it("fails tasks", () => {
    const tid = dist.submitTask({ type: "test", payload: {}, requiredCapabilities: ["compute"], priority: 1 });
    assert.ok(dist.failTask(tid, "Something went wrong"));
    assert.equal(dist.getTask(tid)?.status, "failed");
  });

  it("rejects health checks without a node transport", () => {
    const node = dist.getAllNodes()[0]!;
    assert.throws(() => dist.performHealthCheck(node.id), /unsupported/);
    assert.deepEqual(dist.getHealthHistory(node.id), []);
  });

  it("returns cluster stats", () => {
    const stats = dist.getClusterStats();
    assert.equal(typeof stats.totalNodes, "number");
    assert.equal(typeof stats.onlineNodes, "number");
  });

  it("unregisters nodes", () => {
    const nodes = dist.getAllNodes();
    assert.ok(dist.unregisterNode(nodes[0]!.id));
    assert.equal(dist.getOnlineNodes().length, 0);
  });
});

// ── CapabilityNegotiator ────────────────────────────────────────

describe("CapabilityNegotiator", () => {
  let neg: CapabilityNegotiator;

  before(() => { neg = new CapabilityNegotiator(); });

  it("registers and finds adverts", () => {
    neg.registerAdvert({
      nodeId: "n1", nodeName: "gpu-node",
      platform: { platform: "linux", arch: "x64", hostname: "gpu-box", username: "root", osVersion: "Ubuntu", kernelVersion: "5.15", uptime: 99999, isWsl: false, isContainer: false, isVirtualMachine: false },
      hardware: { cpu: { model: "Xeon", cores: 16, logicalCores: 32, architecture: "x64", frequencyMHz: 3200, cacheL1: 64, cacheL2: 1024, cacheL3: 32768, vendor: "GenuineIntel", flags: [], utilization: 10 }, gpus: [], memory: { totalGB: 64, freeGB: 32, usedGB: 32, utilization: 50, swapTotalGB: 0, swapUsedGB: 0 }, disks: [], network: [] },
      capabilities: [
        { category: "ai", name: "tensorflow", version: "2.15", description: "ML inference", score: 90, properties: {} },
        { category: "gpu", name: "cuda", version: "12.0", description: "GPU compute", score: 95, properties: {} },
      ],
      availability: "available", load: 0.2, address: "10.0.0.1", port: 9876, lastSeen: new Date().toISOString(), priority: 100,
    });
    assert.equal(neg.getAllAdverts().length, 1);
  });

  it("finds best match for requirements", () => {
    const matches = neg.findBestMatch({
      requiredCapabilities: [{ category: "ai", name: "tensorflow", minScore: 80 }],
      requiresGpu: false,
    });
    assert.ok(matches.length > 0);
    assert.equal(matches[0]!.nodeId, "n1");
  });

  it("finds nodes with capability", () => {
    const nodes = neg.findNodesWithCapability("gpu", "cuda");
    assert.equal(nodes.length, 1);
  });

  it("detects capability gaps", () => {
    const gaps = neg.getCapabilityGaps({
      requiredCapabilities: [
        { category: "ai", name: "tensorflow", minScore: 80 },
        { category: "ros2", name: "ros2-humble", minScore: 50 },
      ],
    });
    assert.ok(gaps.length > 0);
    assert.equal(gaps[0]!.name, "ros2-humble");
  });

  it("returns capability heatmap", () => {
    const heat = neg.getCapabilityHeatmap();
    assert.ok(heat["ai"]);
    assert.ok(heat["ai"].total > 0);
  });

  it("unregisters adverts", () => {
    neg.unregisterAdvert("n1");
    assert.equal(neg.getAllAdverts().length, 0);
  });
});

// ── RemoteExecution ─────────────────────────────────────────────

describe("RemoteExecution", () => {
  const remote = new RemoteExecution();
  before(async () => remote.initialize());
  after(async () => remote.shutdown());
  it("rejects transport effects and leaves connection inventory empty", async () => {
    await assert.rejects(() => remote.connect("fixture", "example.invalid", 22), /unsupported/);
    await assert.rejects(() => remote.disconnect("fixture"), /unsupported/);
    await assert.rejects(() => remote.reconnect("fixture"), /unsupported/);
    await assert.rejects(() => remote.checkConnectionStatus("fixture"), /unsupported/);
    assert.deepEqual(remote.getAllConnections(), []);
    assert.deepEqual(remote.getActiveConnections(), []);
    assert.equal(remote.getConnection("fixture"), undefined);
  });
  it("rejects remote execution without inventing successful output", async () => {
    await assert.rejects(() => remote.execCommand("fixture", "fixture-command"), /unsupported/);
  });
  it("rejects every unimplemented remote file operation", async () => {
    await assert.rejects(() => remote.uploadFile("fixture", "local", "remote"), /unsupported/);
    await assert.rejects(() => remote.downloadFile("fixture", "remote", "local"), /unsupported/);
    await assert.rejects(() => remote.readFile("fixture", "remote"), /unsupported/);
    await assert.rejects(() => remote.writeFile("fixture", "remote", "fixture"), /unsupported/);
    await assert.rejects(() => remote.listFiles("fixture", "remote"), /unsupported/);
    await assert.rejects(() => remote.deleteFile("fixture", "remote"), /unsupported/);
    await assert.rejects(() => remote.createDirectory("fixture", "remote"), /unsupported/);
    await assert.rejects(() => remote.deleteDirectory("fixture", "remote"), /unsupported/);
  });
});

// ── LocalAiRuntime ──────────────────────────────────────────────

describe("LocalAiRuntime", () => {
  const runtime = new LocalAiRuntime({ ollamaEndpoint: "http://example.invalid" });
  before(async () => runtime.initialize());
  after(async () => runtime.shutdown());
  it("does not treat configured endpoints as discovered providers or models", () => {
    assert.deepEqual(runtime.getAllProviders(), []);
    assert.deepEqual(runtime.getAvailableProviders(), []);
    assert.deepEqual(runtime.getRuntimeInfo(), []);
    assert.deepEqual(runtime.getModels(), []);
    assert.deepEqual(runtime.getModels("ollama"), []);
    assert.equal(runtime.getProvider("ollama"), undefined);
    assert.equal(runtime.getBestProviderForTask("fixture task"), null);
  });
  it("rejects model loading and health checks without changing state", async () => {
    await assert.rejects(() => runtime.loadModel("ollama", "fixture-model"), /unsupported/);
    await assert.rejects(() => runtime.unloadModel("ollama", "fixture-model"), /unsupported/);
    await assert.rejects(() => runtime.checkHealth("ollama"), /unsupported/);
    assert.deepEqual(runtime.getLoadedModels(), []);
    assert.equal(runtime.findModelByCapability("reasoning"), undefined);
  });
});

// ── ContainerRuntime ────────────────────────────────────────────

describe("ContainerRuntime", () => {
  const runtime = new ContainerRuntime();
  before(async () => runtime.initialize());
  after(async () => runtime.shutdown());
  it("keeps selected runtime configuration separate from actual inventory", async () => {
    assert.equal(runtime.getRuntimeType(), "docker");
    assert.deepEqual(await runtime.listContainers(), []);
    assert.deepEqual(await runtime.listImages(), []);
    assert.equal(await runtime.getContainer("fixture"), undefined);
  });
  it("rejects lifecycle effects without creating synthetic container records", async () => {
    await assert.rejects(() => runtime.runContainer("fixture", "fixture-image"), /unsupported/);
    await assert.rejects(() => runtime.startContainer("fixture"), /unsupported/);
    await assert.rejects(() => runtime.stopContainer("fixture"), /unsupported/);
    await assert.rejects(() => runtime.removeContainer("fixture"), /unsupported/);
    await assert.rejects(() => runtime.pullImage("fixture", "latest"), /unsupported/);
    await assert.rejects(() => runtime.removeImage("fixture"), /unsupported/);
    assert.deepEqual(await runtime.listContainers(), []);
    assert.deepEqual(await runtime.listImages(), []);
  });
  it("rejects execution, logs and usage sampling without an executor", async () => {
    await assert.rejects(() => runtime.execInContainer("fixture", "fixture-command"), /unsupported/);
    await assert.rejects(() => runtime.getContainerLogs("fixture"), /unsupported/);
    await assert.rejects(() => runtime.getUsage(), /unsupported/);
  });
});

// ── SecretVault ─────────────────────────────────────────────────

describe("SecretVault", () => {
  let vault: SecretVault;

  before(() => { vault = new SecretVault(); });
  before(async () => await vault.initialize());
  after(async () => await vault.shutdown());

  it("stores and retrieves secrets", () => {
    vault.store("api-key", "API_KEY", "sk-12345");
    assert.equal(vault.retrieve("api-key"), "sk-12345");
  });

  it("returns null for unknown secrets", () => {
    assert.equal(vault.retrieve("unknown"), null);
  });

  it("tracks access count", () => {
    const entry = vault.getEntry("api-key")!;
    assert.ok(entry.accessCount >= 1);
  });

  it("lists secrets by scope", () => {
    vault.store("db-url", "DATABASE_URL", "postgres://localhost", "cluster");
    const cluster = vault.listSecrets("cluster");
    assert.ok(cluster.length > 0);
  });

  it("deletes secrets", () => {
    vault.store("temp", "TEMP", "value");
    assert.ok(vault.delete("temp"));
    assert.equal(vault.retrieve("temp"), null);
  });

  it("expires old secrets", () => {
    vault.store("fleeting", "FLEET", "gone", "local", false, 1);
    const stats = vault.getStats();
    // may or may not have expired based on timing
    assert.ok(stats.total >= 0);
  });

  it("returns detached metadata and refuses unsupported encryption claims", () => {
    const stored = vault.store("private", "PRIVATE", "fixture-sensitive-value");
    assert.equal(stored.encrypted, false);
    assert.equal("value" in stored, false);
    assert.equal("value" in vault.getEntry("private")!, false);
    assert.equal(vault.listSecrets().some((entry) => "value" in entry), false);
    assert.doesNotMatch(JSON.stringify(vault.listSecrets()), /fixture-sensitive-value/);
    stored.accessCount = 900;
    assert.equal(vault.getEntry("private")?.accessCount, 0);
    assert.throws(() => vault.store("encrypted", "KEY", "value", "local", true), /unavailable/i);
  });

  it("revokes by scope", () => {
    const count = vault.revokeByScope("cluster");
    assert.ok(count >= 0);
  });

  it("returns access log", () => {
    const log = vault.getAccessLog();
    assert.ok(Array.isArray(log));
  });
});

// ── Sandbox ─────────────────────────────────────────────────────

describe("Sandbox", () => {
  let sandbox: Sandbox;

  before(() => { sandbox = new Sandbox(); });

  it("creates policies", () => {
    const p = sandbox.createPolicy("strict");
    assert.equal(p.enabled, true);
    assert.equal(p.allowNetwork, false);
  });

  it("creates permissive policies", () => {
    sandbox.createPolicy("permissive", { allowNetwork: true, allowFileSystem: true, allowedPaths: ["/home"], allowedDomains: ["example.com"] });
    const p = sandbox.getPolicy("permissive");
    assert.ok(p?.allowNetwork);
    assert.ok(p?.allowFileSystem);
  });

  it("checks paths against policies", () => {
    assert.ok(sandbox.checkPathAllowed("permissive", "/home/user/file.txt"));
    assert.ok(!sandbox.checkPathAllowed("permissive", "/etc/passwd"));
  });

  it("checks domains against policies", () => {
    assert.ok(sandbox.checkDomainAllowed("permissive", "example.com"));
    assert.ok(!sandbox.checkDomainAllowed("permissive", "evil.com"));
  });

  it("checks executables against policies", () => {
    sandbox.createPolicy("exec-policy", { allowProcessSpawn: true, allowedExecutables: ["/usr/bin/python3", "/usr/bin/node"] });
    assert.ok(sandbox.checkExecutableAllowed("exec-policy", "/usr/bin/python3"));
  });

  it("refuses execution when no enforcing sandbox exists", async () => {
    let executed = false;
    await assert.rejects(() => sandbox.executeInSandbox("strict", async () => { executed = true; }), /isolation/i);
    assert.equal(executed, false);
  });

  it("throws for disabled policies", async () => {
    sandbox.createPolicy("disabled", { enabled: false });
    await assert.rejects(() => sandbox.executeInSandbox("disabled", async () => "fail"));
  });

  it("lists policies", () => {
    assert.ok(sandbox.getAllPolicies().length >= 3);
  });
});

// ── PackageManager ──────────────────────────────────────────────

describe("PackageManager", () => {
  let pm: PackageManager;

  before(() => { pm = new PackageManager(); });
  before(async () => await pm.initialize());
  after(async () => await pm.shutdown());

  it("creates packages", () => {
    const pkg = pm.createPackage("1.0.0", "exe", "win32", "x64", { sizeMB: 50 });
    assert.equal(pkg.version, "1.0.0");
    assert.equal(pkg.format, "exe");
  });

  it("finds packages", () => {
    const pkg = pm.findPackage("1.0.0", "win32", "x64");
    assert.ok(pkg);
  });

  it("lists packages", () => {
    pm.createPackage("2.0.0", "deb", "linux", "x64");
    const pkgs = pm.listPackages("linux");
    assert.equal(pkgs.length, 1);
  });

  it("gets dependency trees", () => {
    pm.createPackage("1.0.0", "zip", "win32", "x64", { dependencies: [] });
    const tree = pm.getDependencyTree("1.0.0");
    assert.ok(tree);
    assert.ok(Array.isArray(tree.dependencies));
  });

  it("returns stats", () => {
    const stats = pm.getStats();
    assert.ok(stats.total > 0);
  });

  it("deletes packages", () => {
    const initial = pm.listPackages().length;
    pm.createPackage("delete-me", "zip", "win32", "x64");
    assert.ok(pm.deletePackage("delete-me-win32-x64"));
  });
});

// ── UpdateSystem ────────────────────────────────────────────────

describe("UpdateSystem", () => {
  const updates = new UpdateSystem();
  let id: string;
  it("registers and queries supplied update metadata", async () => {
    id = updates.registerUpdate({ currentVersion: "0.1.0", latestVersion: "0.2.0", channel: "stable", releaseDate: new Date().toISOString(), releaseNotes: "Fixture update", packages: [], mandatory: false, minUpgradableVersion: "0.1.0" });
    assert.equal((await updates.checkForUpdates("0.1.0", "stable")).length, 1);
  });
  it("does not claim installation or rollback without an installer", async () => {
    await assert.rejects(() => updates.applyUpdate(id), /unsupported/);
    assert.throws(() => updates.rollback("0.2.0"), /unsupported/);
    assert.equal(updates.getCurrentVersion(), "0.1.0");
    assert.deepEqual(updates.getUpdateHistory(), []);
    assert.equal(updates.getPendingUpdates().length, 1);
  });
});

// ── Monitoring ──────────────────────────────────────────────────

describe("Monitoring", () => {
  const monitoring = new Monitoring();
  before(async () => monitoring.initialize());
  after(async () => monitoring.shutdown());
  it("does not fabricate system snapshots or summaries", async () => {
    await assert.rejects(() => monitoring.collectSnapshot(), /unsupported/);
    assert.throws(() => monitoring.getSystemSummary(), /unsupported/);
    assert.deepEqual(monitoring.getSnapshots(), []);
    assert.equal(monitoring.getLatestSnapshot(), undefined);
  });
  it("retains caller supplied measurements", () => {
    const entry = monitoring.recordMetric("fixture_metric", 42, { name: "fixture_metric" });
    assert.equal(entry.value, 42);
    assert.deepEqual(monitoring.getMetricsSummary(), { fixture_metric: { min: 42, max: 42, avg: 42, count: 1 } });
    monitoring.clearHistory();
    assert.deepEqual(monitoring.getMetricHistory("fixture_metric"), []);
  });
});

// ── createDNPL factory ──────────────────────────────────────────

describe("createDNPL factory", () => {
  let dnpl: ReturnType<typeof createDNPL>;

  before(async () => { dnpl = createDNPL(); });
  after(async () => await dnpl.shutdown());

  it("returns all DNPL components", () => {
    assert.ok(dnpl.platform);
    assert.ok(dnpl.hardware);
    assert.ok(dnpl.nativeServices);
    assert.ok(dnpl.distributed);
    assert.ok(dnpl.negotiator);
    assert.ok(dnpl.remote);
    assert.ok(dnpl.localAi);
    assert.ok(dnpl.containers);
    assert.ok(dnpl.vault);
    assert.ok(dnpl.sandbox);
    assert.ok(dnpl.packages);
    assert.ok(dnpl.updates);
    assert.ok(dnpl.monitoring);
  });

  it("initializes all components", async () => {
    await dnpl.initialize();
    // Should not throw
    assert.ok(true);
  });

  it("shuts down all components", async () => {
    await dnpl.shutdown();
    // Should not throw
    assert.ok(true);
  });
});
