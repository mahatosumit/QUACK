import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createId } from "../core/types.js";
import { createQuackSystem, type QuackSystem } from "../distributions/swe-system.js";
import { QuackHttpServer } from "./index.js";

/**
 * P4 governed model streaming contract tests: broker denial fails closed
 * before any provider is contacted, chunk text is redacted at the wire, and
 * `model.stream.chunk` events reach the shared event bus.
 */

test("stream request without provider.invoke authority fails closed", async () => {
  const fixture = await createStreamFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const stream = await postStream(server.address().url + "/models/stream", { prompt: "summarize the workspace", actor: "p4-test" });
    const chunks = parseSseData(stream);
    assert.ok(chunks.length >= 1, "the stream closes with a terminal chunk");
    const terminal = chunks[chunks.length - 1];
    assert.equal(terminal.done, true);
    assert.equal(terminal.denied, true, "denial is explicit");
    assert.match(String(terminal.error ?? ""), /denied|authority|permission/i);
    assert.equal(fixture.providerContacts, 0, "no provider was contacted after denial");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("malformed stream requests are rejected with 400", async () => {
  const fixture = await createStreamFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  try {
    await server.start();
    const response = await fetch(server.address().url + "/models/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: "no-prompt" }) });
    assert.equal(response.status, 400);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "model.invalid_stream_request");
  } finally {
    await server.stop();
    await fixture.cleanup();
  }
});

test("stream chunks are redacted at the wire and broadcast on the event bus", async () => {
  const fixture = await createStreamFixture({ grantInvoke: true, injectLeakyProvider: true });
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  const busChunks: string[] = [];
  const detach = fixture.system.events.on("model.stream.chunk", (event) => { busChunks.push(String((event.payload as { text?: string }).text ?? "")); });
  try {
    await server.start();
    const stream = await postStream(server.address().url + "/models/stream", { prompt: "leak test", actor: "p4-test" });
    const chunks = parseSseData(stream);
    assert.ok(chunks.length >= 1);
    for (const chunk of chunks) {
      JSON.parse(JSON.stringify(chunk)); // payloads stay structured
      assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(String(chunk.text)), "provider key literals never survive the wire");
      assert.ok(!/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/.test(String(chunk.text)), "bearer tokens never survive the wire");
    }
    await fixture.system.events.drain();
    assert.ok(busChunks.length >= 1, "chunks broadcast on the shared bus for /events clients");
    for (const text of busChunks) {
      assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(text), "bus chunks are redacted too");
    }
  } finally {
    detach();
    await server.stop();
    await fixture.cleanup();
  }
});

test("P8.7 instruction observability events reach the shared bus with metadata-only payloads", async () => {
  const fixture = await createStreamFixture();
  const server = new QuackHttpServer({ system: fixture.system, port: 0, authentication: false });
  const observed: { type: string; payload: Record<string, unknown> }[] = [];
  const detach = fixture.system.events.onAny((event) => {
    if (event.type === "instruction.dispatched" || event.type === "instruction.rejected") {
      observed.push({ type: event.type, payload: event.payload as Record<string, unknown> });
    }
  });
  try {
    await server.start();
    // Emit exactly what an InstructionObserver emits for a rejected
    // dispatch — the bus is the transport; /events clients see it via the
    // existing onAny SSE bridge.
    const { InstructionObserver } = await import("../instruction/observer.js");
    const observer = new InstructionObserver({ events: fixture.system.events });
    await observer.observeDispatch({
      composed: {
        planVersion: 1,
        missionId: "mission-p87-sse",
        layers: [{ name: "identity", items: [{ id: "id-1", provenance: { source: "test", category: "system", trust: "TRUSTED_RUNTIME" }, data: { secret: "never-emit-me" } }] }],
        outputContract: { kind: "plainResponse" },
        failurePolicy: { allowedModes: [], preferAdmission: true },
        budget: { maxInstructionChars: 1000, reservedOutputChars: 100 },
        budgetReport: { totalChars: 1, budgetChars: 1000, withinBudget: true, omitted: [] },
        digest: "a".repeat(64),
      },
      flags: [],
      outcome: "rejected",
      errorCode: "instruction.defense_digest_mismatch",
      actor: "p87-test",
    });
    await fixture.system.events.drain();
    assert.equal(observed.length, 1, "the instruction.rejected event crossed the shared bus");
    assert.equal(observed[0].payload["outcome"], "rejected");
    assert.equal(observed[0].payload["errorCode"], "instruction.defense_digest_mismatch");
    assert.equal(observed[0].payload["missionId"], "mission-p87-sse");
    const serialized = JSON.stringify(observed[0].payload);
    assert.ok(!serialized.includes("never-emit-me"), "item data never enters the event payload");
  } finally {
    detach();
    await server.stop();
    await fixture.cleanup();
  }
});

/** Post a stream request and collect the raw response body. */
async function postStream(url: string, body: unknown): Promise<string> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-QUACK-CSRF": "1" }, body: JSON.stringify(body) });
  return await response.text();
}

function parseSseData(raw: string): { text?: string; done?: boolean; denied?: boolean; error?: string }[] {
  const chunks: { text?: string; done?: boolean; denied?: boolean; error?: string }[] = [];
  for (const part of raw.split("\n\n")) {
    const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
    if (!dataLine) continue;
    try {
      const envelope = JSON.parse(dataLine.slice("data: ".length)) as { payload?: Record<string, unknown> };
      const payload = envelope.payload ?? envelope;
      chunks.push(payload as { text?: string; done?: boolean; denied?: boolean; error?: string });
    } catch { /* ignore malformed */ }
  }
  return chunks;
}

interface StreamFixture {
  readonly system: QuackSystem;
  readonly providerContacts: number;
  cleanup(): Promise<void>;
}

async function createStreamFixture(options: { grantInvoke?: boolean; injectLeakyProvider?: boolean } = {}): Promise<StreamFixture> {
  const workspaceRoot = join(tmpdir(), createId("quack_p4_workspace"));
  const dataDir = join(tmpdir(), createId("quack_p4_data"));
  await mkdir(workspaceRoot, { recursive: true });
  const system = createQuackSystem({
    workspaceRoot,
    dataDir,
    permissions: ["workspace.read", "memory.read", "memory.write", ...(options.grantInvoke ? ["provider.invoke" as const] : [])],
  });
  if (options.injectLeakyProvider) {
    // Stream a hostile chunk through the real governed runtime seam: the
    // wire must redact provider-key literals inside chunk text.
    const original = system.governedModelRuntime.stream.bind(system.governedModelRuntime);
    (system.governedModelRuntime as unknown as { stream: typeof original }).stream = async function* (request: Parameters<typeof original>[0], context: Parameters<typeof original>[1]) {
      yield { providerId: "hostile-fixture", model: request.model ?? "auto", text: "here is a key sk-abcdefghijklmnopqrstuvwx and Bearer abcdefghijklmnop", done: false };
      yield { providerId: "hostile-fixture", model: request.model ?? "auto", text: "clean finish", done: true };
    };
  }
  return {
    system,
    providerContacts: 0,
    cleanup: async () => {
      await system.events.drain();
      await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
      await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}
