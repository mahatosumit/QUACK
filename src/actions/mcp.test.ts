import assert from "node:assert/strict";
import test from "node:test";
import { QUACK_CONTRACT_VERSION, type ExecutionContextV1 } from "../contracts/index.js";
import { ActionProviderRegistry } from "./runtime.js";
import { McpActionProvider, McpServerRegistry, type McpClientTransport } from "./mcp.js";

const context: ExecutionContextV1 = {
  contractVersion: QUACK_CONTRACT_VERSION,
  missionId: "mission",
  taskId: "task",
  executionId: "execution",
  actor: "test",
};

test("MCP tools normalize to conservative action risk and permissions", async () => {
  const provider = new McpActionProvider({ serverId: "mcp.test", displayName: "Test", transport: "stdio", boundary: "local" }, new FakeMcpClient());
  const actions = await provider.discoverActions(context);
  assert.equal(actions.length, 2);
  const read = actions.find((action) => action.id.endsWith(":read_file"))!;
  const write = actions.find((action) => action.id.endsWith(":send_message"))!;
  assert.equal(read.riskClass, "READ_ONLY");
  assert.equal(read.approval, "NEVER");
  assert.equal(write.riskClass, "EXTERNAL_COMMUNICATION");
  assert.equal(write.approval, "POLICY");
  assert.ok(write.requiredPermissions.includes("mcp.execute"));
});

test("MCP registry enable disable and removal update action registry", async () => {
  const actions = new ActionProviderRegistry();
  const servers = new McpServerRegistry(actions);
  const provider = new McpActionProvider({ serverId: "mcp.test", displayName: "Test", transport: "stdio", boundary: "local" }, new FakeMcpClient());
  servers.register(provider);
  assert.equal(actions.get("mcp.test"), provider);
  assert.equal(servers.disable("mcp.test"), true);
  assert.deepEqual(await provider.discoverActions(context), []);
  assert.equal(servers.enable("mcp.test"), true);
  assert.equal((await provider.discoverActions(context)).length, 2);
  assert.equal(await servers.remove("mcp.test"), true);
  assert.equal(actions.get("mcp.test"), undefined);
});

test("MCP registry manages start stop health and restart lifecycle", async () => {
  const client = new FakeMcpClient();
  const server = new McpActionProvider({ serverId: "mcp.test", displayName: "Test", transport: "stdio", boundary: "local" }, client);
  const registry = new McpServerRegistry();
  registry.register(server);
  assert.equal((await registry.start("mcp.test")).status, "HEALTHY");
  assert.equal(await registry.stop("mcp.test"), true);
  assert.equal((await registry.health("mcp.test")).status, "OFFLINE");
  assert.equal((await registry.restart("mcp.test")).status, "HEALTHY");
});

test("MCP adapter rejects oversized tool output", async () => {
  const provider = new McpActionProvider({ serverId: "mcp.test", displayName: "Test", transport: "stdio", boundary: "local", maxOutputBytes: 10 }, new FakeMcpClient());
  const result = await provider.execute({ actionId: "mcp.test:read_file", input: { path: "a" } }, context);
  assert.equal(result.status, "FAILED");
  assert.match(String(result.output?.["error"]), /size limit/);
});

class FakeMcpClient implements McpClientTransport {
  async health() { return { healthy: true }; }
  async listTools() {
    return [
      { name: "read_file", description: "Read", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "send_message", description: "Send", inputSchema: { type: "object" }, annotations: { openWorldHint: true, idempotentHint: false } },
    ];
  }
  async callTool() { return { content: [{ text: "a deliberately long response" }] }; }
}
