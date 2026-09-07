import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { now } from "../core/types.js";

export type NetworkAccessMode = "DENY" | "ALLOW" | "ALLOWLIST" | "LOCAL_SERVICE" | "USER_APPROVAL";

export interface NetworkPolicyRule {
  readonly id: string;
  readonly mode: NetworkAccessMode;
  readonly purposes?: readonly string[];
  readonly requesters?: readonly string[];
  readonly hosts?: readonly string[];
  readonly ports?: readonly number[];
  readonly schemes?: readonly ("http:" | "https:")[];
}

export interface NetworkPolicyRequest {
  readonly url: string;
  readonly purpose: string;
  readonly requester: string;
}

export interface NetworkPolicyDecision {
  readonly timestamp: string;
  readonly allowed: boolean;
  readonly mode: NetworkAccessMode;
  readonly ruleId?: string;
  readonly url: string;
  readonly purpose: string;
  readonly requester: string;
  readonly resolvedAddresses: readonly string[];
  readonly reason: string;
}

export interface NetworkPolicyOptions {
  readonly rules?: readonly NetworkPolicyRule[];
  readonly defaultMode?: "DENY" | "ALLOW";
  readonly approve?: (request: NetworkPolicyRequest, target: URL) => Promise<boolean>;
  readonly audit?: (decision: NetworkPolicyDecision) => Promise<void> | void;
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
  readonly maxRedirects?: number;
}

/** Central default-deny outbound policy for untrusted tools and integrations. */
export class NetworkPolicyEngine {
  private readonly decisions: NetworkPolicyDecision[] = [];

  constructor(private readonly options: NetworkPolicyOptions = {}) {}

  async evaluate(request: NetworkPolicyRequest): Promise<NetworkPolicyDecision> {
    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      return this.record(request, "DENY", false, [], "URL is invalid.");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return this.record(request, "DENY", false, [], `Scheme ${target.protocol || "unknown"} is prohibited.`);
    }
    if (target.username || target.password) return this.record(request, "DENY", false, [], "Credentials in URLs are prohibited.");
    const hostname = normalizeHostname(target.hostname);
    if (METADATA_HOSTS.has(hostname)) return this.record(request, "DENY", false, [], "Cloud metadata endpoints are prohibited.");

    const rule = this.options.rules?.find((candidate) => ruleMatches(candidate, request, target));
    const mode = rule?.mode ?? this.options.defaultMode ?? "DENY";
    if (mode === "DENY") return this.record(request, mode, false, [], rule ? `Denied by rule ${rule.id}.` : "No outbound allow rule matched.", rule?.id);

    const addresses = await this.resolveAddresses(hostname);
    if (addresses.length === 0) return this.record(request, mode, false, [], "Hostname did not resolve.", rule?.id);
    const unsafe = addresses.find(isNonPublicAddress);
    if (unsafe && mode !== "LOCAL_SERVICE") {
      return this.record(request, mode, false, addresses, `Resolved address ${unsafe} is loopback, private, link-local, or reserved.`, rule?.id);
    }
    if (mode === "LOCAL_SERVICE") {
      if (!rule || !rule.hosts?.some((host) => hostMatches(host, hostname)) || !addresses.every(isLocalAddress)) {
        return this.record(request, mode, false, addresses, "Local services require an exact configured host and local-only resolution.", rule?.id);
      }
    }
    if (mode === "USER_APPROVAL") {
      const approved = await this.options.approve?.(request, target) ?? false;
      return this.record(request, mode, approved, addresses, approved ? "Owner approved outbound request." : "Owner approval was denied or unavailable.", rule?.id);
    }
    return this.record(request, mode, true, addresses, `Allowed by ${rule ? `rule ${rule.id}` : "default policy"}.`, rule?.id);
  }

  async fetch(request: NetworkPolicyRequest, init: RequestInit = {}): Promise<Response> {
    let current = request.url;
    const maximum = this.options.maxRedirects ?? 5;
    for (let redirect = 0; redirect <= maximum; redirect += 1) {
      const decision = await this.evaluate({ ...request, url: current });
      if (!decision.allowed) throw new Error(`Network policy denied request: ${decision.reason}`);
      const response = await fetch(current, { ...init, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location) return response;
      await response.body?.cancel();
      if (redirect === maximum) throw new Error(`Network redirect limit ${maximum} exceeded.`);
      const next = new URL(location, current);
      if (next.origin !== new URL(current).origin) throw new Error("Cross-origin redirects require a new explicitly authorized request.");
      current = next.toString();
    }
    throw new Error("Network redirect processing failed.");
  }

  recentDecisions(limit = 100): readonly NetworkPolicyDecision[] { return this.decisions.slice(-Math.max(0, limit)); }

  private async resolveAddresses(hostname: string): Promise<readonly string[]> {
    if (isIP(hostname)) return [hostname];
    try {
      if (this.options.resolve) return [...new Set(await this.options.resolve(hostname))];
      return [...new Set((await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address))];
    } catch {
      return [];
    }
  }

  private record(request: NetworkPolicyRequest, mode: NetworkAccessMode, allowed: boolean, addresses: readonly string[], reason: string, ruleId?: string): NetworkPolicyDecision {
    const decision: NetworkPolicyDecision = {
      timestamp: now(), allowed, mode, ruleId, url: sanitizeUrl(request.url), purpose: request.purpose,
      requester: request.requester, resolvedAddresses: addresses, reason,
    };
    this.decisions.push(decision);
    void this.options.audit?.(decision);
    return decision;
  }
}

export function isNonPublicAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (isLocalAddress(normalized)) return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31)
      || (a === 192 && b === 168) || a! >= 224 || (a === 100 && b! >= 64 && b! <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(normalized) === 6) {
    const compact = normalized.toLowerCase();
    return compact === "::" || compact.startsWith("fc") || compact.startsWith("fd") || /^fe[89ab]/.test(compact)
      || compact.startsWith("ff") || compact.startsWith("2001:db8:") || compact.startsWith("::ffff:");
  }
  return false;
}

function isLocalAddress(address: string): boolean {
  const normalized = normalizeHostname(address);
  return normalized === "127.0.0.1" || normalized.startsWith("127.") || normalized === "::1" || normalized === "localhost";
}

function ruleMatches(rule: NetworkPolicyRule, request: NetworkPolicyRequest, target: URL): boolean {
  if (rule.purposes && !rule.purposes.includes(request.purpose)) return false;
  if (rule.requesters && !rule.requesters.includes(request.requester)) return false;
  if (rule.schemes && !rule.schemes.includes(target.protocol as "http:" | "https:")) return false;
  if (rule.hosts && !rule.hosts.some((host) => hostMatches(host, normalizeHostname(target.hostname)))) return false;
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  return !rule.ports || rule.ports.includes(port);
}

function hostMatches(pattern: string, hostname: string): boolean {
  const normalized = normalizeHostname(pattern);
  if (normalized.startsWith("*.")) return hostname.endsWith(normalized.slice(1)) && hostname !== normalized.slice(2);
  return normalized === hostname;
}

function normalizeHostname(value: string): string { return value.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase(); }
function sanitizeUrl(value: string): string {
  try { const url = new URL(value); url.username = ""; url.password = ""; return url.toString(); } catch { return "[invalid-url]"; }
}

const METADATA_HOSTS = new Set(["169.254.169.254", "metadata.google.internal", "metadata.azure.internal"]);
