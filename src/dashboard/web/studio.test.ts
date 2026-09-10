import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

test("P5 evaluation history renders stored evaluator results with dimensions", () => {
  const script = studioScript();
  assert.match(script, /Evaluation history/);
  assert.match(script, /capabilityDiscipline/);
  assert.match(script, /evidenceQuality/);
  // The evidence view reads the dashboard state harness evaluations.
  assert.match(script, /async function renderEvidence\(\)\{const \[data,state\]=await Promise\.all\(\[request\(api\.memory\),request\(api\.dashboardState\)\]\)/);
});

test("P6 agent workspace renders registry + assignment state + eval summaries", () => {
  const script = studioScript();
  assert.match(script, /Agent workspace/);
  // Registry facts come from /agents; assignment state from /dashboard/state.
  assert.match(script, /async function renderAgents\(\)\{const \[registry,state\]=await Promise\.all\(\[request\(api\.agents\),request\(api\.dashboardState\)\]\)/);
  // Trust levels, capabilities, skills, specialization, and current work are shown.
  assert.match(script, /a\.trustLevel/);
  assert.match(script, /a\.capabilities\.join/);
  assert.match(script, /a\.skills\.join/);
  assert.match(script, /a\.specialization\.join/);
  assert.match(script, /ASSIGNED.*AVAILABLE|AVAILABLE.*ASSIGNED/);
  assert.match(script, /assignedMissions/);
  // Registry state is honestly labeled — no live-execution claim.
  assert.match(script, /not a claim that an agent is currently executing/);
  // Agent-quality summaries derive from stored evaluation dimensions.
  assert.match(script, /capabilityDiscipline/);
  assert.match(script, /Across /);
});

test("P7 Trace Center renders repository traces with filtering and detail navigation", () => {
  const script = studioScript();
  assert.match(script, /Trace Center/);
  assert.match(script, /renderTraces/);
  assert.match(script, /renderTraceDetail/);
  // Timeline entries come from real trace events only.
  assert.match(script, /const timeline=events\.map/);
  assert.match(script, /no fabricated|Real records only/);
  // Deterministic filters: event type + text, applied client-side.
  assert.match(script, /trace-type-filter/);
  assert.match(script, /trace-text-filter/);
  // Mission detail links into the Trace Center.
  assert.match(script, /View Trace/);
  // Distinguishes evidence vs verification vs receipt explicitly.
  assert.match(script, /Verification/);
  assert.match(script, /Evidence chain/);
  assert.match(script, /Receipt/);
});

test("P7 Artifact view is evidence-backed with no fabricated artifacts", () => {
  const script = studioScript();
  assert.match(script, /renderArtifacts/);
  // Every artifact row derives from a real tool output in a stored trace.
  assert.match(script, /call\.success&&call\.output/);
  assert.match(script, /no separate artifact store/);
});

test("P7 Audit view reads the real audit log and is distinct from traces", () => {
  const script = studioScript();
  assert.match(script, /renderAudit/);
  assert.match(script, /api\.audit/);
  assert.match(script, /distinct from trace observability/);
  assert.match(script, /redacted at this boundary/);
});

test("P7 legacy surfaces stay retired", () => {
  assert.equal(existsSync("dist/desktop"), false, "no desktop HTTP server ships in the build");
  assert.equal(existsSync("gui"), false, "the duplicate gui/ SPA stays retired");
  assert.equal(existsSync("src/desktop"), false, "no desktop server sources remain");
});
