import { type JsonObject } from "../../core/types.js";
import { type QuackEvent } from "../../events/event-bus.js";
import { collectMetrics, type MissionTrace } from "../../harness/index.js";
import { type ApiMissionRecord } from "../../server/index.js";
import { type StoredMissionEvaluation } from "../../storage/sqlite.js";
import { type SkillRecord } from "../../skills/types.js";
import { type SpecialistAgentDefinition } from "../../agents/index.js";

export interface DashboardMissionView {
  readonly active: readonly ApiMissionRecord[];
  readonly completed: readonly ApiMissionRecord[];
  readonly failed: readonly ApiMissionRecord[];
  readonly all: readonly ApiMissionRecord[];
}

export interface DashboardAgentView {
  readonly agents: readonly {
    readonly id: string;
    readonly name: string;
    readonly trustLevel: string;
    readonly specialization: readonly string[];
    readonly executionState: "available" | "assigned";
    readonly assignedMissions: readonly string[];
  }[];
}

export interface DashboardSkillView {
  readonly skills: readonly {
    readonly id: string;
    readonly version: string;
    readonly name: string;
    readonly validationStatus: string;
    readonly executionHistory: {
      readonly useCount: number;
      readonly avgDurationMs: number;
    };
  }[];
}

export interface DashboardSecurityView {
  readonly capabilityRequests: readonly QuackEvent[];
  readonly decisions: readonly QuackEvent[];
  readonly permissionFailures: readonly QuackEvent[];
}

export interface DashboardHarnessView {
  readonly traces: readonly MissionTrace[];
  readonly evaluations: readonly StoredMissionEvaluation[];
  readonly failures: readonly QuackEvent[];
  readonly latencyMetrics: {
    readonly avgLatencyMs: number;
    readonly traceCount: number;
  };
}

export interface DashboardState {
  readonly generatedAt: string;
  readonly missions: DashboardMissionView;
  readonly agents: DashboardAgentView;
  readonly skills: DashboardSkillView;
  readonly security: DashboardSecurityView;
  readonly harness: DashboardHarnessView;
}

