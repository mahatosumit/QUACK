import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type QuackConfig } from "../distributions/swe-config.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";

/**
 * Test-only system fixture. Each caller receives a separate workspace and
 * SQLite data directory, so Node's parallel test workers never share `.quack`.
 */
export async function createIsolatedQuackSystem(overrides: Partial<QuackConfig> = {}): Promise<{
  readonly system: QuackSystem;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "quack-system-test-"));
  const workspaceRoot = overrides.workspaceRoot ?? join(root, "workspace");
  const dataDir = overrides.dataDir ?? join(root, "data");
  await mkdir(workspaceRoot, { recursive: true });
  const system = await createQuackSystem({ ...overrides, workspaceRoot, dataDir });
  return { system, cleanup: async () => {
    await system.events.drain();
    await removeTestDirectory(root);
  } };
}

/** Windows can briefly retain directory entries after a child/database close. */
export async function removeTestDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
