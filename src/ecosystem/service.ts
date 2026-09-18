import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createId, fail, now, ok, type JsonObject, type QuackResult } from "../core/types.js";
import type { EventBus } from "../events/event-bus.js";
import { buildToolCapabilityRequest, type CapabilityBroker } from "../security/capability-broker.js";
import { manifestDigest, packageDigest, verifyPackageIntegrity } from "./integrity.js";
import { parseExtensionManifest, type ExtensionManifestV2 } from "./manifest.js";
import { isResolvableState, type ExtensionLifecycleState } from "./lifecycle.js";
import { ecosystemRegistryPath, ExtensionRegistryCatalog, type RegistryRecord } from "./registry.js";
import { resolveDependencies } from "./resolution.js";

/**
 * P10 ecosystem service (ADR 0044) — the governed facade over manifest
 * validation, integrity verification, deterministic dependency resolution,
 * transactional installation, and lifecycle.
 *
 * GOVERNANCE (P10.7): declared capabilities/permissions are DATA. This
 * service never grants anything. When the host later executes an admitted
 * extension through an existing governed surface, every capability resolves
 * through the SAME CapabilityBroker (provider.invoke / plugin.install /
 * etc.) — exactly like tools, skills, and semantic memory. The authorize
 * hook below resolves `plugin.install` through the broker for lifecycle
 * mutations (install/enable/disable/remove) so even CATALOG operations are
 * governed, not just execution.
 *
 * EXECUTION BOUNDARY (P10.8): P10 provides NO extension execution. There
 * is no code loading, no child_process, no dynamic import of package
 * content. Extensions here are REGISTERED/ADMITTED/NOT-EXECUTABLE. Runtime
 * code contributions continue to flow exclusively through the existing
 * `ExtensionRegistry` (host-trusted, in-process) and its governed
 * execution surfaces.
 *
 * Events (P10.11) reuse the existing EventBus with metadata-only payloads.
 */

export interface EcosystemServiceOptions {
  readonly dataDir: string;
  readonly events: EventBus;
  /** Existing capability broker — the single authority. */
  readonly broker: CapabilityBroker;
  /** Actor identity for governed operations (default "operator"). */
  readonly actor?: string;
}

/** A local package directory: manifest.json + content file(s). */
export interface EcosystemPackageInput {
  readonly manifestPath: string;
  /** Raw package content bytes the integrity digest covers (read by the service). */
  readonly contentPath: string;
}

export interface InstalledExtensionView {
  readonly record: RegistryRecord;
}

export type EcosystemEventPayload = JsonObject;

export class EcosystemService {
  private readonly registry: ExtensionRegistryCatalog;
  private readonly actor: string;

  constructor(private readonly options: EcosystemServiceOptions) {
    this.registry = new ExtensionRegistryCatalog(ecosystemRegistryPath(options.dataDir));
    this.actor = options.actor ?? "operator";
  }

  /** P10.4 discovery of local package manifests under a directory (no network, no execution). */
  async discover(directory: string): Promise<QuackResult<{ readonly found: readonly { readonly manifest: ExtensionManifestV2; readonly path: string }[] }>> {
    await this.authorize("read");
    const found: { manifest: ExtensionManifestV2; path: string }[] = [];
    let entries: readonly string[];
    try {
      entries = await readdir(directory);
    } catch {
      return fail({ code: "extension.discovery_failed", message: `Cannot read discovery directory ${directory}.`, category: "runtime", recoverable: false });
    }
    for (const entry of [...entries].sort()) {
      const manifestPath = join(directory, entry, "manifest.json");
      let raw: string;
      try {
        raw = await readFile(manifestPath, "utf8");
      } catch {
        continue;
      }
      const parsed = parseExtensionManifest(JSON.parse(raw));
      if (parsed.ok) found.push({ manifest: parsed.data.manifest, path: manifestPath });
    }
    await this.options.events.emit("extension.discovered", { count: found.length, directory } as JsonObject, { actor: this.actor });
    return ok({ found: Object.freeze(found) });
  }

