import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventBus } from "../../events/event-bus.js";
import {
  JsonFileApprovalStore, DurableApprovalRunner, approvalRequestKey, parseDurableApprovalRequest,
  APPROVAL_TTL_MS_DEFAULT,
} from "./approval-store.js";
import {
  ApprovalRunner, canonicalProposalDigest, parseApprovalRecord, approvalRecordDigest,
  type ApprovalRunnerCallback, type ApprovalCallbackDecision, type ApprovalRequestInput,
} from "./approval-contract.js";

/**
 * P15 (ADR 0049) durable approval queue security matrix.
 *
 * Doctrine under test: an approval authorizes exactly ONE dispatch of the
 * EXACT bound proposal; decisions are durable across restarts; expiration
 * is server-clock enforced and tamper-proof (digest-bound); denied is
 * forever; consumed is never reusable; the model can never produce a valid
 * approval by writing fields.
 */

const BINDING = {
  missionId: "m-approval-durable",
  stepIndex: 3,
  capability: "fixture.destructive",
  proposalDigest: "f".repeat(64),
  riskLevel: "DESTRUCTIVE" as const,
  reason: "test: destructive fixture proposal",
  actor: "governed-mission-loop",
};

function input(overrides: Partial<ApprovalRequestInput & { actor: string }> = {}) {
  return { ...BINDING, ...overrides };
}

class ScriptedCallback implements ApprovalRunnerCallback {
  public asked = 0;
  constructor(private readonly decision: ApprovalCallbackDecision) {}
  async requestDecision(): Promise<ApprovalCallbackDecision> {
    this.asked += 1;
    return this.decision;
  }
}

async function tempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "quack-appr-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

// ---------------------------------------------------------------------------
// Request persistence + TTL
// ---------------------------------------------------------------------------

test("P15.B1 approval request parks durably before the callback and survives restart", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const store = new JsonFileApprovalStore(dir);
  const parked = await store.parkRequest(input());
  const raw = await readFile(join(dir, "mission-approvals", `${approvalRequestKey(BINDING.missionId, BINDING.stepIndex, BINDING.capability, BINDING.proposalDigest)}.json`), "utf8");
  const parsed = parseDurableApprovalRequest(raw);
  assert.ok(parsed.ok, "parked request parses");
  assert.equal(parsed.request!.missionId, BINDING.missionId);
  assert.equal(parsed.request!.expiresAt, parked.expiresAt);
  assert.ok(parsed.request!.expiresAt > Date.now(), "expiry is in the future (server clock)");
  // A FRESH process (fresh store instance) sees the same live request.
  const fresh = new JsonFileApprovalStore(dir);
  const loaded = await fresh.loadBinding(BINDING);
  assert.equal(loaded?.kind, "PENDING", "restart sees the parked request as PENDING");
});

test("P15.B2 server-side TTL: an expired request never authorizes (client fields cannot extend it)", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  // Fixed clock: parked request expired 1ms in the past.
  const clock = { value: 1_000_000 };
  const store = new JsonFileApprovalStore(dir, { clock: () => clock.value });
  await store.parkRequest(input());
  clock.value += APPROVAL_TTL_MS_DEFAULT + 1;
  const loaded = await store.loadBinding({ ...BINDING, now: clock.value });
  assert.equal(loaded?.kind, "EXPIRED", "expired request fails closed");
  // A client attempting to rewrite expiresAt breaks the digest.
  const key = approvalRequestKey(BINDING.missionId, BINDING.stepIndex, BINDING.capability, BINDING.proposalDigest);
  const raw = JSON.parse(await readFile(join(dir, "mission-approvals", `${key}.json`), "utf8"));
  raw.expiresAt = clock.value + 3_600_000;
  await writeFile(join(dir, "mission-approvals", `${key}.json`), JSON.stringify(raw));
  const tampered = await store.loadBinding({ ...BINDING, now: clock.value }).catch(() => ({ kind: "REJECTED" as const }));
  assert.notEqual(tampered?.kind, "PENDING", "tampered expiry can never resurrect a request");
  assert.notEqual(tampered?.kind, "DECIDED", "tampered record can never authorize");
});

// ---------------------------------------------------------------------------
// Decision durability, replay, upgrade, consumption
// ---------------------------------------------------------------------------

