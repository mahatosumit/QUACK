import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { QUACK_CONTRACT_VERSION, type ExecutionContextV1 } from "../contracts/index.js";
import { createSqliteStorage } from "../storage/sqlite.js";
import { removeTestDirectory } from "../test-support/isolated-system.js";
import { McpActionProvider } from "./mcp.js";
import { StdioMcpClient } from "./mcp-transports.js";
import { ActionProviderRegistry, ActionRuntime, type ActionAuditEvent } from "./runtime.js";

test("generic MCP provider performs approval-gated restart-safe actions", async () => {
  const dataDir = join(tmpdir(), createId("quack_real_mcp_action"));
  const target = join(dataDir, "safe-target.txt");
  const client = new StdioMcpClient({
    command: process.execPath,
    args: [join(process.cwd(), "dist", "actions", "fixtures", "mcp-stdio-server.js")],
    cwd: process.cwd(),
    allowedWorkingDirectories: [process.cwd()],
    environment: { QUACK_MCP_TEST_TARGET: target },
    profile: "RESTRICTED",
    versionNegotiation: "legacy",
    timeoutMs: 5_000,
  });
  const provider = new McpActionProvider({
    serverId: "mcp.generic-test", displayName: "Generic MCP Test", transport: "stdio", boundary: "local",
    defaultTimeoutMs: 200, maxOutputBytes: 1_000,
  }, client);
  const registry = new ActionProviderRegistry();
  registry.register(provider);
  const storage = createSqliteStorage(join(dataDir, "quack.sqlite"));
  const audits: ActionAuditEvent[] = [];
  const evidence: unknown[] = [];
  let approve = false;
  const dependencies = {
    ledger: storage.actionExecutions,
    decidePermission: async () => ({ allowed: true, reason: "test" }),
    requestApproval: async () => ({ approved: approve, actor: "owner", reason: approve ? "approved" : "rejected" }),
    audit: (event: ActionAuditEvent) => { audits.push(event); },
    recordEvidence: (record: unknown) => { evidence.push(record); },
  };
  const context: ExecutionContextV1 = { contractVersion: QUACK_CONTRACT_VERSION, missionId: "mcp-mission", taskId: "mcp-task", executionId: "read", actor: "test" };
  try {
    const actions = await provider.discoverActions(context);
    assert.equal(actions.some((action) => action.id === "mcp.generic-test:echo" && action.riskClass === "READ_ONLY"), true);
    assert.equal(actions.find((action) => action.id === "mcp.generic-test:safe_write")?.approval, "POLICY");

    const runtime = new ActionRuntime(registry, dependencies);
    const read = await runtime.execute("mcp.generic-test", { actionId: "mcp.generic-test:echo", input: { value: "hello" } }, context);
    assert.equal(read.status, "SUCCEEDED");
    assert.match(JSON.stringify(read.output), /hello/);

    const rejected = await runtime.execute("mcp.generic-test", {
      actionId: "mcp.generic-test:safe_write", input: { value: "one" }, idempotencyKey: "rejected-write",
    }, { ...context, executionId: "write-rejected" });
    assert.equal(rejected.status, "DENIED");
    await assert.rejects(() => readFile(target), /ENOENT/);

    approve = true;
    const request = { actionId: "mcp.generic-test:safe_write", input: { value: "one" }, idempotencyKey: "approved-write" } as const;
    const written = await runtime.execute("mcp.generic-test", request, { ...context, executionId: "write-approved" });
    assert.equal(written.status, "SUCCEEDED");
    const restarted = new ActionRuntime(registry, { ...dependencies, ledger: createSqliteStorage(join(dataDir, "quack.sqlite")).actionExecutions });
    const replay = await restarted.execute("mcp.generic-test", request, { ...context, executionId: "write-after-restart" });
    assert.deepEqual(replay, written);
    assert.equal((await readFile(target, "utf8")).trim().split(/\r?\n/).length, 1);

    const oversized = await runtime.execute("mcp.generic-test", { actionId: "mcp.generic-test:large", input: {} }, { ...context, executionId: "large" });
    assert.equal(oversized.status, "FAILED");
    assert.match(JSON.stringify(oversized.output), /size limit/i);
    const timedOut = await runtime.execute("mcp.generic-test", { actionId: "mcp.generic-test:slow", input: { milliseconds: 1_000 } }, { ...context, executionId: "timeout" });
    assert.equal(timedOut.status, "CANCELLED");
    assert.equal(audits.some((event) => event.phase === "APPROVED"), true);
    assert.equal(audits.some((event) => event.phase === "DENIED"), true);
    assert.ok(evidence.length >= 3);
  } finally {
    await provider.close();
    await removeTestDirectory(dataDir);
  }
});
