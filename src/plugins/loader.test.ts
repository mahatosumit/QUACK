import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginLoader } from "./loader.js";

test("plugin modules require explicit host trust before they can initialize", async () => {
  const root = await mkdtemp(join(tmpdir(), "quack-plugin-trust-"));
  try {
    const entry = join(root, "untrusted.mjs");
    await writeFile(entry, 'throw new Error("module-initialized");');
    await assert.rejects(() => new PluginLoader().loadFromPath(entry), /trusted-host/);
    await assert.rejects(() => new PluginLoader().loadFromPackage("untrusted-package"), /trusted-host/);
    const trusted = join(root, "trusted.mjs");
    await writeFile(trusted, 'export const manifest = { id: "test.trusted" };');
    assert.equal((await new PluginLoader({ trust: "trusted-host" }).loadFromPath(trusted)).id, "test.trusted");
  } finally { await rm(root, { recursive: true, force: true }); }
});
