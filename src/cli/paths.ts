/**
 * QUACK home-directory resolution (Phase 6 first-run model).
 *
 * Resolution order: QUACK_HOME env var > per-OS user home. The CLI's
 * persistent state (config, data, logs, skills, cache) lives under one
 * home so a new user never depends on the working directory, while
 * mission workspaces remain CWD-scoped by design.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

/** QUACK_HOME env override: non-empty, resolved to an absolute path. */
export function quackHome(): string {
  const override = process.env["QUACK_HOME"];
  if (override && override.trim()) {
    const resolved = resolve(override);
    if (!resolved) throw new Error("QUACK_HOME is not a valid path.");
    return resolved;
  }
  return join(homedir(), ".quack");
}

export interface QuackHomeLayout {
  readonly root: string;
  readonly config: string;
  readonly data: string;
  readonly logs: string;
  readonly skills: string;
  readonly cache: string;
  readonly models: string;
  readonly runtime: string;
}

/** Canonical subdirectory layout created by `quack init`. */
export function quackHomeLayout(root: string = quackHome()): QuackHomeLayout {
  return {
    root,
    config: join(root, "config"),
    data: join(root, "data"),
    logs: join(root, "logs"),
    skills: join(root, "skills"),
    cache: join(root, "cache"),
    models: join(root, "models"),
    runtime: join(root, "runtime"),
  };
}

/** Create the full home layout (idempotent). Returns the layout. */
export function ensureQuackHome(root: string = quackHome()): QuackHomeLayout {
  const layout = quackHomeLayout(root);
  for (const dir of [layout.root, layout.config, layout.data, layout.logs,
    layout.skills, layout.cache, layout.models, layout.runtime]) {
    mkdirSync(dir, { recursive: true });
  }
  return layout;
}