export function buildDashboardState(input: {
  readonly missions: readonly ApiMissionRecord[];
  readonly agents: readonly SpecialistAgentDefinition[];
  readonly skills: readonly SkillRecord[];
  readonly traces: readonly MissionTrace[];
  readonly evaluations: readonly StoredMissionEvaluation[];
  readonly events: readonly QuackEvent[];
}): DashboardState {
  const active = input.missions.filter((mission) => mission.state === "QUEUED" || mission.state === "RUNNING");
  const completed = input.missions.filter((mission) => mission.state === "COMPLETED");
  const failed = input.missions.filter((mission) => mission.state === "FAILED");
  const capabilityRequests = input.events.filter((event) => event.type === "capability.requested");
  const decisions = input.events.filter((event) => event.type === "capability.allowed" || event.type === "capability.denied");
  const permissionFailures = input.events.filter((event) =>
    event.type === "capability.denied" ||
    (event.type.endsWith(".failed") && event.payload["error"] !== undefined)
  );
  const traceMetrics = input.traces.map((trace) => collectMetrics(trace));
  const avgLatencyMs = traceMetrics.length === 0
    ? 0
    : Math.round(traceMetrics.reduce((total, metrics) => total + metrics.executionLatencyMs, 0) / traceMetrics.length);

  return {
    generatedAt: new Date().toISOString(),
    missions: {
      active,
      completed,
      failed,
      all: [...input.missions],
    },
    agents: {
      agents: input.agents.map((agent) => ({
        id: agent.identity.id,
        name: agent.identity.name,
        trustLevel: agent.trustLevel,
        specialization: [...agent.specialization],
        executionState: assignedMissions(agent, active).length > 0 ? "assigned" : "available",
        assignedMissions: assignedMissions(agent, active),
      })),
    },
    skills: {
      skills: input.skills.map((skill) => ({
        id: skill.id,
        version: skill.manifest.version,
        name: skill.manifest.name,
        validationStatus: skill.status,
        executionHistory: {
          useCount: skill.useCount,
          avgDurationMs: skill.avgDurationMs,
        },
      })),
    },
    security: {
      capabilityRequests,
      decisions,
      permissionFailures,
    },
    harness: {
      traces: [...input.traces],
      evaluations: [...input.evaluations],
      failures: input.events.filter((event) => event.type.endsWith(".failed")),
      latencyMetrics: {
        avgLatencyMs,
        traceCount: input.traces.length,
      },
    },
  };
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QUACK OS Dashboard</title>
  <link rel="stylesheet" href="/dashboard/styles.css">
</head>
<body>
  <header class="topbar">
    <div>
      <h1>QUACK OS</h1>
      <p id="status-line">Connecting to runtime...</p>
    </div>
    <input id="search" type="search" placeholder="Filter missions, agents, skills, events">
  </header>
  <main class="layout">
    <section class="panel" data-panel="missions">
      <h2>Mission View</h2>
      <div class="stats" id="mission-stats"></div>
      <div class="list" id="missions"></div>
    </section>
    <section class="panel" data-panel="agents">
      <h2>Agent View</h2>
      <div class="list" id="agents"></div>
    </section>
    <section class="panel" data-panel="skills">
      <h2>Skill View</h2>
      <div class="list" id="skills"></div>
    </section>
    <section class="panel" data-panel="security">
      <h2>Security View</h2>
      <div class="stats" id="security-stats"></div>
      <div class="list" id="security"></div>
    </section>
    <section class="panel wide" data-panel="harness">
      <h2>Harness View</h2>
      <div class="stats" id="harness-stats"></div>
      <div class="list" id="harness"></div>
    </section>
  </main>
  <script src="/dashboard/app.js"></script>
</body>
</html>`;
}

export function dashboardStyles(): string {
  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #172026;
  background: #f6f7f9;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid #d7dde3;
  background: #ffffff;
  position: sticky;
  top: 0;
  z-index: 2;
}
h1, h2, p { margin: 0; }
h1 { font-size: 22px; line-height: 1.2; }
h2 { font-size: 15px; margin-bottom: 12px; }
#status-line { color: #5f6f7a; font-size: 13px; margin-top: 4px; }
#search {
  width: min(420px, 44vw);
  min-height: 36px;
  border: 1px solid #c7d0d9;
  border-radius: 6px;
  padding: 8px 10px;
  font: inherit;
}
.layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 16px;
}
.panel {
  background: #ffffff;
  border: 1px solid #dce2e8;
  border-radius: 8px;
  padding: 14px;
  min-height: 220px;
}
.wide { grid-column: 1 / -1; }
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.stat {
  border: 1px solid #d7dde3;
  border-radius: 6px;
  padding: 6px 8px;
  background: #f9fafb;
  font-size: 12px;
}
.list {
  display: grid;
  gap: 8px;
}
.item {
  border: 1px solid #e2e7ec;
  border-radius: 6px;
  padding: 10px;
  background: #fcfdfe;
}
.item strong { display: block; font-size: 13px; margin-bottom: 4px; }
.meta { color: #5f6f7a; font-size: 12px; line-height: 1.45; word-break: break-word; }
.state-COMPLETED, .state-allowed { color: #11733a; }
.state-FAILED, .state-denied { color: #b42318; }
.state-RUNNING, .state-QUEUED { color: #925a00; }
.empty { color: #6c7a86; font-size: 13px; }
@media (max-width: 760px) {
  .topbar { align-items: stretch; flex-direction: column; }
  #search { width: 100%; }
  .layout { grid-template-columns: 1fr; padding: 10px; }
}`;
}

