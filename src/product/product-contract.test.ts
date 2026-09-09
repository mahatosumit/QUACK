import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P0 product-contract guard (docs/product/PRODUCT_PRINCIPLES.md).
 *
 * Verifies the architectural invariants the product documentation declares:
 * - exactly one composition root / runtime entrypoint is exported to clients
 * - the event bus is a single class (no parallel event system)
 * - the model gate and harness are single implementations
 * - documented client-facing event types actually exist in the QuackEventType union
 * - the product/contract documents are present and registered as public files
 *
 * This is documentation-integrity + anti-duplication insurance for product
 * development (P1+). It intentionally inspects source text rather than
 * behavior: the behaviors are certified by the runtime suites.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readSource(relative: string): Promise<string> {
  return readFile(join(root, relative), "utf8");
}

test("product documentation exists and is registered as public", async () => {
  const manifest = JSON.parse(await readFile(join(root, "packaging", "public-files.json"), "utf8")) as { files: string[] };
  const required = [
    "docs/product/QUACK_OS_PRODUCT.md",
    "docs/product/PRODUCT_PRINCIPLES.md",
    "docs/product/MISSION_MODEL.md",
    "docs/product/PRODUCT_SURFACES.md",
    "docs/product/DIFFERENTIATION.md",
    "docs/product/ORIGINALITY.md",
    "docs/product/ROADMAP.md",
    "docs/contracts/CLIENT_EVENTS.md",
    "docs/contracts/MISSION_API.md",
  ];
  for (const path of required) {
    await access(join(root, path));
    assert.ok(manifest.files.includes(path), `${path} must be registered in packaging/public-files.json`);
  }
});

test("I-001 ONE_RUNTIME: a single composition root is exported for clients", async () => {
  const system = await readSource("src/distributions/swe-system.ts");
  assert.ok(/export function createQuackSystem/.test(system), "createQuackSystem must be the exported composition root");
  // No competing bootstrap: nothing else may export a system factory that
  // builds a QuackRuntime outside this module.
  const runtimeModule = await readSource("src/runtime/runtime.ts");
  const exportedFactories = [...runtimeModule.matchAll(/export function (create\w+System\w*)/g)].map((m) => m[1]);
  assert.deepEqual(exportedFactories, [], "runtime module must not export system factories");
});

test("I-004 ONE_EVENT_BUS: the runtime event bus is a single class", async () => {
  const bus = await readSource("src/events/event-bus.ts");
  assert.ok(/export class EventBus\b/.test(bus), "EventBus must be the one event bus");
  // Guard against parallel wire-level event systems being introduced as
  // "another bus": SSE must remain a projection, implemented in the server.
  const server = await readSource("src/server/index.ts");
  assert.ok(server.includes("text/event-stream"), "SSE projection lives in the HTTP server");
  assert.ok(!bus.includes("WebSocket"), "the event bus must not grow a second transport");
});

test("I-003 ONE_MODEL_GATE: every model path routes through the governed gate", async () => {
  const governed = await readSource("src/models/governed-runtime.ts");
  assert.ok(/export class GovernedModelRuntime\b/.test(governed), "GovernedModelRuntime must exist as the single model gate");
  const system = await readSource("src/distributions/swe-system.ts");
  assert.ok(system.includes("new GovernedModelRuntime("), "the composition root wires the governed gate");
  assert.ok(!system.includes("new OpenAiCompatibleProvider(") || !/providers:\s*\[\s*new OpenAiCompatibleProvider/.test(system),
    "raw provider instances must not be handed to surfaces outside the gate");
});

test("I-006 ONE_HARNESS: the native harness is the single harness implementation", async () => {
  const registry = await readSource("src/harness/registry.ts");
  assert.ok(registry.includes("QuackNativeHarness"), "QuackNativeHarness must be the native harness");
  const sources = ["src/harness/registry.ts", "src/harness/evaluator.ts", "src/harness/conformance-runner.ts"];
  for (const path of sources) {
    const text = await readSource(path);
    assert.ok(!/class \w+Harness\b(?!.*QuackNative)/.test(text.replace("class QuackNativeHarness", "")), `${path} must not define a second harness class`);
  }
});

test("client event contract documents only event types that exist", async () => {
  const contract = await readSource("docs/contracts/CLIENT_EVENTS.md");
  const bus = await readSource("src/events/event-bus.ts");
  const union = new Set([...bus.matchAll(/\|\s*"([a-z_.]+)"/g)].map((m) => m[1]));
  // Event lists in the contract are comma/newline separated backticked types.
  // Prose references such as `task.result.receipt` (a field path, not an
  // event type) do not match the list grammar and are excluded by the
  // lookahead separator.
  const documented = [...contract.matchAll(/`([a-z]+(?:\.[a-z_.-]+)+)`(?=\s*,|\s*$)/gm)].map((m) => m[1]);
  assert.ok(documented.length >= 40, `expected the client event list to be recognized, found ${documented.length}`);
  const declaredFuture = ["approval.requested", "approval.decided", "mission.cancelled", "model.stream.chunk"];
  for (const type of documented) {
    if (declaredFuture.includes(type)) continue; // explicitly marked future in the doc
    assert.ok(union.has(type), `CLIENT_EVENTS.md documents '${type}' but it is not in the QuackEventType union`);
  }
  for (const type of declaredFuture) {
    assert.ok(!union.has(type), `future event '${type}' has shipped — update CLIENT_EVENTS.md to move it out of the future table`);
    assert.ok(contract.includes(type), `future event '${type}' must stay documented`);
  }
});

test("mission API contract does not document planned endpoints as existing", async () => {
  const contract = await readSource("docs/contracts/MISSION_API.md");
  const server = await readSource("src/server/index.ts");
  const planned = ["/approvals", "/missions/{id}/resume", "/missions/{id}/cancel"];
  const plannedSection = contract.slice(contract.indexOf("## Planned operations"));
  const existingSection = contract.slice(0, contract.indexOf("## Planned operations"));
  for (const route of planned) {
    assert.ok(plannedSection.includes(route), `${route} must be documented as planned, not existing`);
    const base = route.replace("/missions/{id}", "/missions/x");
    assert.ok(!server.includes(`"${base}"`), `${route} must not be implemented while documented as planned`);
  }
  assert.ok(existingSection.includes("POST `/missions`"), "existing submit route must be documented");
  assert.ok(!existingSection.includes("/approvals"), "approval routes must not appear in the existing section");
});
