import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { now } from "../core/types.js";

export interface BackupFileRecord {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface QuackBackupManifest {
  readonly format: "quack-solo-backup-v1";
  /** Recovery payloads may contain private memory/database data and are not public exports. */
  readonly privacy?: "private-recovery";
  readonly createdAt: string;
  readonly sourceDataDirectory: string;
  readonly files: readonly BackupFileRecord[];
  readonly excludedSensitivePaths: readonly string[];
}

export interface BackupResult {
  readonly backupDirectory: string;
  readonly manifest: QuackBackupManifest;
}

export interface RestoreResult {
  readonly dataDirectory: string;
  readonly rollbackDirectory?: string;
  readonly restoredFiles: number;
}

export async function createQuackBackup(dataDirectory: string, destination: string): Promise<BackupResult> {
  const source = resolve(dataDirectory);
  const finalDestination = resolve(destination);
  if (source === finalDestination || contained(source, finalDestination)) throw new Error("Backup destination must be outside the QUACK data directory.");
  try { await stat(finalDestination); throw new Error("Backup destination already exists; choose a new directory."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const staging = `${finalDestination}.partial-${randomUUID()}`;
  const payload = join(staging, "payload");
  const files: BackupFileRecord[] = [];
  const excludedSensitivePaths: string[] = [];
  await mkdir(payload, { recursive: true });
  try {
    for (const path of await walk(source)) {
      const rel = relative(source, path);
      if (isSensitivePath(rel)) { excludedSensitivePaths.push(rel); continue; }
      const target = join(payload, rel);
      await mkdir(dirname(target), { recursive: true });
      const content = await backupContent(path);
      await writeFile(target, content);
      files.push({ path: rel, bytes: content.byteLength, sha256: digest(content) });
    }
    const manifest: QuackBackupManifest = {
      format: "quack-solo-backup-v1", privacy: "private-recovery", createdAt: now(), sourceDataDirectory: source,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
      excludedSensitivePaths: excludedSensitivePaths.sort(),
    };
    await writeFile(join(staging, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    await rename(staging, finalDestination);
    return { backupDirectory: finalDestination, manifest };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyQuackBackup(backupDirectory: string): Promise<QuackBackupManifest> {
  const root = resolve(backupDirectory);
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as QuackBackupManifest;
  if (manifest.format !== "quack-solo-backup-v1" || !Array.isArray(manifest.files)) throw new Error("Backup manifest format is unsupported.");
  for (const file of manifest.files) {
    const path = resolve(root, "payload", file.path);
    if (!contained(resolve(root, "payload"), path)) throw new Error(`Backup manifest path escapes payload: ${file.path}`);
    const content = await readFile(path);
    if (content.byteLength !== file.bytes || digest(content) !== file.sha256) throw new Error(`Backup integrity validation failed for ${file.path}.`);
  }
  return manifest;
}

export async function restoreQuackBackup(backupDirectory: string, dataDirectory: string): Promise<RestoreResult> {
  const manifest = await verifyQuackBackup(backupDirectory);
  const source = resolve(backupDirectory, "payload");
  const target = resolve(dataDirectory);
  const staging = `${target}.restore-${randomUUID()}`;
  const rollback = `${target}.rollback-${Date.now()}`;
  if (contained(resolve(backupDirectory), target) || contained(target, resolve(backupDirectory))) throw new Error("Restore target must not overlap the backup directory.");
  await mkdir(staging, { recursive: true });
  let movedExisting = false;
  try {
    for (const file of manifest.files) {
      const destination = resolve(staging, file.path);
      if (!contained(staging, destination)) throw new Error("Restore path escapes staging directory.");
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(resolve(source, file.path), destination);
    }
    try { await stat(target); await rename(target, rollback); movedExisting = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(staging, target);
    return { dataDirectory: target, rollbackDirectory: movedExisting ? rollback : undefined, restoredFiles: manifest.files.length };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (movedExisting) {
      await rm(target, { recursive: true, force: true });
      await rename(rollback, target);
    }
    throw error;
  }
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function backupContent(path: string): Promise<Buffer> {
  const content = await readFile(path);
  if (!path.toLowerCase().endsWith(".json")) return content;
  try { return Buffer.from(JSON.stringify(redactSecrets(JSON.parse(content.toString("utf8"))), null, 2), "utf8"); }
  catch { throw new Error("Backup cannot safely sanitize an invalid JSON file."); }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, isSecretName(key) ? "[REDACTED]" : redactSecrets(item)]));
}

function isSensitivePath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => isSecretName(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|\.netrc)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
}
function isSecretName(value: string): boolean { return /(secret|credential|password|api[_-]?key|token|private[_-]?key|authorization|cookie)/i.test(value); }
function digest(content: Buffer): string { return createHash("sha256").update(content).digest("hex"); }
function contained(root: string, target: string): boolean { const rel = relative(root, target); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); }
