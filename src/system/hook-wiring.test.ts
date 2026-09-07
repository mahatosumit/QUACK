import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuackSystem } from "./create-system.js";
import { QUACK_CONTRACT_VERSION } from "../contracts/v1/contracts.js";
import type { ExtensionDefinition } from "../extensions/types.js";
import type { QuackConfig } from "../config/config.js";

test("admitted plugin hooks fire on canonical runtime events through governed authority", async t => {
  const dir = await mkdtemp(join(tmpdir(), "quack-hookwire-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const observed: string[] = [];
  const extension: ExtensionDefinition = {
    manifest: { id: "fixture.hookpack", version: "1.0.0", contractVersion: QUACK_CONTRACT_VERSION },
    contributions: {
      tools: [{
        id: "fixture.tick",
        describe: () => ({ id: "fixture.tick", name: "Tick", description: "Fires a governed event", permissions: [] }),
        execute: async () => ({ output: { tick: true } }),
      }],
      plugins: [{
        manifest: { id: "fixture.observer-plugin", version: "1.0.0", name: "Observer", quackApiVersion: QUACK_CONTRACT_VERSION,
          type: "tool", entry: "fixture-entry", capabilities: ["fixture.observe"], permissions: [] },
        hooks: [
          { kind: "tool", handler: () => { observed.push("tool"); } },
          { kind: "mission", handler: () => { observed.push("mission"); } },
        ],
      }],
    },
  };
  const system = createQuackSystem({ dataDir: join(dir, "state"), extensions: [extension] } as Partial<QuackConfig>);
  t.after(() => system.hookBridge.stop());

  // Emit canonical events directly; the bridge must dispatch matching hooks.
  await system.events.emit("tool.requested", { toolId: "fixture.tick" }, { taskId: "task-1", actor: "observer" });
  await system.events.emit("task.started", { taskId: "task-1" }, { taskId: "task-1", actor: "runtime" });

  assert.deepEqual(observed.sort(), ["mission", "tool"]);
  const records = system.hookBridge.listRecords();
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.status === "EXECUTED"));
  assert.equal(records[0].pluginId, "fixture.observer-plugin");

  system.hookBridge.stop();
  await system.events.emit("task.completed", { summary: "done" }, { taskId: "task-1" });
  assert.equal(system.hookBridge.listRecords().length, 2);
});