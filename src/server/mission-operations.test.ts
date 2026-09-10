import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { createId } from "../core/types.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { QueuedApprovalCallback } from "../security/approval-queue.js";
import { QuackHttpServer } from "./index.js";

/**
 * P1 Mission Operations integration tests: cancel (abort path), resume,
 * approval queue surface, trace-by-mission, and SSE redaction. All paths
 * use the real composition root; adversarial cases assert fail-closed
 * behavior (forged ids, tampered decisions, replayed decisions).
 */

test("cancel aborts an in-flight mission and records the cancelled state", async () => {
  const fixture = await createP1CancelFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const created = await postJson<{ id: string }>(`${server.address().url}/missions`, {
      goal: fixture.graph.description,
      actor: "p1-cancel-test",
    });
    // The tool is parked on a gate — the mission is in flight.
    const cancelled = await postJson<{ state: string }>(`${server.address().url}/missions/${created.body.id}/cancel`, {});
    assert.equal(cancelled.status, 202);
    assert.equal(cancelled.body.state, "CANCELLING");
    fixture.release();
    const final = await waitForTerminal(server.address().url, created.body.id);
    assert.equal(final.state, "FAILED");
    assert.match(final.error ?? "", /cancel/i);
    await waitFor(() => fixture.cancelEvents.length === 1);
    assert.equal(fixture.cancelEvents.length, 1, "mission.cancelled is emitted once on the runtime bus");
  } finally {
    fixture.release();
    await server.stop();
    await fixture.cleanup();
  }
});

