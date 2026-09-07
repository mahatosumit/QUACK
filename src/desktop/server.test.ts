import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { DesktopServer } from "./server.js";
import { AgentRegistry, AgentCommunicationBus, OrganizationalMemory, AgentMetricsCollector, AgentLifecycleManager } from "../organization/index.js";
import { createDNPL } from "../platform/dnpl.js";

function createTestDesktopServer(options: ConstructorParameters<typeof DesktopServer>[0]): DesktopServer {
  return new DesktopServer({ ...options, authentication: false });
}

function createOrgManager(): AgentLifecycleManager {
  const registry = new AgentRegistry();
  const comms = new AgentCommunicationBus();
  const memory = new OrganizationalMemory();
  const metrics = new AgentMetricsCollector();
  const manager = new AgentLifecycleManager(registry, comms, memory, metrics);
  manager.spawnAllAgents();
  return manager;
}

describe("DesktopServer", () => {
  it("returns only vault metadata even to an authenticated local client", async () => {
    const dnpl = createDNPL();
    dnpl.vault.store("test-secret", "TEST_SECRET", "fixture-sensitive-value");
    const server = new DesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, dnpl, authToken: "fixture-session" });
    const port = await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/platform/secrets`, { headers: { Authorization: "Bearer fixture-session" } });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.doesNotMatch(body, /fixture-sensitive-value/);
      assert.doesNotMatch(body, /"value"\s*:/);
    } finally { await server.stop(); await dnpl.shutdown(); }
  });
  it("starts and stops on a random port", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    assert.ok(typeof port === "number" && port > 0);
    await server.stop();
  });

  it("returns 404 for unknown routes", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, "Not Found");
    await server.stop();
  });

  it("responds to health check", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.ok(typeof body.uptime === "number");
    await server.stop();
  });

  it("responds to version endpoint", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/version`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.version, "0.1.0");
    assert.equal(body.name, "QUACK Desktop");
    await server.stop();
  });

  it("responds to workspace endpoint", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test/workspace", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/workspace`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.root, "/test/workspace");
    assert.equal(body.dataDir, "/test/data");
    await server.stop();
  });

  it("OPTIONS returns 204 without permissive CORS", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/health`, { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    await server.stop();
  });

  it("getPort() matches listening port", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    assert.equal(server.getPort(), port);
    await server.stop();
  });

  it("requires local authentication by default and issues a strict UI session", async () => {
    const server = new DesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, authToken: "desktop-owner-token" });
    const port = await server.start();
    try {
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/version`)).status, 401);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/version`, { headers: { Authorization: "Bearer desktop-owner-token" } })).status, 200);
      const root = await fetch(`http://127.0.0.1:${port}/`);
      assert.match(root.headers.get("set-cookie") ?? "", /SameSite=Strict/i);
      assert.equal(root.headers.get("x-frame-options"), "DENY");
    } finally {
      await server.stop();
    }
  });

  it("rejects invalid port", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: -1 });
    await assert.rejects(() => server.start());
  });

  // ── Organization API Tests ──────────────────────────────────

  it("GET /api/agents returns all agents when org is configured", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/agents`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body.agents));
    assert.equal((body.agents as unknown[]).length, 18);
    await server.stop();
  });

  it("GET /api/agents returns 404 when org is not configured", async () => {
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0 });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/agents`);
    assert.equal(res.status, 404);
    await server.stop();
  });

  it("GET /api/agents/:id returns agent details when found", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const agentRes = await fetch(`http://localhost:${port}/api/agents`);
    const agentBody = await agentRes.json() as { agents: { id: string; role: string }[] };
    const agentId = agentBody.agents[0].id;

    const res = await fetch(`http://localhost:${port}/api/agents/${agentId}`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(body.agent);
    assert.ok(Array.isArray(body.assignments));
    await server.stop();
  });

  it("GET /api/agents/:id returns 404 for unknown agent", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/agents/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, "Agent not found");
    await server.stop();
  });

  it("GET /api/agents/health returns health check", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/agents/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body.healthy));
    assert.ok(Array.isArray(body.unhealthy));
    await server.stop();
  });

  it("GET /api/agents/bottlenecks returns bottlenecks", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/agents/bottlenecks`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body.bottlenecks));
    await server.stop();
  });

  it("GET /api/organization returns full org state", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/organization`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body.agents));
    assert.ok(Array.isArray(body.workflows));
    assert.ok(Array.isArray(body.assignments));
    assert.ok(body.memoryStats);
    await server.stop();
  });

  it("GET /api/workflows returns workflows", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/workflows`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body.workflows));
    await server.stop();
  });

  it("GET /api/workflows/:id returns 404 for unknown workflow", async () => {
    const manager = createOrgManager();
    const server = createTestDesktopServer({ workspaceRoot: "/test", dataDir: "/test/data", port: 0, organization: manager });
    const port = await server.start();
    const res = await fetch(`http://localhost:${port}/api/workflows/nonexistent`);
    assert.equal(res.status, 404);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, "Workflow not found");
    await server.stop();
  });
});
