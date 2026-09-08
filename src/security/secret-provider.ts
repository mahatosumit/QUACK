/**
 * SecretProvider — the single authority for reading provider credentials.
 *
 * Rules (Phase 7A contract):
 *   - Secret NAMES are allowlisted per consumer; a consumer may only ask for
 *     names it declared (provider credential env var names).
 *   - Values are resolved by the provider layer, never printed, never logged.
 *   - Every resolution requires `secrets.read:${name}` authority through the
 *     CapabilityBroker; denial fails closed.
 *   - Only presence checks ("is it set?") are exposed to UI layers so
 *     `quack provider doctor` can report configuration state without
 *     ever touching the value.
 */
import { fail, ok, type QuackResult } from "../core/types.js";
import type { CapabilityBroker, CapabilityRequest } from "./capability-broker.js";
import { capabilityIdForPermission } from "./capability-broker.js";
import { createId } from "../core/types.js";

/** A named secret a consumer is allowed to request. */
export interface SecretDescriptor {
  /** Secret name, e.g. "NVIDIA_API_KEY". */
  readonly name: string;
  /** Human description, safe to print. */
  readonly description: string;
  /** Consumer allowed to resolve this secret (e.g. "provider.nvidia-nim"). */
  readonly consumer: string;
}

export interface SecretResolution {
  readonly name: string;
  readonly present: boolean;
  /** Value only for broker-authorized consumers; never log or print this. */
  readonly value?: string;
}

export interface SecretProvider {
  /** Report which allowlisted secrets exist, without reading values. */
  presence(consumer: string): ReadonlyArray<SecretDescriptor & { readonly present: boolean }>;
  /** Resolve a secret value for a consumer. Requires broker authority. */
  resolve(name: string, consumer: string, context: { readonly missionId?: string; readonly actor: string }): Promise<QuackResult<SecretResolution>>;
}

/** Allowlisted provider credential secrets. */
export const PROVIDER_SECRET_DESCRIPTORS: readonly SecretDescriptor[] = [
  { name: "NVIDIA_API_KEY", description: "NVIDIA NIM API credential", consumer: "provider.nvidia-nim" },
  { name: "QUACK_OPENAI_API_KEY", description: "OpenAI-compatible API credential", consumer: "provider.openai-compatible" },
  { name: "QUACK_VLLM_API_KEY", description: "vLLM API credential", consumer: "provider.vllm" },
  { name: "ANTHROPIC_API_KEY", description: "Anthropic API credential", consumer: "provider.anthropic" },
];

/**
 * Environment-backed SecretProvider. Reads only allowlisted names, one at a
 * time, gated by the CapabilityBroker with `secrets.read:${name}`. This is
 * the ONLY layer permitted to read provider credential env vars; provider
 * adapters receive resolved values through constructor config.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  constructor(private readonly broker?: CapabilityBroker) {}

  presence(consumer: string): ReadonlyArray<SecretDescriptor & { readonly present: boolean }> {
    return PROVIDER_SECRET_DESCRIPTORS
      .filter(descriptor => descriptor.consumer === consumer)
      .map(descriptor => ({ ...descriptor, present: Boolean(process.env[descriptor.name]) }));
  }

  async resolve(name: string, consumer: string, context: { readonly missionId?: string; readonly actor: string }): Promise<QuackResult<SecretResolution>> {
    const descriptor = PROVIDER_SECRET_DESCRIPTORS.find(entry => entry.name === name);
    if (!descriptor) {
      return fail({
        code: "secrets.not_allowlisted",
        message: `Secret ${name} is not in the provider credential allowlist.`,
        category: "permission",
        recoverable: false,
      });
    }
    if (descriptor.consumer !== consumer) {
      return fail({
        code: "secrets.consumer_mismatch",
        message: `Secret ${name} is not allowlisted for consumer ${consumer}.`,
        category: "permission",
        recoverable: false,
      });
    }
    const raw = process.env[name];
    if (typeof raw !== "string" || !raw.trim()) {
      return ok({ name, present: false });
    }
    if (this.broker) {
      const request: CapabilityRequest = {
        id: createId("capability"),
        missionId: context.missionId,
        actor: context.actor,
        capabilityId: capabilityIdForPermission(`secrets.read:${name}`),
        permission: `secrets.read:${name}`,
        action: "IRREVERSIBLE_ACTION",
        resource: { kind: "secrets", id: name },
        reason: `${consumer} resolving its declared credential ${name}.`,
      };
      const decision = await this.broker.resolve(request);
      if (!decision.granted) {
        return fail({
          code: "secrets.authority_denied",
          message: `Capability broker denied reading ${name}: ${decision.reason}`,
          category: "permission",
          recoverable: false,
        });
      }
    }
    return ok({ name, present: true, value: raw });
  }
}

/** Redacts allowlisted secret names AND secret-shaped values from text. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const descriptor of PROVIDER_SECRET_DESCRIPTORS) {
    // Redact any value that follows the secret name (env dump style).
    result = result.replace(new RegExp(`${descriptor.name}\\s*[:=]\\s*\\S+`, "g"), `${descriptor.name}=[REDACTED]`);
  }
  // Redact bearer tokens and long high-entropy assignments.
  result = result.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]");
  // Redact bare provider-shaped key literals (OpenAI sk-…, GitHub ghp_…,
  // AWS AKIA…, NVIDIA nvapi-…) wherever they appear, not just after '='.
  result = result.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
  result = result.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "[REDACTED]");
  result = result.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]");
  result = result.replace(/\bnvapi-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
  // Any word containing KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL (as a whole word
  // or compound like MY_API_TOKEN) followed by an assignment with a
  // substantial value.
  result = result.replace(/\b[A-Za-z0-9_]*(?:key|token|secret|password|credential)\b\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, (match) => {
    const name = match.split(/\s*[:=]/)[0];
    return `${name}=[REDACTED]`;
  });
  return result;
}

/**
 * Synchronous boot-time credential read INSIDE the security layer.
 * System construction is synchronous, so `EnvironmentSecretProvider.resolve`
 * (async, broker-gated for runtime consumers) cannot be used before the
 * broker exists. This helper enforces the same allowlist + consumer binding
 * and is the ONLY sanctioned non-async credential access in the codebase;
 * callers receive the raw value solely for provider-adapter constructor
 * config. Values are never returned for a mismatched consumer or a
 * non-allowlisted name.
 */
export function readProviderCredentialForBoot(name: string, consumer: string): string | undefined {
  const descriptor = PROVIDER_SECRET_DESCRIPTORS.find(entry => entry.name === name);
  if (!descriptor || descriptor.consumer !== consumer) return undefined;
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim() ? raw : undefined;
}
