import test from "node:test";
import assert from "node:assert/strict";
import { STUDIO_API, studioHtml, studioScript, studioStyles } from "./studio.js";

test("QUACK Control Room renders every required solo-production surface", () => {
  const html = studioHtml();
  const script = studioScript();

  for (const label of ["Overview", "Missions", "Agents", "Models", "Actions", "Integrations", "Browser", "Files", "Approvals", "Evidence", "System", "Settings"]) {
    assert.match(html, new RegExp(label, "i"));
  }
  assert.match(script, /window\.confirm/);
  assert.match(script, /dryRun/);
  assert.match(script, /DENY BY DEFAULT/);
  assert.equal(STUDIO_API.proposals, "/improvement/proposals");
  assert.equal(STUDIO_API.actions, "/actions");
});

test("QUACK Studio styles are desktop-first and remain mobile usable", () => {
  const css = studioStyles();
  assert.match(css, /grid-template-columns:224px/);
  assert.match(css, /@media\(max-width:820px\)/);
  assert.match(css, /badge\.risk/);
  assert.match(css, /prefers-reduced-motion/);
});

test("P2 Mission Control: lanes, detail actions, approval queue, live events are wired", () => {
  const script = studioScript();
  const html = studioHtml();
  // Live lanes consume the missions API and render lane links.
  assert.match(script, /Mission Control/);
  assert.match(script, /laneItems/);
  assert.match(script, /"Active \/ queued"/);
  // Mission detail exposes cancel/resume over the P1 endpoints.
  assert.match(script, /missionAction/);
  assert.match(script, /\+action/);
  assert.match(script, /"cancel"/);
  assert.match(script, /"resume"/);
  // Approval Center consumes the P1 approval queue with explicit decisions.
  assert.match(script, /decideQueuedApproval/);
  assert.match(script, /\/approvals/);
  assert.match(script, /data-queue-approve/);
  // Live updates flow through the SSE projection with debounced refresh.
  assert.match(script, /connectLive/);
  assert.match(script, /EventSource\(api\.events\)/);
  assert.match(script, /mission\.cancelled/);
  assert.match(script, /approval\.requested/);
  assert.match(script, /refreshApprovalCount/);
  // Nav badge for pending approvals exists in the shell.
  assert.match(html, /approval-count/);
});

test("P3 Console: conversational composer over the Mission API, never executes", () => {
  const script = studioScript();
  const html = studioHtml();
  // Console route exists in shell + routes map + dispatcher.
  assert.match(html, /href="#console" data-route="console"/);
  assert.match(script, /console:\["Console"/);
  assert.match(script, /renderConsole\(\)/);
  // Conversation composes missions through the canonical submit path only.
  assert.match(script, /submitConsoleMission/);
  assert.match(script, /request\(api\.missions,\{method:"POST"/);
  // Live mission stream feeds the conversation through SSE, with reconnect
  // guidance pointing at the durable stores (no fabricated streaming).
  assert.match(script, /consoleOnLiveEvent/);
  assert.match(script, /STREAM LIVE/);
  assert.match(script, /full durable history/);
  // Nav badge for pending approvals exists in the shell.
  assert.match(html, /approval-count/);
});

test("P4 governed streaming: Console consumes broker-gated streams, never fabricates", () => {
  const script = studioScript();
  // The console asks through the governed stream endpoint only.
  assert.match(script, /askConsoleModel/);
  assert.match(script, /api\.modelsStream/);
  assert.match(script, /modelsStream:"\/models\/stream"/);
  // Streamed text renders as governed-model turns with error surfacing.
  assert.match(script, /console-turn stream/);
  assert.match(script, /Governed stream rejected/);
  assert.match(script, /No governed model output/);
  // Fabrication guard: no client-side synthetic chunk emission.
  assert.doesNotMatch(script, /setTimeout\([^)]*\)\.text/);
});