export function dashboardScript(): string {
  return `"use strict";
const stateUrl = "/dashboard/state";
const eventUrl = "/events";
let current = null;
let events = [];
let filter = "";

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const visible = (text) => !filter || String(text).toLowerCase().includes(filter);

byId("search").addEventListener("input", (event) => {
  filter = event.target.value.trim().toLowerCase();
  render();
});

async function loadState() {
  const response = await fetch(stateUrl);
  current = await response.json();
  render();
}

function connectEvents() {
  const source = new EventSource(eventUrl);
  source.onopen = () => setStatus("Live event stream connected.");
  source.onerror = () => setStatus("Event stream reconnecting...");
  source.onmessage = (event) => appendEvent(event.data);
  ["task.created", "loop.started", "loop.completed", "loop.failed", "capability.requested", "capability.allowed", "capability.denied", "trace.created", "evaluation.completed"].forEach((type) => {
    source.addEventListener(type, (event) => appendEvent(event.data));
  });
}

function appendEvent(raw) {
  try {
    events.unshift(JSON.parse(raw));
    events = events.slice(0, 80);
    loadState().catch(() => render());
  } catch {
    render();
  }
}

function setStatus(text) {
  byId("status-line").textContent = text;
}

function render() {
  if (!current) {
    setStatus("Loading dashboard data...");
    return;
  }
  setStatus("Updated " + new Date(current.generatedAt).toLocaleTimeString());
  renderMissions();
  renderAgents();
  renderSkills();
  renderSecurity();
  renderHarness();
}

function renderMissions() {
  const missions = current.missions.all.filter((mission) => visible(JSON.stringify(mission)));
  byId("mission-stats").innerHTML = [
    stat("Active", current.missions.active.length),
    stat("Completed", current.missions.completed.length),
    stat("Failed", current.missions.failed.length)
  ].join("");
  byId("missions").innerHTML = missions.length ? missions.map((mission) => item(
    mission.goal,
    '<span class="state-' + mission.state + '">' + mission.state + '</span> · ' +
    'iterations ' + mission.iterations + ' · ' + (mission.loopId || mission.id)
  )).join("") : empty("No missions available.");
}

function renderAgents() {
  const agents = current.agents.agents.filter((agent) => visible(JSON.stringify(agent)));
  byId("agents").innerHTML = agents.length ? agents.map((agent) => item(
    agent.name,
    agent.executionState + " · " + agent.trustLevel + " · " + agent.specialization.join(", ") +
    (agent.assignedMissions.length ? " · assigned " + agent.assignedMissions.join(", ") : "")
  )).join("") : empty("No agents registered.");
}

function renderSkills() {
  const skills = current.skills.skills.filter((skill) => visible(JSON.stringify(skill)));
  byId("skills").innerHTML = skills.length ? skills.map((skill) => item(
    skill.name,
    skill.id + "@" + skill.version + " · " + skill.validationStatus +
    " · used " + skill.executionHistory.useCount + " time(s)"
  )).join("") : empty("No skills loaded.");
}

function renderSecurity() {
  const decisions = current.security.decisions.filter((event) => visible(JSON.stringify(event)));
  byId("security-stats").innerHTML = [
    stat("Requests", current.security.capabilityRequests.length),
    stat("Decisions", current.security.decisions.length),
    stat("Failures", current.security.permissionFailures.length)
  ].join("");
  byId("security").innerHTML = decisions.length ? decisions.map((event) => item(
    event.type,
    '<span class="state-' + (event.payload.decision || "") + '">' + (event.payload.decision || "decision") + '</span> · ' +
    (event.payload.capabilityId || "unknown") + " · " + event.timestamp
  )).join("") : empty("No capability decisions yet.");
}

function renderHarness() {
  const traces = current.harness.traces.filter((trace) => visible(JSON.stringify(trace)));
  byId("harness-stats").innerHTML = [
    stat("Traces", current.harness.traces.length),
    stat("Evaluations", current.harness.evaluations.length),
    stat("Avg latency", current.harness.latencyMetrics.avgLatencyMs + "ms")
  ].join("");
  byId("harness").innerHTML = traces.length ? traces.map((trace) => item(
    trace.missionInput.goal,
    (trace.finalOutcome.success ? "success" : "failed") + " · " +
    trace.finalOutcome.latencyMs + "ms · " + trace.id
  )).join("") : empty("No traces captured.");
}

function stat(label, value) {
  return '<span class="stat">' + escapeHtml(label) + ': ' + escapeHtml(value) + '</span>';
}

function item(title, meta) {
  return '<article class="item"><strong>' + escapeHtml(title) + '</strong><div class="meta">' + meta + '</div></article>';
}

function empty(text) {
  return '<p class="empty">' + escapeHtml(text) + '</p>';
}

loadState().catch((error) => setStatus("Dashboard data unavailable: " + error.message));
connectEvents();`;
}

function assignedMissions(agent: SpecialistAgentDefinition, active: readonly ApiMissionRecord[]): string[] {
  return active
    .filter((mission) => agent.specialization.some((term) => mission.goal.toLowerCase().includes(term.toLowerCase())))
    .map((mission) => mission.id);
}
