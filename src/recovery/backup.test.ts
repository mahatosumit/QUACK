import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackBackup, restoreQuackBackup, verifyQuackBackup } from "./backup.js";

test("backup excludes secret files, redacts JSON secrets, and restores atomically", async () => {
  const root = join(tmpdir(), createId("quack_backup_test"));
  const data = join(root, "data"); const backup = join(root, "backup"); const restored = join(root, "restored");
  try {
    await mkdir(data, { recursive: true });
    await writeFile(join(data, "quack.sqlite"), "database");
    await writeFile(join(data, "settings.json"), JSON.stringify({ theme: "dark", apiKey: "must-not-leak", headers: { Authorization: "must-not-leak", Cookie: "must-not-leak" } }));
    await writeFile(join(data, "credentials.json"), JSON.stringify({ token: "must-not-leak" }));
    await writeFile(join(data, ".env.local"), "PRIVATE_VALUE=must-not-leak");
    const created = await createQuackBackup(data, backup);
    assert.equal(created.manifest.files.some((file) => file.path === "quack.sqlite"), true);
    assert.equal(created.manifest.excludedSensitivePaths.includes("credentials.json"), true);
    assert.equal(created.manifest.excludedSensitivePaths.includes(".env.local"), true);
    assert.equal(created.manifest.privacy, "private-recovery");
    assert.doesNotMatch(await readFile(join(backup, "payload", "settings.json"), "utf8"), /must-not-leak/);
    await assert.rejects(() => restoreQuackBackup(backup, join(backup, "nested")), /overlap/i);
    await mkdir(restored, { recursive: true });
    await writeFile(join(backup, "payload", "unlisted.txt"), "unverified-data");
    await writeFile(join(restored, "old.txt"), "old");
    const result = await restoreQuackBackup(backup, restored);
    assert.equal(await readFile(join(restored, "quack.sqlite"), "utf8"), "database");
    assert.ok(result.rollbackDirectory);
    await assert.rejects(() => readFile(join(restored, "unlisted.txt")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed JSON is not copied past backup sanitization", async () => {
  const root = join(tmpdir(), createId("quack_backup_invalid_json"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "settings.json"), '{"apiKey":"fixture-sensitive"');
    await assert.rejects(() => createQuackBackup(join(root, "data"), join(root, "backup")), /sanitize/i);
    await assert.rejects(() => readFile(join(root, "backup", "manifest.json")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("corrupt backup is rejected before live data is replaced", async () => {
  const root = join(tmpdir(), createId("quack_backup_corrupt"));
  const data = join(root, "data"); const backup = join(root, "backup"); const live = join(root, "live");
  try {
    await mkdir(data, { recursive: true }); await writeFile(join(data, "quack.sqlite"), "valid");
    await createQuackBackup(data, backup);
    await writeFile(join(backup, "payload", "quack.sqlite"), "tampered");
    await mkdir(live, { recursive: true }); await writeFile(join(live, "keep.txt"), "untouched");
    await assert.rejects(() => verifyQuackBackup(backup), /integrity/i);
    await assert.rejects(() => restoreQuackBackup(backup, live), /integrity/i);
    assert.equal(await readFile(join(live, "keep.txt"), "utf8"), "untouched");
  } finally { await rm(root, { recursive: true, force: true }); }
});
