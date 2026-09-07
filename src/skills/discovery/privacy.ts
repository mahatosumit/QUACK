import type { JsonObject } from "../../core/types.js";

/**
 * QUACK PrivacyFirewall (ADR 0041).
 *
 * The only path through which locally discovered skill metadata may reach a
 * model. Raw local metadata passes: classification → redaction → policy
 * evaluation → safe metadata. Default policy is DENY for sensitive classes;
 * nothing leaves the firewall unless the classifier proves it safe. The
 * firewall NEVER forwards raw file contents from discovery — only skill
 * manifests and declared metadata.
 */

export type SensitiveDataClass =
  | "CREDENTIAL"
  | "SECRET"
  | "TOKEN"
  | "PASSWORD"
  | "PRIVATE_KEY"
  | "PERSONAL_DOCUMENT"
  | "PERSONAL_COMMUNICATION"
  | "FINANCIAL_DATA"
  | "HEALTH_DATA"
  | "IDENTITY_DATA"
  | "BROWSER_SESSION"
  | "AUTH_COOKIE"
  | "PRIVATE_REPOSITORY_DATA"
  | "ENVIRONMENT_SECRET";

export type PrivacyDecision = "ALLOW" | "REDACT" | "DENY";

export interface ClassifiedMatch {
  readonly dataClass: SensitiveDataClass;
  readonly matchedPattern: string;
}

export interface PrivacyResult {
  readonly decision: PrivacyDecision;
  readonly safe: JsonObject;
  readonly matches: readonly ClassifiedMatch[];
  /** Never populated with content — only class names, for audit. */
  readonly audit: { readonly dataClasses: readonly SensitiveDataClass[]; readonly evaluatedAt: string };
}

const PATTERNS: ReadonlyArray<{ readonly dataClass: SensitiveDataClass; readonly pattern: RegExp }> = [
  { dataClass: "PRIVATE_KEY", pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { dataClass: "PASSWORD", pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/i },
  { dataClass: "TOKEN", pattern: /(?:api[_-]?key|token|bearer)\s*[:=]\s*\S+/i },
  { dataClass: "SECRET", pattern: /(?:secret|client[_-]?secret)\s*[:=]\s*\S+/i },
  { dataClass: "ENVIRONMENT_SECRET", pattern: /\b[A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD)\b/ },
  { dataClass: "AUTH_COOKIE", pattern: /\b(?:session[_-]?id|auth[_-]?cookie|remember[_-]?token)\b/i },
  { dataClass: "BROWSER_SESSION", pattern: /cookies\.sqlite|login\.data|webdata\.db|places\.sqlite/i },
];

/**
 * Secret-shaped VALUES, independent of key syntax: a string field whose
 * content looks like a modern credential must be redacted even when the
 * manifest spells the key as `apiKey` with no `=` syntax.
 */
const SECRET_VALUE_PATTERNS: ReadonlyArray<{ readonly dataClass: SensitiveDataClass; readonly pattern: RegExp }> = [
  { dataClass: "TOKEN", pattern: /^(?:sk|pk|rk)_[A-Za-z0-9_-]{16,}$/ },
  { dataClass: "TOKEN", pattern: /^gh[pousr]_[A-Za-z0-9]{20,}$/ },
  { dataClass: "TOKEN", pattern: /^AKIA[0-9A-Z]{12,}$/ },
  { dataClass: "TOKEN", pattern: /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { dataClass: "SECRET", pattern: /^[A-Za-z0-9+\/=]{32,}$/ },
  { dataClass: "PRIVATE_KEY", pattern: /^-----BEGIN/ },
];

/** Field names that mark a value as sensitive regardless of value shape. */
const SENSITIVE_FIELD_NAMES: readonly RegExp[] = [
  /^(?:api[_-]?key|apikey)$/i,
  /^(?:client[_-]?secret|secret|password|passwd|pwd|token|bearer)$/i,
  /(?:[_-]api[_-]?key|[_-]secret|[_-]password|[_-]token)$/i,
];

/** Filename patterns that indicate a file that must never be ingested by discovery. */
export const FORBIDDEN_FILENAME_PATTERNS: readonly RegExp[] = [
  /\.env$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /cookies?\.sqlite$/i,
  /kdbx?$/i,                       // password databases
  /known_hosts$/i,
  /\.aws\//i,
  /\.ssh\//i,
  /\.git-credentials$/i,
  /history$/i,
  /wallet\.dat$/i,
];

/** Directories discovery must never enter, even under an approved root. */
export const FORBIDDEN_DIRECTORY_NAMES: readonly string[] = [
  ".ssh", ".gnupg", ".aws", ".azure", ".gcloud", ".kube",
  "AppData", "Library", "Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music",
  "Maildir", ".mozilla", ".config/google-chrome", ".git",
];

export class PrivacyFirewall {
  /**
   * Classify a text fragment. Content patterns, secret-shaped values, and
   * sensitive field names are all checked. Skill instructions and file
   * content found during discovery must be classified before anything is
   * stored or forwarded.
   */
  classify(text: string, fieldName?: string): readonly ClassifiedMatch[] {
    const matches: ClassifiedMatch[] = [];
    for (const { dataClass, pattern } of PATTERNS) {
      if (pattern.test(text)) matches.push({ dataClass, matchedPattern: pattern.source });
    }
    if (fieldName !== undefined) {
      for (const namePattern of SENSITIVE_FIELD_NAMES) {
        if (namePattern.test(fieldName)) {
          matches.push({ dataClass: "SECRET", matchedPattern: `field:${namePattern.source}` });
          break;
        }
      }
    }
    for (const { dataClass, pattern } of SECRET_VALUE_PATTERNS) {
      if (pattern.test(text.trim())) {
        matches.push({ dataClass, matchedPattern: `value:${pattern.source}` });
        break;
      }
    }
    return matches;
  }

  /**
   * Evaluate metadata against the default-DENY policy. Any text field that
   * matches a sensitive class is redacted (or the whole record denied when
   * the class is CREDENTIAL/PRIVATE_KEY/BROWSER_SESSION). The result is the
   * only shape allowed to reach a model.
   */
  evaluate(metadata: JsonObject): PrivacyResult {
    const matches: ClassifiedMatch[] = [];
    const safe = redactObject(metadata, this, matches);
    const hardDeny = matches.some(match =>
      match.dataClass === "PRIVATE_KEY" || match.dataClass === "BROWSER_SESSION" || match.dataClass === "PASSWORD");
    const decision: PrivacyDecision = hardDeny ? "DENY" : matches.length > 0 ? "REDACT" : "ALLOW";
    return {
      decision,
      safe,
      matches,
      audit: { dataClasses: [...new Set(matches.map(match => match.dataClass))], evaluatedAt: new Date().toISOString() },
    };
  }

  /** A filename that must never be read by discovery. */
  isForbiddenFilename(name: string): boolean {
    return FORBIDDEN_FILENAME_PATTERNS.some(pattern => pattern.test(name));
  }

  /** A directory discovery must never descend into. */
  isForbiddenDirectory(name: string): boolean {
    return FORBIDDEN_DIRECTORY_NAMES.includes(name);
  }
}

function redactObject(value: JsonObject, firewall: PrivacyFirewall, matches: ClassifiedMatch[]): JsonObject {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      const found = firewall.classify(entry, key);
      if (found.length > 0) {
        matches.push(...found);
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = entry;
    } else if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      result[key] = redactObject(entry as JsonObject, firewall, matches);
    } else {
      result[key] = entry === undefined ? null : entry;
    }
  }
  return result as JsonObject;
}