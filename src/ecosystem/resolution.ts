import { fail, ok, type QuackResult } from "../core/types.js";
import type { ExtensionDependencyDeclaration, ExtensionManifestV2 } from "./manifest.js";

/**
 * P10.6 deterministic dependency resolution (ADR 0044).
 *
 * Exact-version constraints only (the manifest contract enforces this).
 * Resolution is a deterministic graph walk over locally-known manifests:
 *   - no network
 *   - no "latest"
 *   - cycle detection fails closed
 *   - conflict (two requirers demanding different exact versions of the
 *     same dependency) fails closed
 *   - missing dependency fails closed
 *   - insertion order never decides the result
 */

export interface ResolvedDependencyNode {
  readonly id: string;
  readonly version: string;
  readonly manifest: ExtensionManifestV2;
  /** Path from the root extension to this node (deterministic, sorted). */
  readonly path: readonly string[];
}

export interface DependencyResolutionResult {
  /** Deterministic install order: dependencies before dependents, ties by id. */
  readonly order: readonly ResolvedDependencyNode[];
  /** All manifests participating in the resolution. */
  readonly manifests: readonly ExtensionManifestV2[];
}

export type DependencyErrorCode =
  | "extension.dependency_missing"
  | "extension.dependency_version_conflict"
  | "extension.dependency_cycle";

/**
 * Resolve the full dependency closure for one root manifest against a
 * local lookup of candidate manifests (id -> available manifests).
 * Deterministic: visiting order is sorted by id, and the returned order
 * is a stable topological sequence.
 */
export function resolveDependencies(
  root: ExtensionManifestV2,
  available: ReadonlyMap<string, readonly ExtensionManifestV2[]>,
): QuackResult<DependencyResolutionResult> {
  const resolved = new Map<string, ExtensionManifestV2>();
  const order: ResolvedDependencyNode[] = [];
  const visiting = new Set<string>();
  const versions = new Map<string, Map<string, readonly string[]>>();

  const visit = (manifest: ExtensionManifestV2, path: readonly string[]): QuackResult<void> => {
    const key = `${manifest.id}@${manifest.version}`;
    if (resolved.has(key)) return ok(undefined);
    if (visiting.has(key)) {
      return fail({ code: "extension.dependency_cycle", message: `Dependency cycle detected at ${key} (path: ${path.join(" -> ")}).`, category: "validation", recoverable: false });
    }
    visiting.add(key);
    // Deterministic: dependencies visited in sorted id order.
    const dependencies = [...manifest.dependencies].sort((a, b) => a.id.localeCompare(b.id));
    for (const dependency of dependencies) {
      const candidates = available.get(dependency.id) ?? [];
      const match = candidates.find((candidate) => candidate.version === dependency.version);
      if (!match) {
        return fail({ code: "extension.dependency_missing", message: `Dependency ${dependency.id}@${dependency.version} is not available locally.`, category: "validation", recoverable: false });
      }
      // Conflict detection: any other requirer needing a different exact version of the same id.
      const required = versions.get(dependency.id) ?? new Map<string, readonly string[]>();
      for (const [existingVersion, requirers] of required) {
        if (existingVersion !== dependency.version) {
          return fail({
            code: "extension.dependency_version_conflict",
            message: `Dependency ${dependency.id} requires both ${existingVersion} (required by ${requirers.join(", ")}) and ${dependency.version} (required by ${manifest.id}).`,
            category: "validation",
            recoverable: false,
          });
        }
      }
      required.set(dependency.version, [...(required.get(dependency.version) ?? []), manifest.id].sort());
      versions.set(dependency.id, required);
      const child = visit(match, [...path, `${dependency.id}@${dependency.version}`]);
      if (!child.ok) return child;
    }
    visiting.delete(key);
    resolved.set(key, manifest);
    order.push({ id: manifest.id, version: manifest.version, manifest, path });
    return ok(undefined);
  };

  const result = visit(root, [`${root.id}@${root.version}`]);
  if (!result.ok) return result as QuackResult<DependencyResolutionResult>;
  // Stable output: dependencies appear before dependents (post-order push),
  // and the manifest list is sorted by identity.
  return ok({
    order: Object.freeze(order),
    manifests: Object.freeze([...order].map((node) => node.manifest)),
  });
}

/** Convenience for callers holding plain dependency lists. */
export function dependencyList(manifest: ExtensionManifestV2): readonly ExtensionDependencyDeclaration[] {
  return [...manifest.dependencies].sort((a, b) => a.id.localeCompare(b.id));
}