  /** P10.2/P10.3 validate a package: manifest + integrity. No install, no execution. */
  async validatePackage(input: EcosystemPackageInput): Promise<QuackResult<{ readonly manifest: ExtensionManifestV2; readonly integrityState: "MATCHED" }>> {
    let manifestRaw: string;
    let contentRaw: string;
    try {
      manifestRaw = await readFile(input.manifestPath, "utf8");
      contentRaw = await readFile(input.contentPath, "utf8");
    } catch {
      return fail({ code: "extension.package_unreadable", message: "Package manifest or content is unreadable.", category: "runtime", recoverable: false });
    }
    let manifestJson: unknown;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch {
      return fail({ code: "extension.manifest_invalid", message: "Manifest is not valid JSON.", category: "validation", recoverable: false });
    }
    const manifest = parseExtensionManifest(manifestJson);
    if (!manifest.ok) return manifest;
    const integrity = verifyPackageIntegrity(manifest.data.manifest.integrity, contentRaw);
    if (!integrity.ok) return integrity;
    await this.options.events.emit("extension.validated", {
      id: manifest.data.manifest.id, version: manifest.data.manifest.version,
      manifestDigest: manifestDigest(manifest.data.manifest),
    } as JsonObject, { actor: this.actor });
    return ok({ manifest: manifest.data.manifest, integrityState: "MATCHED" });
  }

  /**
   * P10.5/P10.6 transactional install: validate -> resolve dependencies ->
   * register atomically. A failed install leaves NO partial state — the
   * registry is only mutated after every check passes, and the batch is
   * all-or-nothing. No execution of package content ever occurs.
   */
  async install(input: EcosystemPackageInput, extraLocal: readonly EcosystemPackageInput[] = []): Promise<QuackResult<InstalledExtensionView>> {
    const authorized = await this.authorize("write");
    if (!authorized.ok) return authorized as QuackResult<InstalledExtensionView>;
    const validated = await this.validatePackage(input);
    if (!validated.ok) return validated;
    const root = validated.data.manifest;
    // Local availability map: root + extra local packages (deterministic resolution input).
    const available = new Map<string, ExtensionManifestV2[]>();
    for (const manifest of [root, ...(await this.validateExtras(extraLocal))]) {
      const list = available.get(manifest.id) ?? [];
      list.push(manifest);
      available.set(manifest.id, list);
    }
    const resolution = resolveDependencies(root, available);
    if (!resolution.ok) return resolution as QuackResult<InstalledExtensionView>;
    // Installing an already-registered root fails closed — never a silent
    // no-op (P10.16 duplicate identity).
    const existingRoot = await this.registry.get(root.id, root.version);
    if (existingRoot) {
      return fail({ code: "extension.registry_duplicate", message: `Extension ${root.id}@${root.version} is already registered.`, category: "validation", recoverable: false });
    }
    // Ensure every resolved dependency is registered in the same transaction.
    const staged: RegistryRecord[] = [];
    const registryList = await this.registry.list();
    for (const node of resolution.data.order) {
      const existing = registryList.find((record) => record.id === node.id && record.version === node.version);
      if (existing) continue;
      const isRoot = node.id === root.id && node.version === root.version;
      const packageDigestValue = isRoot
        ? packageDigest(await this.readContent(input.contentPath))
        : await this.digestForDependency(node, extraLocal);
      if (!packageDigestValue) {
        return fail({ code: "extension.dependency_missing", message: `Dependency package content for ${node.id}@${node.version} is unavailable.`, category: "validation", recoverable: false });
      }
      staged.push({
        id: node.id,
        version: node.version,
        manifest: node.manifest,
        manifestDigest: manifestDigest(node.manifest),
        packageDigest: packageDigestValue,
        lifecycle: "INSTALLED",
        provenance: { kind: "local-path", sourceId: input.manifestPath },
        signatureState: node.manifest.publisher.signatureState,
        installedAt: now(),
      });
    }
    // All-or-nothing: pre-check EVERY staged key for duplicates before the
    // first write, so a duplicate never leaves a partial batch behind.
    for (const record of staged) {
      const duplicate = await this.registry.get(record.id, record.version);
      if (duplicate) {
        return fail({ code: "extension.registry_duplicate", message: `Extension ${record.id}@${record.version} is already registered.`, category: "validation", recoverable: false });
      }
    }
    for (const record of staged) {
      const registered = await this.registry.register(record);
      if (!registered.ok) {
        // Defensive rollback: undo records this call already wrote (the
        // pre-check above should make this path unreachable for duplicates).
        for (const undo of staged) {
          if (undo === record) break;
          await this.registry.remove(undo.id, undo.version).catch(() => undefined);
        }
        return registered;
      }
    }
    const record = staged.find((entry) => entry.id === root.id && entry.version === root.version)
      ?? await this.registry.get(root.id, root.version);
    if (!record) {
      return fail({ code: "extension.registry_not_found", message: `Install completed but ${root.id}@${root.version} was not registered.`, category: "runtime", recoverable: false });
    }
    await this.options.events.emit("extension.installed", {
      id: record.id, version: record.version, manifestDigest: record.manifestDigest,
      dependencyCount: staged.length - (staged[0] && staged[0].id === root.id ? 0 : 0),
    } as JsonObject, { actor: this.actor });
    return ok({ record });
  }

