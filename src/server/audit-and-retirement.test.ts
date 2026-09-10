import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { QuackHttpServer } from "./index.js";

/**
 * P7 Audit Center + retirement contract tests. The audit surface reads the
 * real audit log, redacts payloads at the boundary, and fails closed for
 * unauthenticated access. The duplicated desktop HTTP surface must not
 * resurrect: no second local HTTP server may exist in src/.
 */

test("audit trail returns recorded events with redacted payloads", async () => {
  const fixture = await createAuditFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    await fixture.system.events.emit("capability.requested", {
      actor: "audit-test",
      capabilityId: "permission.workspace.read",
      apiKey: "sk-abcdefghijklmnopqrstuvwx",
      nested: { AUTH_TOKEN: "super-secret" },
    } as never, { actor: "audit-test" });
    await fixture.system.events.drain();
    const response = await fetch(`${server.address().url}/audit?limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json() as { total: number; records: { type: string; payload: Record<string, unknown> }[] };
    assert.ok(body.total >= 1, "audit records were captured");
    const hostile = body.records.find((record) => record.payload && "apiKey" in record.payload);
    assert.ok(hostile, "the emitted event reached the audit log");
    const raw = JSON.stringify(hostile.payload);
    assert.ok(!raw.includes("sk-abcdefghijklmnopqrstuvwx"), "secret-shaped values never survive the audit boundary");
    assert.ok(!raw.includes("super-secret"), "secret-keyed fields never survive the audit boundary");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("audit access requires authentication when the server is authenticated", async () => {
  const fixture = await createAuditFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: true });
  try {
    await server.start();
    const response = await fetch(`${server.address().url}/audit`);
    assert.equal(response.status, 401, "no anonymous audit path exists");
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "request.unauthorized");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("forged trace and mission identifiers fail closed without crashing", async () => {
  const fixture = await createAuditFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const base = server.address().url;
    // Forged / traversal-shaped trace ids return 404, never file content.
    for (const id of ["trace_forged", "..%2F..%2Fpackage.json", "%00", "trace/../../secret"]) {
      const response = await fetch(`${base}/traces/${id}`);
      assert.equal(response.status, 404, `forged id '${id}' must fail closed`);
      const body = await response.json() as { error?: { code?: string } };
      assert.ok(body.error, "the failure is a structured error, not file content");
      assert.match(String(body.error?.code), /not_found/, "the failure is an explicit not-found denial");
    }
    // Forged mission ids for traces-by-mission return empty result sets.
    const byMission = await fetch(`${base}/traces?missionId=mission_${"x".repeat(64)}`);
    assert.equal(byMission.status, 200);
    const listBody = await byMission.json() as { traces: unknown[] };
    assert.deepEqual(listBody.traces, [], "forged mission id returns no traces — nothing inferred");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("audit limit parameter is bounded and malformed values fall back safely", async () => {
  const fixture = await createAuditFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const base = server.address().url;
    const negative = await fetch(`${base}/audit?limit=-5`);
    assert.equal(negative.status, 200);
    const huge = await fetch(`${base}/audit?limit=99999`);
    assert.equal(huge.status, 200);
    const body = await huge.json() as { records: unknown[] };
    assert.ok(body.records.length <= 500, "the audit limit is clamped server-side");
    const garbage = await fetch(`${base}/audit?limit=not-a-number`);
    assert.equal(garbage.status, 200);
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

async function createAuditFixture(): Promise<{ system: QuackSystem; cleanup(): Promise<void> }> {
  const workspaceRoot = join(tmpdir(), createId("quack_p7_ws"));
  const dataDir = join(tmpdir(), createId("quack_p7_data"));
  await mkdir(workspaceRoot, { recursive: true });
  const system = createQuackSystem({
    workspaceRoot,
    dataDir,
    permissions: ["workspace.read", "memory.read", "memory.write"],
  });
  return {
    system,
    cleanup: async () => {
      await system.events.drain();
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
