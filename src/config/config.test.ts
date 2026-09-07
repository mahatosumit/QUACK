import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createDefaultConfig } from "./config.js";

describe("createDefaultConfig", () => {
  it("returns a config object", () => {
    const config = createDefaultConfig();
    assert.ok(config);
    assert.equal(typeof config, "object");
  });

  it("has all required properties", () => {
    const config = createDefaultConfig();
    assert.ok("workspaceRoot" in config);
    assert.ok("dataDir" in config);
    assert.ok("permissions" in config);
  });

  it("does not discover persistent runtime state by default", () => {
    const config = createDefaultConfig();
    assert.equal(config.dataDir, undefined);
  });

  it("workspaceRoot defaults to process.cwd()", () => {
    const config = createDefaultConfig();
    assert.equal(config.workspaceRoot, process.cwd());
  });

  it("merges user-supplied overrides", () => {
    const root = "/custom/root";
    const data = "/custom/data";
    const config = createDefaultConfig({ workspaceRoot: root, dataDir: data });
    assert.equal(config.workspaceRoot, resolve(root));
    assert.equal(config.dataDir, resolve(data));
  });

  it("uses default permissions when none provided", () => {
    const config = createDefaultConfig();
    assert.deepEqual(config.permissions, []);
  });
});
