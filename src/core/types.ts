/** A primitive value representable in JSON. */
export type JsonPrimitive = string | number | boolean | null;
/** A valid JSON value — primitive, object, or array. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

/** A generic JSON object with string keys and {@link JsonValue} values. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** An ISO-8601 timestamp string (e.g. `"2026-01-01T00:00:00.000Z"`). */
export type IsoTimestamp = string;

/** A structured error value returned inside a {@link QuackResult}. */
export interface QuackError {
  /** Machine-readable error code (e.g. `"provider.not_found"`). */
  readonly code: string;
  /** Human-readable error description. */
  readonly message: string;
  /** The category this error belongs to. */
  readonly category: "validation" | "permission" | "runtime" | "provider" | "tool" | "plugin";
  /** Whether the operation can be retried. */
  readonly recoverable: boolean;
  /** Optional contextual payload. */
  readonly context?: JsonObject;
}

/** A discriminated union representing a success (`ok: true`) or failure (`ok: false`). */
export type QuackResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: QuackError };

/** Returns the current time as an ISO-8601 string. */
export function now(): IsoTimestamp {
  return new Date().toISOString();
}

/** Generates a unique ID with the given `prefix` using timestamp + random entropy. */
export function createId(prefix: string): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${entropy}`;
}

/** Wraps a value in a success {@link QuackResult}. */
export function ok<T>(data: T): QuackResult<T> {
  return { ok: true, data };
}

/** Wraps an error in a failure {@link QuackResult}. */
export function fail<T = never>(error: QuackError): QuackResult<T> {
  return { ok: false, error };
}

export function errorToJson(error: QuackError): JsonObject {
  return {
    code: error.code,
    message: error.message,
    category: error.category,
    recoverable: error.recoverable,
    context: error.context ?? null,
  };
}