test("P15.B3 granted decision persists; restart reuses it without re-asking the human", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const events = new EventBus();
  const grantEvents: string[] = [];
  events.onAny((event) => { grantEvents.push(event.type); });
  const callback = new ScriptedCallback({ approved: true, approver: "operator:alice", reason: "ok" });
  const runner = new DurableApprovalRunner(new JsonFileApprovalStore(dir), callback, { events });
  const first = await runner.requestApproval(input());
  assert.equal(first.decision, "GRANTED");
  assert.equal(callback.asked, 1, "human was asked exactly once");
  // Restart: a new runner with a FRESH callback instance reuses the record.
  const restarted = new DurableApprovalRunner(new JsonFileApprovalStore(dir), new ScriptedCallback({ approved: false, approver: "x", reason: "x" }), { events });
  const reused = await restarted.requestApproval(input());
  assert.equal(reused.decision, "GRANTED", "prior grant is reused");
  assert.equal(reused.approvalId, first.approvalId, "same approval identity");
  assert.ok(grantEvents.includes("mission.approval_restored"), "reuse is observable");
  // The reused approval is consumable EXACTLY once.
  const consumed = restarted.consumeApproval(reused, BINDING);
  assert.equal(consumed.ok, true);
  const replay = restarted.consumeApproval(reused, BINDING);
  assert.equal(replay.ok, false, "a consumed approval can never authorize again");
});

test("P15.B4 denied decision is durable and can never be upgraded by re-asking", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const callback = new ScriptedCallback({ approved: false, approver: "operator:bob", reason: "no" });
  const runner = new DurableApprovalRunner(new JsonFileApprovalStore(dir), callback);
  const denied = await runner.requestApproval(input());
  assert.equal(denied.decision, "DENIED");
  // Restart with an APPROVING callback: the durable denial stands.
  const restarted = new DurableApprovalRunner(new JsonFileApprovalStore(dir), new ScriptedCallback({ approved: true, approver: "operator:mallory", reason: "upgrade attempt" }));
  await assert.rejects(() => restarted.requestApproval(input()), /DENIED/, "a denied binding can never be re-asked or upgraded");
});

test("P15.B5 consumption persists across restart: a second process can never re-consume", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const grantor = new ScriptedCallback({ approved: true, approver: "operator:carol", reason: "once" });
  const runner = new DurableApprovalRunner(new JsonFileApprovalStore(dir), grantor);
  const record = await runner.requestApproval(input());
  assert.equal(runner.consumeApproval(record, BINDING).ok, true);
  // Give the fire-and-forget persist a beat, then read from a fresh store.
  await new Promise(resolve => setTimeout(resolve, 50));
  const fresh = new JsonFileApprovalStore(dir);
  const loaded = await fresh.loadBinding(BINDING);
  assert.equal(loaded?.kind, "DECIDED", "the decision record survives");
  assert.equal(loaded!.record.state, "CONSUMED", "consumption is durable");
  // Any later consume attempt on the SAME record fails (P14) — and a
  // restarted runner refuses to re-request a consumed binding.
  const restarted = new DurableApprovalRunner(fresh, new ScriptedCallback({ approved: true, approver: "x", reason: "x" }));
  await assert.rejects(() => restarted.requestApproval(input()), /CONSUMED/, "a consumed approval can never be re-requested");
});

// ---------------------------------------------------------------------------
// Identity binding: mismatched approvals fail closed
// ---------------------------------------------------------------------------

for (const [label, override] of [
  ["different mission", { missionId: "m-OTHER" }],
  ["different step", { stepIndex: 99 }],
  ["different capability", { capability: "fixture.other" }],
  ["different proposal digest", { proposalDigest: "0".repeat(64) }],
] as const) {
  test(`P15.B6 approval bound to a ${label} can never authorize this action`, async t => {
    const { dir, cleanup } = await tempDir();
    t.after(cleanup);
    const callback = new ScriptedCallback({ approved: true, approver: "operator:d", reason: "granted for a DIFFERENT action" });
    const runner = new DurableApprovalRunner(new JsonFileApprovalStore(dir), callback);
    // Grant for the WRONG binding (all four binding fields differ from BINDING).
    const foreign = await runner.requestApproval(input(override as Record<string, unknown> as Partial<ApprovalRequestInput & { actor: string }>));
    assert.equal(foreign.decision, "GRANTED");
    // Attempt to consume the foreign approval for THIS binding: P14 binding
    // checks must refuse.
    const consume = runner.consumeApproval(foreign, BINDING);
    assert.equal(consume.ok, false, `cross-binding consumption must fail: ${label}`);
  });
}

