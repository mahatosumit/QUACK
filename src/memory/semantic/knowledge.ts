import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, resolve, sep } from "node:path";
import { fail, ok, type QuackResult } from "../../core/types.js";
import type { SemanticMemoryProvenance } from "./records.js";

/**
 * P9.26 governed knowledge sources (ADR 0043).
 *
 * Supported source kinds (explicitly bounded — no unrestricted crawling):
 *
 * - `inline`: caller-supplied text with explicit provenance identity.
 * - `file`: a workspace-local file, path-validated inside the configured
 *   workspace root (traversal outside the root fails closed).
 *
 * UNSUPPORTED (rejected, never silently attempted): URLs, remote
 * repositories, crawling, anything requiring network egress. Knowledge
 * ingestion flows through the SAME admission boundary as user memory —
 * there is no second ingestion path (P9.6).
 */

export type KnowledgeSourceRequest =
  | { readonly kind: "inline"; readonly text: string; readonly title?: string }
  | { readonly kind: "file"; readonly path: string };

export interface KnowledgeSourceResult {
  readonly content: string;
  readonly provenance: SemanticMemoryProvenance;
  readonly sourceLabel: string;
}

/** P9.28 knowledge-source bounds. */
export const KNOWLEDGE_SOURCE_BOUNDS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxInlineChars: 100_000,
} as const;

/**
 * Resolve one knowledge-source request into content + provenance. Pure
 * validation except the (bounded, root-guarded) file read. Every source
 * carries identity, and ingestion is governed upstream by admission.
 */
export async function resolveKnowledgeSource(
  request: KnowledgeSourceRequest,
  workspaceRoot: string,
): Promise<QuackResult<KnowledgeSourceResult>> {
  if (request.kind === "inline") {
    if (typeof request.text !== "string" || request.text.trim().length === 0) {
      return fail({ code: "knowledge.source_invalid", message: "inline knowledge requires non-empty text", category: "validation", recoverable: true });
    }
    if (request.text.length > KNOWLEDGE_SOURCE_BOUNDS.maxInlineChars) {
      return fail({ code: "knowledge.source_oversize", message: "inline knowledge exceeds the maximum length", category: "validation", recoverable: false });
    }
    return ok({
      content: request.text,
      provenance: { sourceKind: "user", sourceId: "inline", ...(request.title ? { sourceRef: request.title } : {}) },
      sourceLabel: request.title ?? "inline knowledge",
    });
  }
  if (request.kind === "file") {
    if (typeof request.path !== "string" || request.path.trim().length === 0) {
      return fail({ code: "knowledge.source_invalid", message: "file knowledge requires a path", category: "validation", recoverable: true });
    }
    const root = resolve(workspaceRoot);
    const absolute = resolve(root, isAbsolute(request.path) ? normalize(request.path) : request.path);
    // Path traversal guard: the resolved path must stay inside the root.
    if (absolute !== root && !absolute.startsWith(root + sep)) {
      return fail({ code: "knowledge.source_forbidden", message: "knowledge file must stay inside the workspace root", category: "permission", recoverable: false });
    }
    let content: string;
    try {
      const stat = await readFile(absolute);
      if (stat.byteLength > KNOWLEDGE_SOURCE_BOUNDS.maxFileBytes) {
        return fail({ code: "knowledge.source_oversize", message: "knowledge file exceeds the maximum size", category: "validation", recoverable: false });
      }
      content = stat.toString("utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return fail({ code: "knowledge.source_not_found", message: `knowledge file not found: ${request.path}`, category: "validation", recoverable: true });
      if (code === "EISDIR") return fail({ code: "knowledge.source_invalid", message: "knowledge source must be a file, not a directory", category: "validation", recoverable: true });
      return fail({ code: "knowledge.source_unreadable", message: "knowledge file could not be read", category: "runtime", recoverable: false });
    }
    if (content.trim().length === 0) {
      return fail({ code: "knowledge.source_invalid", message: "knowledge file is empty", category: "validation", recoverable: true });
    }
    return ok({
      content,
      provenance: { sourceKind: "file", sourceId: absolute, sourceRef: request.path },
      sourceLabel: request.path,
    });
  }
  return fail({ code: "knowledge.source_unsupported", message: `unsupported knowledge source kind ${String((request as { kind?: string }).kind)}`, category: "validation", recoverable: false });
}
