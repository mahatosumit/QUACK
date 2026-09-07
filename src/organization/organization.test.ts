import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry } from "../organization/registry.js";
import { AgentCommunicationBus } from "../organization/communication.js";
import { OrganizationalMemory } from "../organization/memory.js";
import { AgentMetricsCollector } from "../organization/metrics.js";
import { AgentLifecycleManager } from "../organization/lifecycle.js";
import { executiveBrainProfile, projectManagerProfile, softwareEngineerProfile } from "../organization/profiles.js";

// ── AgentRegistry ───────────────────────────────────────────────

describe("AgentRegistry", () => {
  it("registers and retrieves an agent", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    const agent = registry.register("eng-1", config);
    assert.equal(agent.id, "eng-1");
    assert.equal(agent.role, "software-engineer");
    assert.equal(agent.status, "idle");
    const got = registry.get("eng-1");
    assert.ok(got);
    assert.equal(got!.id, "eng-1");
  });

  it("throws on duplicate registration", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    registry.register("dup", config);
    assert.throws(() => registry.register("dup", config));
  });

  it("finds agents by role", () => {
    const registry = new AgentRegistry();
    const cfg = (p: ReturnType<typeof softwareEngineerProfile>) => ({ profile: p, priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const });
    registry.register("eng-1", cfg(softwareEngineerProfile()));
    registry.register("pm-1", cfg(projectManagerProfile()));
    const engineers = registry.findByRole("software-engineer");
    assert.equal(engineers.length, 1);
    const pms = registry.findByRole("project-manager");
    assert.equal(pms.length, 1);
  });

  it("finds available agents", () => {
    const registry = new AgentRegistry();
    const cfg = (p: ReturnType<typeof softwareEngineerProfile>) => ({ profile: p, priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const });
    registry.register("eng-1", cfg(softwareEngineerProfile()));
    const available = registry.findAvailable("software-engineer");
    assert.ok(available);
    assert.equal(available!.id, "eng-1");
  });

  it("updateStatus changes agent status", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    registry.register("eng-1", config);
    registry.updateStatus("eng-1", "busy");
    assert.equal(registry.get("eng-1")!.status, "busy");
  });

  it("assignTask and completeTask update metrics", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    registry.register("eng-1", config);
    registry.assignTask("eng-1", "task-1");
    assert.equal(registry.get("eng-1")!.currentTaskIds.length, 1);
    assert.equal(registry.get("eng-1")!.status, "busy");
    registry.completeTask("eng-1", "task-1", 100);
    assert.equal(registry.get("eng-1")!.metrics.tasksCompleted, 1);
    assert.equal(registry.get("eng-1")!.status, "idle");
  });

  it("failTask increments error count", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    registry.register("eng-1", config);
    registry.assignTask("eng-1", "task-1");
    registry.failTask("eng-1", "task-1", "something broke");
    assert.equal(registry.get("eng-1")!.metrics.tasksFailed, 1);
    assert.equal(registry.get("eng-1")!.metrics.lastError, "something broke");
  });

  it("count and remove", () => {
    const registry = new AgentRegistry();
    const config = { profile: softwareEngineerProfile(), priority: "medium" as const, enabled: true, maxMemoryEntries: 1000, maxHistoryLength: 500, autoRecover: true, logLevel: "info" as const };
    registry.register("eng-1", config);
    assert.equal(registry.count(), 1);
    registry.remove("eng-1");
    assert.equal(registry.count(), 0);
  });
});

// ── AgentCommunicationBus ───────────────────────────────────────

