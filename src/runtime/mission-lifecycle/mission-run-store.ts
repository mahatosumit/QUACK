import { mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMissingFile, atomicWriteFile } from "../../core/utils.js";
import type { LoopRun } from "./executive-loop.js";
import type { MissionRunStore } from "./governed-mission-loop.js";

/**
 * P11 (ADR 0045): durable governed-mission run records. One JSON file per
 * mission under `<dataDir>/governed-missions/`, written through the same
 * atomic-write + validation-on-load pattern as the checkpoint store. This
 * is a RECORD store (audit + idempotent replay), NOT a mid-run resume
 * mechanism: resuming revalidates state and relies on the action ledger's
 * idempotency dedupe so an already-completed action is never re-executed.
 * Fail-closed parse: malformed or duplicate records throw on load — a
 * corrupted store is surfaced, never silently coerced.
 */
export class JsonFileMissionRunStore implements MissionRunStore {
  private readonly writeQueue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, LoopRun>();

  constructor(private readonly dataDir: string) {}

  async save(run: LoopRun): Promise<void> {
    const snapshot = structuredClone(run);
    this.cache.set(run.missionId, snapshot);
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath(run.missionId)), { recursive: true });
      await atomicWriteFile(this.filePath(run.missionId), JSON.stringify({ version: 1, run: snapshot }, null, 2) + "\n");
    });
    // Queue continues even if one write fails; the caller's save() surfaces
    // its own error. Cache keeps the in-memory truth for this process.
    void operation.then(() => undefined, () => undefined);
    await operation;
  }

  async load(missionId: string): Promise<LoopRun | undefined> {
    const cached = this.cache.get(missionId);
    if (cached) return structuredClone(cached);
    let raw: string;
    try {
      raw = await readFile(this.filePath(missionId), "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Invalid governed-mission run record for ${missionId}.`);
    }
    const envelope = parsed as { readonly version?: unknown; readonly run?: unknown };
    if (envelope.version !== 1 || typeof envelope.run !== "object" || envelope.run === null) {
      throw new Error(`Invalid governed-mission run envelope for ${missionId}.`);
    }
    const run = envelope.run as LoopRun;
    if (typeof run.missionId !== "string" || run.missionId !== missionId) {
      throw new Error(`Governed-mission run identity mismatch for ${missionId}.`);
    }
    this.cache.set(missionId, structuredClone(run));
    return structuredClone(run);
  }

  async list(): Promise<readonly LoopRun[]> {
    // Directory-enumerating: a fresh process (CLI status, server surface)
    // must see records persisted by earlier processes. Cache entries win
    // over stale files for ids this process already saved/loaded.
    const directory = join(this.dataDir, "governed-missions");
    let files: readonly string[] = [];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
    const runs: LoopRun[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const missionId = file.slice(0, -".json".length);
      const cached = this.cache.get(missionId);
      if (cached) { runs.push(structuredClone(cached)); continue; }
      const run = await this.load(missionId).catch(() => undefined);
      if (run) runs.push(run);
    }
    return runs.sort((a, b) => a.missionId.localeCompare(b.missionId));
  }

  private filePath(missionId: string): string {
    // Mission ids are validated by the loop; defensive encoding here keeps
    // the record namespace flat and traversal-free.
    const safe = missionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.dataDir, "governed-missions", `${safe}.json`);
  }
}
