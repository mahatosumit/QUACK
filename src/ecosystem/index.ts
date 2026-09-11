/**
 * P10 Ecosystem / Marketplace foundation (ADR 0044) — public surface.
 *
 * UNTRUSTED EXTENSIONS NEVER BECOME TRUSTED AUTHORITY. The ecosystem layer
 * discovers, validates, verifies integrity, admits, installs, and
 * lifecycle-manages declarative packages; it grants nothing and executes
 * nothing. Actual capability authority remains exclusively with the
 * existing CapabilityBroker; runtime code contributions remain exclusively
 * with the existing in-process ExtensionRegistry and its governed
 * execution surfaces. No second policy engine, broker, runtime, event
 * system, or evaluator exists here.
 */
export {
  EXTENSION_KINDS,
  validateExtensionManifest,
  parseExtensionManifest,
  canonicalManifestForm,
  type ExtensionKind,
  type ExtensionVersion,
  type ExtensionDependencyDeclaration,
  type ExtensionPublisher,
  type ExtensionSourceProvenance,
  type ExtensionManifestV2,
  type ExtensionIntegrityDeclaration,
  type ManifestErrorCode,
  type ManifestRejection,
} from "./manifest.js";
export {
  packageDigest,
  manifestDigest,
  verifyPackageIntegrity,
  extensionTrustView,
  type ExtensionSignatureState,
  type ExtensionTrustView,
} from "./integrity.js";
export {
  EXTENSION_LIFECYCLE_STATES,
  validateLifecycleTransition,
  isTerminalState,
  isResolvableState,
  type ExtensionLifecycleState,
  type LifecycleTransition,
} from "./lifecycle.js";
export {
  ExtensionRegistryCatalog,
  ecosystemRegistryPath,
  orderRecords,
  parseRegistryRecord,
  type RegistryRecord,
  type RegistryErrorCode,
} from "./registry.js";
export {
  resolveDependencies,
  dependencyList,
  type ResolvedDependencyNode,
  type DependencyResolutionResult,
  type DependencyErrorCode,
} from "./resolution.js";
export {
  EcosystemService,
  type EcosystemServiceOptions,
  type EcosystemPackageInput,
  type InstalledExtensionView,
} from "./service.js";
export {
  scoreEcosystemQuality,
  type EcosystemQualityDimensions,
  type EcosystemEvaluationEvidence,
} from "./evaluation.js";