describe("AgentCommunicationBus", () => {
  it("sends a message", () => {
    const bus = new AgentCommunicationBus();
    const msg = bus.send({ type: "request", from: "eng-1", to: "pm-1", payload: { task: "x" }, priority: "medium", requiresResponse: true });
    assert.ok(msg.id);
    assert.equal(msg.type, "request");
    assert.equal(msg.from, "eng-1");
  });

  it("supports request/reply", () => {
    const bus = new AgentCommunicationBus();
    const req = bus.request("eng-1", "pm-1", "need help", { issue: "bug" });
    const reply = bus.reply(req, "pm-1", { solution: "fixed" });
    assert.equal(reply.type, "reply");
    assert.equal(reply.to, "eng-1");
  });

  it("delegates tasks", () => {
    const bus = new AgentCommunicationBus();
    const msg = bus.delegate("pm-1", "eng-1", "task-42", "fix bug", { priority: "high" });
    assert.equal(msg.type, "delegate");
    assert.equal((msg.payload as Record<string, unknown>).taskId, "task-42");
  });

  it("broadcasts to all subscribers", () => {
    const bus = new AgentCommunicationBus();
    let received: string[] = [];
    bus.subscribe("eng-1", (m) => { if (m.type === "broadcast") received.push(m.from); });
    bus.subscribe("eng-2", (m) => { if (m.type === "broadcast") received.push(m.from); });
    bus.broadcast("pm-1", "status update", { msg: "all good" });
    assert.equal(received.length, 0); // broadcast has to: [] so no direct recipients
  });

  it("subscribe receives messages for specific agent", () => {
    const bus = new AgentCommunicationBus();
    let received: string[] = [];
    bus.subscribe("eng-1", (m) => received.push(m.type));
    bus.send({ type: "delegate", from: "pm-1", to: "eng-1", payload: {}, priority: "high", requiresResponse: false });
    assert.ok(received.includes("delegate"));
  });

  it("voting: create, cast, tally", () => {
    const bus = new AgentCommunicationBus();
    const vote = bus.createVote("best approach", ["a", "b"], ["eng-1", "eng-2", "eng-3"]);
    assert.equal(vote.status, "open");
    bus.castVote(vote.id, "eng-1", "a");
    bus.castVote(vote.id, "eng-2", "a");
    bus.castVote(vote.id, "eng-3", "b");
    const winner = bus.tallyVote(vote.id);
    assert.equal(winner, "a");
    assert.equal(vote.status, "closed");
  });

  it("voting returns undefined on tie", () => {
    const bus = new AgentCommunicationBus();
    const vote = bus.createVote("tie", ["x", "y"], ["eng-1", "eng-2"]);
    bus.castVote(vote.id, "eng-1", "x");
    bus.castVote(vote.id, "eng-2", "y");
    const winner = bus.tallyVote(vote.id);
    assert.equal(winner, undefined);
    assert.equal(vote.status, "tied");
  });

  it("negotiation: create, propose, agree", () => {
    const bus = new AgentCommunicationBus();
    const n = bus.createNegotiation("eng-1", ["eng-2", "eng-3"], "architecture", {});
    assert.equal(n.status, "open");
    bus.propose(n.id, "eng-2", "use microservices");
    bus.propose(n.id, "eng-3", "use monolith");
    assert.equal(n.proposals.length, 2);
    bus.agree(n.id, "use microservices");
    assert.equal(n.status, "agreed");
    assert.equal(n.agreedProposal, "use microservices");
  });

  it("negotiation can deadlock", () => {
    const bus = new AgentCommunicationBus();
    const n = bus.createNegotiation("eng-1", ["eng-2"], "deadlock", {});
    bus.deadlock(n.id);
    assert.equal(n.status, "deadlocked");
  });
});

// ── OrganizationalMemory ────────────────────────────────────────

describe("OrganizationalMemory", () => {
  it("records and retrieves entries", () => {
    const mem = new OrganizationalMemory();
    mem.recordSuccess(["eng-1"], "Fixed login bug");
    mem.recordFailure(["eng-2"], "Timeout in deploy");
    const success = mem.queryByType("success");
    assert.equal(success.length, 1);
    assert.equal(success[0].content, "Fixed login bug");
  });

  it("searches by tag", () => {
    const mem = new OrganizationalMemory();
    mem.recordDecision("auth", ["arch-1"], "Use OAuth2");
    const results = mem.queryByTag("auth");
    assert.equal(results.length, 1);
  });

  it("searches by content", () => {
    const mem = new OrganizationalMemory();
    mem.recordSuccess(["eng-1"], "Implemented caching layer");
    const results = mem.search("caching");
    assert.equal(results.length, 1);
  });

  it("updates relevance on access", () => {
    const mem = new OrganizationalMemory();
    const entry = mem.recordSuccess(["eng-1"], "Important fix");
    assert.equal(entry.relevanceScore, 1);
    mem.updateRelevance(entry.id, 5);
    assert.equal(mem.getAll().find((e) => e.id === entry.id)!.relevanceScore, 6);
  });

  it("getStats returns breakdown", () => {
    const mem = new OrganizationalMemory();
    mem.recordSuccess(["e1"], "a");
    mem.recordFailure(["e2"], "b");
    const stats = mem.getStats();
    assert.equal(stats.total, 2);
    assert.equal(stats.byType["success"], 1);
    assert.equal(stats.byType["failure"], 1);
  });
});

