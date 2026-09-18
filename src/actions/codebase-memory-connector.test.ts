import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodebaseMemoryMcpConnector } from "./codebase-memory-connector.js";

test("CodebaseMemoryMcpConnector lists code-intelligence tools", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-mcp-test-"));
  const connector = new CodebaseMemoryMcpConnector({ workspaceRoot: dataDir });

  const health = await connector.health();
  assert.equal(health.healthy, true);

  const tools = await connector.listTools();
  assert.equal(tools.length, 4);
  assert.ok(tools.some(t => t.name === "codebase.search_symbols"));
  assert.ok(tools.some(t => t.name === "codebase.analyze_impact"));

  await connector.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("CodebaseMemoryMcpConnector executes symbol search cleanly", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-mcp-test-"));
  const connector = new CodebaseMemoryMcpConnector({ workspaceRoot: dataDir });

  const result = await connector.callTool("codebase.search_symbols", { query: "CapabilityBroker" });
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent);
  assert.equal(result.structuredContent["query"], "capabilitybroker");

  await connector.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("CodebaseMemoryMcpConnector enforces path containment and rejects workspace escapes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "quack-mcp-test-"));
  const connector = new CodebaseMemoryMcpConnector({ workspaceRoot: dataDir });

  await assert.rejects(
    () => connector.callTool("codebase.inspect_architecture", { path: "../../Windows/System32" }),
    /Workspace escape denied/
  );

  await connector.close();
  await rm(dataDir, { recursive: true, force: true });
});