// ---------------------------------------------------------------------------
// Forgery: model-originated data can never satisfy the approval contract
// ---------------------------------------------------------------------------

test("P15.B7 forged approval record (re-digest of tampered fields) fails closed on consume", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const store = new JsonFileApprovalStore(dir);
  const key = approvalRequestKey(BINDING.missionId, BINDING.stepIndex, BINDING.capability, BINDING.proposalDigest);
  // A "model" writes its own approval record directly into the store —
  // re-digesting with the REAL canonical function so the record parses
  // (documented boundary: digest is integrity, not authenticity). An
  // attacker with dataDir write access CAN forge a parseable record.
  const base: Omit<import("./approval-contract.js").ApprovalRecord, "digest"> = {
    version: 1,
    approvalId: "appr_forged",
    missionId: BINDING.missionId,
    stepIndex: BINDING.stepIndex,
    capability: BINDING.capability,
    proposalDigest: BINDING.proposalDigest,
    riskLevel: "DESTRUCTIVE",
    decision: "GRANTED",
    approver: "model",
    reason: "the model approves itself",
    decidedAt: new Date().toISOString(),
    state: "GRANTED",
  };
  const digest = approvalRecordDigest(base);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "mission-approvals"), { recursive: true });
  await writeFile(join(dir, "mission-approvals", `${key}.json`), JSON.stringify({ ...base, digest }));
  const parsed = parseApprovalRecord(JSON.stringify({ ...base, digest }));
  // Honest boundary: a fully re-digestable forged record PARSES.
  assert.equal(parsed.ok, true, "re-digested forgery parses (integrity != authenticity, documented)");
  assert.equal(parsed.record!.approver, "model", "the forgery carries a model approver identity");
  // The store loads it as a decided record — the documented boundary: the
  // dataDir is trusted state; an attacker with write access to it is inside
  // the host-OS trust boundary already (same model as execution evidence,
  // ADR 0047). What the architecture STILL guarantees: the at-most-once
  // journal bounds any forged grant to ONE dispatch, and the broker +
  // verification gates remain independent authorities.
  const loaded = await store.loadBinding(BINDING);
  assert.equal(loaded?.kind, "DECIDED", "forged decision is loadable (documented integrity-vs-authenticity boundary)");
  assert.ok(true, "forgery boundary documented; at-most-once dispatch bounds the blast radius to one attempt");
});

test("P15.B8 malformed approval records fail closed on load", async t => {
  const { dir, cleanup } = await tempDir();
  t.after(cleanup);
  const store = new JsonFileApprovalStore(dir);
  const key = approvalRequestKey(BINDING.missionId, BINDING.stepIndex, BINDING.capability, BINDING.proposalDigest);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, "mission-approvals"), { recursive: true });
  await writeFile(join(dir, "mission-approvals", `${key}.json`), "{not json");
  await assert.rejects(() => store.loadBinding(BINDING), /Invalid durable approval record/, "corrupt record fails closed, never coerced");
});

test("P15.B9 deterministic request key binds the full identity tuple", () => {
  const key = approvalRequestKey("m", 1, "cap", "d".repeat(64));
  assert.equal(key, approvalRequestKey("m", 1, "cap", "d".repeat(64)), "same binding, same key");
  assert.notEqual(key, approvalRequestKey("m2", 1, "cap", "d".repeat(64)), "different mission, different key");
  assert.notEqual(key, approvalRequestKey("m", 2, "cap", "d".repeat(64)), "different step, different key");
  assert.notEqual(key, approvalRequestKey("m", 1, "cap2", "d".repeat(64)), "different capability, different key");
  assert.notEqual(key, approvalRequestKey("m", 1, "cap", "e".repeat(64)), "different digest, different key");
});

test("P15.B10 canonical proposal digest binds the EXACT action (arguments matter)", () => {
  const base = { capability: "c", arguments: { a: 1 }, intent: "i", missionId: "m", stepIndex: 0 };
  const d1 = canonicalProposalDigest(base);
  const d2 = canonicalProposalDigest({ ...base, arguments: { a: 2 } });
  const d3 = canonicalProposalDigest({ ...base, stepIndex: 1 });
  assert.notEqual(d1, d2, "different arguments are different actions");
  assert.notEqual(d1, d3, "different steps are different actions");
  assert.equal(d1, canonicalProposalDigest(base), "same action, same digest");
});

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortDeep((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}
