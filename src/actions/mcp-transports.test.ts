import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import { NetworkPolicyEngine } from "../security/network-policy.js";
import { StdioMcpClient, StreamableHttpMcpClient, buildMcpEnvironment } from "./mcp-transports.js";

test("stdio MCP uses the official transport with a minimal environment", async () => {
  const client = new StdioMcpClient({
    command: process.execPath,
    args: [fileURLToPath(new URL("./fixtures/mcp-stdio-server.js", import.meta.url))],
    cwd: process.cwd(),
    allowedWorkingDirectories: [process.cwd()],
    profile: "RESTRICTED",
    versionNegotiation: "legacy",
    timeoutMs: 5_000,
  });
  try {
    assert.equal((await client.health()).healthy, true);
    assert.equal((await client.listTools())[0]?.name, "echo");
    const result = await client.callTool("echo", { value: "hello" });
    assert.match(JSON.stringify(result.content), /hello/);
  } finally {
    await client.close();
  }
});

test("MCP rejects unsupported isolation even when a launcher label is supplied", () => {
  for (const isolation of [undefined, "container", "restricted-process"] as const) {
    assert.throws(() => new StdioMcpClient({ command: process.execPath, cwd: process.cwd(), profile: "ISOLATED", isolation }), /isolation launcher/i);
  }
});

test("stdio MCP never inherits common secret variables without an explicit grant", () => {
  const previous = process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_API_KEY = "must-not-leak";
  try {
    const environment = buildMcpEnvironment();
    assert.equal(environment["NVIDIA_API_KEY"], undefined);
    assert.throws(() => buildMcpEnvironment({ GITHUB_TOKEN: "test" }), /not explicitly granted/i);
    assert.equal(buildMcpEnvironment({ GITHUB_TOKEN: "test" }, ["GITHUB_TOKEN"])["GITHUB_TOKEN"], "test");
  } finally {
    if (previous === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previous;
  }
});

test("Streamable HTTP MCP is mediated by central network policy", async () => {
  const mcp = new McpServer({ name: "quack-test-http", version: "1.0.0" });
  mcp.registerTool("status", {
    description: "Return status",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async () => ({ content: [{ type: "text", text: "ok" }] }));
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await mcp.connect(transport);
  const server = createServer((request, response) => { void transport.handleRequest(request, response); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP MCP test server did not bind.");
  const endpoint = `http://127.0.0.1:${address.port}/mcp`;
  const policy = new NetworkPolicyEngine({
    rules: [{ id: "test-mcp", mode: "LOCAL_SERVICE", purposes: ["mcp.http"], requesters: ["mcp.test"], hosts: ["127.0.0.1"], ports: [address.port], schemes: ["http:"] }],
  });
  const client = new StreamableHttpMcpClient({
    url: endpoint,
    networkPolicy: policy,
    requesterId: "mcp.test",
    versionNegotiation: "legacy",
    timeoutMs: 5_000,
  });
  try {
    assert.equal((await client.health()).healthy, true);
    assert.equal((await client.listTools())[0]?.name, "status");
    assert.match(JSON.stringify((await client.callTool("status", {})).content), /ok/);
    assert.equal(policy.recentDecisions().every((decision) => decision.allowed), true);
  } finally {
    await client.close();
    await mcp.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