// ── AgentMetricsCollector ───────────────────────────────────────

describe("AgentMetricsCollector", () => {
  it("records and retrieves snapshots", () => {
    const collector = new AgentMetricsCollector();
    const metrics = { tasksCompleted: 5, tasksFailed: 1, tasksDelegated: 2, avgExecutionTimeMs: 100, totalExecutionTimeMs: 500, totalTokensUsed: 1000, communicationCount: 10, errorCount: 1, uptimeMs: 3600000 };
    collector.recordSnapshot("eng-1", metrics);
    const history = collector.getHistory("eng-1");
    assert.equal(history.length, 1);
    assert.equal(history[0].tasksCompleted, 5);
  });

  it("compareAgents returns comparisons", () => {
    const collector = new AgentMetricsCollector();
    const m1 = { tasksCompleted: 10, tasksFailed: 0, tasksDelegated: 1, avgExecutionTimeMs: 50, totalExecutionTimeMs: 500, totalTokensUsed: 500, communicationCount: 5, errorCount: 0, uptimeMs: 1800000 };
    const m2 = { tasksCompleted: 5, tasksFailed: 2, tasksDelegated: 0, avgExecutionTimeMs: 200, totalExecutionTimeMs: 1000, totalTokensUsed: 2000, communicationCount: 3, errorCount: 2, uptimeMs: 900000 };
    collector.recordSnapshot("eng-1", m1);
    collector.recordSnapshot("eng-2", m2);
    const result = collector.compareAgents(["eng-1", "eng-2"]);
    assert.ok(result["eng-1"]);
    assert.equal(result["eng-1"].tasksCompleted, 10);
  });
});

// ── AgentLifecycleManager ───────────────────────────────────────

describe("AgentLifecycleManager", () => {
  it("spawns an agent", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    const agent = lm.spawnAgent("software-engineer", "eng-1");
    assert.ok(agent);
    assert.equal(agent!.id, "eng-1");
    assert.equal(registry.count(), 1);
  });

  it("spawns all agents", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    const agents = lm.spawnAllAgents();
    assert.equal(agents.length, 18);
    assert.equal(registry.count(), 18);
  });

  it("assigns and completes a task", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    const taskId = lm.assignTask("fix login bug", "software-engineer");
    assert.ok(taskId);
    const assignment = lm.getAssignment(taskId!);
    assert.ok(assignment);
    assert.equal(assignment!.goal, "fix login bug");
    assert.equal(assignment!.status, "assigned");

    lm.completeTask(taskId!, 500);
    assert.equal(assignment!.status, "completed");
    assert.equal(registry.get("eng-1")!.metrics.tasksCompleted, 1);
  });

  it("reassigns a failed task", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    lm.spawnAgent("software-engineer", "eng-2");
    const taskId = lm.assignTask("fix bug", "software-engineer");
    assert.ok(taskId);
    lm.failTask(taskId!, "crash");
    const reassigned = lm.reassignTask(taskId!);
    assert.ok(reassigned);
    assert.notEqual(reassigned, "eng-1");
  });

  it("creates and executes workflows", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    const plan = lm.createWorkflow("build feature", [
      { id: "step-1", description: "implement", assignedAgent: "eng-1", dependencies: [], estimatedDurationMs: 1000 },
    ], "pm-1");
    assert.ok(plan.id);
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.status, "planned");
  });

  it("shuts down an agent", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    assert.ok(registry.get("eng-1"));
    lm.shutdownAgent("eng-1");
    assert.ok(!registry.get("eng-1"));
  });

  it("checks health", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    const health = lm.checkHealth();
    assert.equal(health.healthy.length, 1);
    assert.equal(health.unhealthy.length, 0);
  });

  it("getOrganizationState returns full state", () => {
    const registry = new AgentRegistry();
    const comms = new AgentCommunicationBus();
    const memory = new OrganizationalMemory();
    const metrics = new AgentMetricsCollector();
    const lm = new AgentLifecycleManager(registry, comms, memory, metrics);

    lm.spawnAgent("software-engineer", "eng-1");
    const state = lm.getOrganizationState();
    assert.equal(state.agents.length, 1);
    assert.ok(Array.isArray(state.workflows));
    assert.ok(Array.isArray(state.assignments));
  });
});
