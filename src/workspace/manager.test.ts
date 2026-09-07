import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceManager } from "./manager.js";

test("WorkspaceManager create adds a workspace", () => {
  const manager = new WorkspaceManager();
  const result = manager.create("test-workspace", "/root/test");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.name, "test-workspace");
  assert.equal(result.data.root, "/root/test");
  assert.ok(result.data.id.startsWith("ws_"));
});

test("WorkspaceManager create rejects duplicates", () => {
  const manager = new WorkspaceManager();
  manager.create("test-workspace", "/root/test");
  const result = manager.create("test-workspace", "/root/other");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "workspace.duplicate");
});

test("WorkspaceManager get returns a workspace", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("my-ws", "/root/my");
  if (!created.ok) return;
  const result = manager.get(created.data.id);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.name, "my-ws");
});

test("WorkspaceManager get fails for unknown workspace", () => {
  const manager = new WorkspaceManager();
  const result = manager.get("nonexistent");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "workspace.not_found");
});

test("WorkspaceManager getAll returns all workspaces", () => {
  const manager = new WorkspaceManager();
  manager.create("ws1", "/root/1");
  manager.create("ws2", "/root/2");

  const all = manager.getAll();
  assert.equal(all.length, 2);
});

test("WorkspaceManager addRecentFile adds to recent files", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  const result = manager.addRecentFile(id, "/root/test/file.ts");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.recentFiles.length, 1);
  assert.equal(result.data.recentFiles[0], "/root/test/file.ts");
});

test("WorkspaceManager addRecentFile enforces max 20 limit", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  for (let i = 0; i < 25; i++) {
    manager.addRecentFile(id, `/root/test/file${i}.ts`);
  }

  const result = manager.get(id);
  if (!result.ok) return;
  assert.equal(result.data.recentFiles.length, 20);
  assert.equal(result.data.recentFiles[0], "/root/test/file24.ts");
});

test("WorkspaceManager addRecentFile deduplicates entries", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  manager.addRecentFile(id, "/root/test/a.ts");
  manager.addRecentFile(id, "/root/test/b.ts");
  manager.addRecentFile(id, "/root/test/a.ts");

  const result = manager.get(id);
  if (!result.ok) return;
  assert.equal(result.data.recentFiles.length, 2);
  assert.equal(result.data.recentFiles[0], "/root/test/a.ts");
});

test("WorkspaceManager addRecentFile fails for unknown workspace", () => {
  const manager = new WorkspaceManager();
  const result = manager.addRecentFile("nonexistent", "/file.ts");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "workspace.not_found");
});

test("WorkspaceManager updateLayout updates panel layout", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  const result = manager.updateLayout(id, { activeView: "terminal" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.panelLayout.activeView, "terminal");
});

test("WorkspaceManager updateLayout preserves existing panels", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  manager.updateLayout(id, { leftPanel: ["explorer", "search"] });
  const result = manager.updateLayout(id, { activeView: "terminal" });

  if (!result.ok) return;
  assert.equal(result.data.panelLayout.leftPanel.length, 2);
  assert.equal(result.data.panelLayout.activeView, "terminal");
});

test("WorkspaceManager delete removes a workspace", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  const deleteResult = manager.delete(id);
  assert.equal(deleteResult.ok, true);

  const getResult = manager.get(id);
  assert.equal(getResult.ok, false);
});

test("WorkspaceManager delete fails for unknown workspace", () => {
  const manager = new WorkspaceManager();
  const result = manager.delete("nonexistent");

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "workspace.not_found");
});

test("WorkspaceManager setActiveModel updates active model", () => {
  const manager = new WorkspaceManager();
  const created = manager.create("test", "/root/test");
  if (!created.ok) return;
  const id = created.data.id;

  const result = manager.setActiveModel(id, "gpt-4");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.activeModelId, "gpt-4");
});