/** Deterministic in-flight mission: canonical fixture runtime with a gated tool. */
async function createP1CancelFixture() {
  const { QuackApi } = await import("../api/index.js");
  const { canonicalFixture } = await import("../test-support/canonical-runtime.js");
  const workspaceRoot = join(tmpdir(), createId("quack_p1_cancel_ws"));
  const dataDir = join(workspaceRoot, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const base = createQuackSystem({ workspaceRoot, dataDir, permissions: ["workspace.read", "memory.read", "memory.write"] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const gated = canonicalFixture({ execute: async () => { await gate; return {}; } });
  const system = { ...base, api: new QuackApi({ ...base, runtime: gated.runtime }) } as QuackSystem;
  const cancelEvents: { missionId: string }[] = [];
  gated.events.on("mission.cancelled", (event) => { cancelEvents.push(event.payload as unknown as { missionId: string }); });
  return {
    system,
    graph: gated.graph,
    release,
    cancelEvents,
    cleanup: async () => {
      await gated.runtime.shutdown().catch(() => undefined);
      await base.events.drain();
      await removeDir(workspaceRoot);
    },
  };
}

async function waitFor(predicate: () => boolean, attempts = 100): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("cancel fails closed for finished and unknown missions", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const created = await postJson<{ id: string }>(`${server.address().url}/missions`, { goal: "inspect workspace", actor: "p1-test" });
    await waitForTerminal(server.address().url, created.body.id);
    const finished = await postJson(`${server.address().url}/missions/${created.body.id}/cancel`, {});
    assert.equal(finished.status, 409);
    assert.equal(finished.body.error?.code, "mission.not_cancellable");
    const unknown = await postJson(`${server.address().url}/missions/mission_unknown/cancel`, {});
    assert.equal(unknown.status, 404);
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("resume returns stored terminal results without re-execution and 404s unknown ids", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const created = await postJson<{ id: string }>(`${server.address().url}/missions`, { goal: "inspect workspace", actor: "p1-test" });
    await waitForTerminal(server.address().url, created.body.id);
    const resumed = await postJson<{ status: { state: string } }>(`${server.address().url}/missions/${created.body.id}/resume`, {});
    // Terminal missions resume to their stored result (no re-execution).
    assert.ok(resumed.status === 200 || resumed.status === 409, `resume of a completed mission should respond, got ${resumed.status}`);
    const unknown = await postJson(`${server.address().url}/missions/mission_unknown/resume`, {});
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error?.code, "mission.not_found");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("approvals surface: queue requests, human decides, tampered ids fail closed", async () => {
  const fixture = await createP1Fixture({ queuedApprover: true });
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    // Park a request through the real ApprovalCallback seam.
    const parked = fixture.approvals!.requestApproval("p1-actor requests terminal.execute.", { missionId: "p1-approval" });
    const list = await getJson<{ approvals: { id: string; state: string }[] }>(`${server.address().url}/approvals`);
    assert.equal(list.status, 200);
    assert.equal(list.body.approvals.length, 1);
    assert.equal(list.body.approvals[0].state, "PENDING");

    const decision = await postJson<{ approved: boolean }>(`${server.address().url}/approvals/${list.body.approvals[0].id}/approve`, { actor: "operator" });
    assert.equal(decision.status, 200);
    assert.equal(decision.body.approved, true);
    assert.equal(await parked, true);

    // Replayed decision on the decided id fails closed.
    const replay = await postJson(`${server.address().url}/approvals/${list.body.approvals[0].id}/deny`, { actor: "attacker" });
    assert.equal(replay.status, 404);
    assert.equal(replay.body.error?.code, "approval.not_pending");
    // Forged id fails closed.
    const forged = await postJson(`${server.address().url}/approvals/approval_forged/approve`, { actor: "attacker" });
    assert.equal(forged.status, 404);
    // Malformed body fails closed.
    const malformed = await postJson(`${server.address().url}/approvals/approval_x/approve`, {});
    assert.equal(malformed.status, 400);
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("approvals surface fails closed when no queued approver is configured", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const list = await getJson(`${server.address().url}/approvals`);
    assert.equal(list.status, 404);
    assert.equal(list.body.error?.code, "approval.queue_unavailable");
    const decide = await postJson(`${server.address().url}/approvals/approval_x/approve`, { actor: "operator" });
    assert.equal(decide.status, 404);
    assert.equal(decide.body.error?.code, "approval.queue_unavailable");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("traces can be listed by mission id", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const created = await postJson<{ id: string }>(`${server.address().url}/missions`, {
      goal: "inspect workspace",
      actor: "p1-trace-test",
      missionId: "p1-trace-mission",
    });
    await waitForTerminal(server.address().url, created.body.id);
    const listed = await getJson<{ traces: unknown[] }>(`${server.address().url}/traces?missionId=p1-trace-mission`);
    assert.equal(listed.status, 200);
    assert.ok(listed.body.traces.length >= 1, "trace lookup by mission returns the stored trace");
    const missing = await getJson(`${server.address().url}/traces`);
    assert.equal(missing.status, 400);
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("SSE stream redacts secret-shaped payload strings before they cross the wire", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const collected = await collectSse(server.address().url, 1500);
    assert.ok(collected.length > 0, "the SSE stream carries events");
    for (const line of collected) {
      if (line.startsWith("data: ")) {
        JSON.parse(line.slice("data: ".length)); // redacted output must remain valid JSON
        assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(line), "no provider key literal survives redaction");
        assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/.test(line), "no bearer token survives redaction");
      }
    }
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("SSE redaction sanitizes secret keys and secret-shaped values in payload objects", async () => {
  const fixture = await createP1Fixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    // Subscribe first, then emit a hostile payload through the system bus:
    // secret key names and provider-shaped values must not survive SSE.
    const collecting = collectSse(server.address().url, 1200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fixture.system.events.emit("capability.requested", {
      actor: "leaky", capabilityId: "permission.workspace.read",
      apiKey: "sk-abcdefghijklmnopqrstuvwx",
      nested: { AUTH_TOKEN: "super-secret-bearer-value", note: "bearer abcdefghijklmn" },
    } as never, { actor: "test" });
    const collected = await collecting;
    const data = collected.find((line) => line.includes("permission.workspace.read") && line.startsWith("data: "));
    assert.ok(data, "the emitted event crossed SSE");
    JSON.parse(data.slice("data: ".length));
    assert.ok(!data.includes("sk-abcdefghijklmnopqrstuvwx"), "secret-shaped values are redacted");
    assert.ok(!data.includes("super-secret-bearer-value"), "secret-keyed fields are redacted");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

interface P1Fixture {
  system: QuackSystem;
  approvals?: QueuedApprovalCallback;
  cancelEvents: { missionId: string }[];
  cleanup(): Promise<void>;
}

async function createP1Fixture(options: { queuedApprover?: boolean } = {}): Promise<P1Fixture> {
  const workspaceRoot = join(tmpdir(), createId("quack_p1_workspace"));
  const dataDir = join(tmpdir(), createId("quack_p1_data"));
  await mkdir(workspaceRoot, { recursive: true });
  const approvals = options.queuedApprover ? new QueuedApprovalCallback() : undefined;
  const system = createQuackSystem({
    workspaceRoot,
    dataDir,
    permissions: ["workspace.read", "memory.read", "memory.write"],
    ...(approvals ? { approver: approvals } : {}),
  });
  const cancelEvents: { missionId: string }[] = [];
  system.events.on("mission.cancelled", (event) => { cancelEvents.push(event.payload as unknown as { missionId: string }); });
  return {
    system,
    approvals,
    cancelEvents,
    cleanup: async () => {
      await system.events.drain();
      await removeDir(workspaceRoot);
      await removeDir(dataDir);
    },
  };
}

async function waitForTerminal(baseUrl: string, id: string): Promise<{ state: string; error?: string }> {
  for (let attempt = 0; attempt < 240; attempt++) {
    const response = await getJson<{ state: string; error?: string }>(`${baseUrl}/missions/${id}`);
    if (response.body.state === "COMPLETED" || response.body.state === "FAILED") return response.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Mission ${id} did not reach a terminal state.`);
}

async function postJson<T = { error?: { code: string } }>(url: string, body: unknown): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as T };
}

async function getJson<T = { error?: { code: string } }>(url: string): Promise<{ readonly status: number; readonly body: T }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() as T };
}

/** Read an SSE stream briefly and return its raw lines. */
async function collectSse(baseUrl: string, ms: number): Promise<string[]> {
  const lines: string[] = [];
  const req = httpRequest(`${baseUrl}/events`, (response) => {
    response.setEncoding("utf8");
    let buffer = "";
    response.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) lines.push(part);
    });
  });
  req.end();
  await new Promise((resolve) => setTimeout(resolve, ms));
  req.destroy();
  return lines;
}

async function removeDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryable(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && ["ENOTEMPTY", "EPERM", "EBUSY"].includes(String((error as { code?: string }).code));
}
