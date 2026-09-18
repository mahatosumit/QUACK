import { createHash } from "node:crypto";
import { fail, ok, type QuackResult } from "../core/types.js";
import { canonicalManifestForm, type ExtensionManifestV2 } from "./manifest.js";

/**
 * P10.3/P10.9 extension trust + integrity foundation (ADR 0044).
 *
 * Integrity is CONTENT ADDRESSING, not trust: a matching sha256 proves the
 * bytes are the bytes — nothing more. Publisher identity is DATA until
 * independently verified; P10 deliberately represents signature state as
 * UNSIGNED / UNVERIFIED and implements NO signature verification. A digest
 * match must never be read as "trusted publisher".
 *
 * No new crypto: sha256 via node:crypto, canonical serialization from the
 * manifest contract. Deterministic — same input, same digest, always.
 */

/** Honest verification vocabulary. VERIFIED does not exist in P10. */
export type ExtensionSignatureState = "UNSIGNED" | "UNVERIFIED";

/** Trust view of a package: everything here is host-computed or explicitly unverified. */
export interface ExtensionTrustView {
  readonly integrityState: "MATCHED" | "MISMATCHED" | "UNVERIFIED";
  readonly signatureState: ExtensionSignatureState;
  readonly admissionState: "UNADMITTED" | "ADMITTED" | "REJECTED";
}

/** Package content digest over the canonical byte stream. */
export function packageDigest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Manifest digest over the canonical manifest representation. */
export function manifestDigest(manifest: ExtensionManifestV2): string {
  return createHash("sha256").update(canonicalManifestForm(manifest), "utf8").digest("hex");
}

/**
 * Verify package content against a declared integrity digest.
 * Fail-closed: any mismatch is `MISMATCHED`, never coerced.
 */
export function verifyPackageIntegrity(
  declared: { readonly algorithm: "sha256"; readonly digest: string },
  content: string,
): QuackResult<{ readonly state: "MATCHED" }> {
  if (declared.algorithm !== "sha256") {
    return fail({ code: "extension.integrity_unsupported_algorithm", message: "Only sha256 integrity is supported.", category: "validation", recoverable: false });
  }
  const actual = packageDigest(content);
  if (actual !== declared.digest) {
    return fail({
      code: "extension.integrity_mismatch",
      message: "Package content does not match the declared digest.",
      category: "validation",
      recoverable: false,
      context: { declared: declared.digest, actual },
    });
  }
  return ok({ state: "MATCHED" });
}

/**
 * Trust view for a package. The host computes integrity; signature honesty
 * is structural (UNSIGNED stays UNSIGNED — no API can upgrade it).
 */
export function extensionTrustView(input: {
  readonly manifest: ExtensionManifestV2;
  readonly content: string;
}): QuackResult<{ readonly trust: ExtensionTrustView }> {
  const integrity = verifyPackageIntegrity(input.manifest.integrity, input.content);
  if (!integrity.ok) return integrity as QuackResult<{ readonly trust: ExtensionTrustView }>;
  return ok({
    trust: {
      integrityState: "MATCHED",
      signatureState: input.manifest.publisher.signatureState,
      admissionState: "UNADMITTED",
    },
  });
}