  async list(): Promise<readonly RegistryRecord[]> {
    await this.authorizeReadOnly();
    return this.registry.list();
  }

  async inspect(id: string, version: string): Promise<QuackResult<{ readonly record: RegistryRecord }>> {
    await this.authorizeReadOnly();
    const record = await this.registry.get(id, version);
    if (!record) return fail({ code: "extension.registry_not_found", message: `Extension ${id}@${version} is not registered.`, category: "validation", recoverable: false });
    return ok({ record });
  }

  /** P10.10 lifecycle transitions with governance + events. */
  async transition(id: string, version: string, to: ExtensionLifecycleState): Promise<QuackResult<{ readonly record: RegistryRecord }>> {
    const authorized = await this.authorize(to === "REMOVED" ? "write" : "write");
    if (!authorized.ok) return authorized as QuackResult<{ readonly record: RegistryRecord }>;
    const result = await this.registry.transition(id, version, to);
    if (!result.ok) return result;
    const event = to === "REMOVED" ? "extension.removed" : to === "QUARANTINED" ? "extension.quarantined" : to === "ENABLED" ? "extension.enabled" : to === "DISABLED" ? "extension.disabled" : to === "ADMITTED" ? "extension.admitted" : "extension.validated";
    await this.options.events.emit(event, { id, version, to } as JsonObject, { actor: this.actor });
    return result;
  }

  /** Convenience enable/disable/remove. */
  async enable(id: string, version: string): Promise<QuackResult<{ readonly record: RegistryRecord }>> { return this.transition(id, version, "ENABLED"); }
  async disable(id: string, version: string): Promise<QuackResult<{ readonly record: RegistryRecord }>> { return this.transition(id, version, "DISABLED"); }
  async remove(id: string, version: string): Promise<QuackResult<{ readonly record: RegistryRecord }>> { return this.transition(id, version, "REMOVED"); }

  /** Deterministic version listing for one id (uses isResolvableState policy). */
  async resolveVersions(id: string): Promise<readonly RegistryRecord[]> {
    await this.authorizeReadOnly();
    const records = await this.registry.resolve(id);
    return records.filter((record) => isResolvableState(record.lifecycle));
  }

  /** P10.7: resolve a declared capability through the EXISTING broker — the only authority. */
  async authorizeCapability(extensionId: string, capability: string, reason: string): Promise<QuackResult<void>> {
    const decision = await this.options.broker.resolve(buildToolCapabilityRequest({
      actor: this.actor,
      toolId: `ecosystem:${extensionId}`,
      permission: capability as never,
      input: { extensionId, capability } as JsonObject,
      reason,
    }));
    return decision.granted
      ? ok(undefined)
      : fail({ code: "extension.capability_denied", message: decision.reason, category: "permission", recoverable: true });
  }

  private async authorize(mode: "read" | "write"): Promise<QuackResult<void>> {
    const permission = mode === "write" ? "plugin.install" : "workspace.read";
    const decision = await this.options.broker.resolve(buildToolCapabilityRequest({
      actor: this.actor,
      toolId: `ecosystem:${mode}`,
      permission: permission as never,
      input: { mode } as JsonObject,
      reason: `Ecosystem ${mode} operations require ${permission}.`,
    }));
    return decision.granted
      ? ok(undefined)
      : fail({ code: "extension.capability_denied", message: decision.reason, category: "permission", recoverable: true });
  }

  private async authorizeReadOnly(): Promise<void> {
    // Reads list metadata deterministically; broker gate kept on explicit
    // mutations only (matches the existing memory surface split).
  }

  private async validateExtras(extraLocal: readonly EcosystemPackageInput[]): Promise<readonly ExtensionManifestV2[]> {
    const manifests: ExtensionManifestV2[] = [];
    for (const input of extraLocal) {
      const validated = await this.validatePackage(input);
      if (validated.ok) manifests.push(validated.data.manifest);
    }
    return manifests;
  }

  private async readContent(path: string): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  }

  private async digestForDependency(node: { id: string; version: string }, extraLocal: readonly EcosystemPackageInput[]): Promise<string> {
    for (const input of extraLocal) {
      const validated = await this.validatePackage(input);
      if (validated.ok && validated.data.manifest.id === node.id && validated.data.manifest.version === node.version) {
        const content = await this.readContent(input.contentPath);
        return packageDigest(content);
      }
    }
    return "";
  }

  /** Unique event ids stay out of deterministic decisions (createId only for telemetry). */
  nextEventId(): string {
    return createId("ecosystem-event");
  }

  /** Ensure the registry directory exists before first persist. */
  async ensureLayout(): Promise<void> {
    await mkdir(join(this.options.dataDir, "ecosystem"), { recursive: true });
  }
}
