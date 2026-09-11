import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../events/event-bus.js";
import type { CapabilityBroker, CapabilityDecision } from "../security/capability-broker.js";
import { EcosystemService } from "./service.js";
import { validateExtensionManifest } from "./manifest.js";
import { manifestDigest, packageDigest, extensionTrustView } from "./integrity.js";
import { scoreEcosystemQuality } from "./evaluation.js";
import { EXTENSION_LIFECYCLE_STATES, validateLifecycleTransition, type ExtensionLifecycleState } from "./lifecycle.js";
import { resolveDependencies } from "./resolution.js";

/** P10 functional contract tests: happy paths + evaluation + vocabulary. */

function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "quack-ecosystem-"));
}

const allowBroker: CapabilityBroker = {
  async resolve(request): Promise<CapabilityDecision> {
    return { requestId: request.id, capabilityId: request.capabilityId, granted: true, reason: "test allow" };
  },
};

const CONTENT = "exports.run = () => 1;\n";

function validManifestObject(): Record<string, unknown> {
  return {
    id: "demo.tool",
    name: "Demo Tool",
    version: "1.2.3",
    kind: "tool",
    description: "A demo extension package.",
    quackContractVersion: "1.0.0",
    publisher: { name: "demo-publisher" },
    compatibleWith: "1.0.0",
    entry: "main.js",
    capabilities: ["filesystem.read"],
    dependencies: [],
    permissions: ["workspace.read"],
    integrity: { algorithm: "sha256", digest: packageDigest(CONTENT) },
  };
}

test("P10.2 valid manifest passes strict validation", () => {
  const result = validateExtensionManifest(validManifestObject());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.manifest.id, "demo.tool");
    assert.equal(result.data.manifest.publisher.signatureState, "UNSIGNED", "default signature state is honest");
  }
});

test("P10.3 trust view is honest: integrity matched, signature unverified", () => {
  const manifest = validateExtensionManifest(validManifestObject());
  assert.equal(manifest.ok, true);
  if (!manifest.ok) return;
  const view = extensionTrustView({ manifest: manifest.data.manifest, content: CONTENT });
  assert.equal(view.ok, true);
  if (view.ok) {
    assert.equal(view.data.trust.integrityState, "MATCHED");
    assert.equal(view.data.trust.signatureState, "UNSIGNED");
    assert.equal(view.data.trust.admissionState, "UNADMITTED");
  }
});

test("P10.10 lifecycle vocabulary + full legal state flow", () => {
  assert.deepEqual([...EXTENSION_LIFECYCLE_STATES], [
    "DISCOVERED", "VALIDATED", "ADMITTED", "INSTALLED", "ENABLED", "DISABLED", "QUARANTINED", "REMOVED",
  ]);
  const flow: readonly [ExtensionLifecycleState, ExtensionLifecycleState][] = [["DISCOVERED", "VALIDATED"], ["VALIDATED", "ADMITTED"], ["ADMITTED", "INSTALLED"], ["INSTALLED", "ENABLED"], ["ENABLED", "DISABLED"], ["DISABLED", "REMOVED"]];
  for (const [from, to] of flow) {
    assert.equal(validateLifecycleTransition(from, to).ok, true, `${from} -> ${to} legal`);
  }
});

test("P10.12 evaluation dimensions score from metadata-only evidence", () => {
  const manifestResult = validateExtensionManifest(validManifestObject());
  assert.equal(manifestResult.ok, true);
  if (!manifestResult.ok) return;
  const evidence = {
    records: [{
      id: "demo.tool", version: "1.2.3", manifest: manifestResult.data.manifest,
      manifestDigest: manifestDigest(manifestResult.data.manifest),
      packageDigest: packageDigest(CONTENT),
      lifecycle: "INSTALLED" as const,
      provenance: { kind: "local-path", sourceId: "/tmp/demo" },
      signatureState: "UNSIGNED" as const,
      installedAt: "2026-09-11T00:00:00.000Z",
    }],
    registeredVersions: { "demo.tool": ["1.2.3"] },
  };
  const { dimensions } = scoreEcosystemQuality(evidence);
  assert.equal(dimensions.manifestIntegrity, 100);
  assert.equal(dimensions.provenanceCompleteness, 100);
  assert.equal(dimensions.lifecycleCorrectness, 100);
  assert.equal(dimensions.dependencyCorrectness, 100);
  // Empty evidence stays at the honest empty baseline.
  const empty = scoreEcosystemQuality({ records: [], registeredVersions: {} });
  assert.equal(empty.dimensions.manifestIntegrity, 100, "no records -> nothing broken");
});

test("P10.4/P10.5 full install flow: validate -> resolve -> register -> lifecycle -> remove", async (context) => {
  const dir = await scratch();
  context.after(async () => rm(dir, { recursive: true, force: true }));
  const events = new EventBus();
  const service = new EcosystemService({ dataDir: dir, events, broker: allowBroker, actor: "operator" });
  await service.ensureLayout();
  const packDir = join(dir, "demo-tool");
  await mkdir(packDir, { recursive: true });
  await writeFile(join(packDir, "manifest.json"), JSON.stringify(validManifestObject(), null, 2), "utf8");
  await writeFile(join(packDir, "main.js"), CONTENT, "utf8");
  const installed = await service.install({ manifestPath: join(packDir, "manifest.json"), contentPath: join(packDir, "main.js") });
  assert.equal(installed.ok, true, "install succeeds");
  if (!installed.ok) return;
  assert.equal(installed.data.record.lifecycle, "INSTALLED");
  assert.equal(installed.data.record.manifestDigest, manifestDigest(installed.data.record.manifest));
  // Enable -> disable -> remove through explicit transitions.
  assert.equal((await service.enable("demo.tool", "1.2.3")).ok, true);
  assert.equal((await service.disable("demo.tool", "1.2.3")).ok, true);
  assert.equal((await service.remove("demo.tool", "1.2.3")).ok, true);
  assert.equal((await service.list()).length, 0, "removed cleanly");
  // Inspect after removal fails closed.
  const gone = await service.inspect("demo.tool", "1.2.3");
  assert.equal(gone.ok, false);
});

test("P10.6 dependency resolution returns dependencies-before-dependents order", () => {
  const lib = validateExtensionManifest({ ...validManifestObject(), id: "demo.lib", version: "1.0.0", dependencies: [] });
  const app = validateExtensionManifest({ ...validManifestObject(), id: "demo.app", version: "1.0.0", dependencies: [{ id: "demo.lib", version: "1.0.0" }] });
  assert.equal(lib.ok && app.ok, true);
  if (!lib.ok || !app.ok) return;
  const available = new Map([["demo.lib", [lib.data.manifest]], ["demo.app", [app.data.manifest]]]);
  const result = resolveDependencies(app.data.manifest, available);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.data.order.map((node) => node.id), ["demo.lib", "demo.app"], "dependency before dependent");
  }
});
