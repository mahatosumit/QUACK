import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AgentRegistry, AgentCommunicationBus, OrganizationalMemory, AgentMetricsCollector, AgentLifecycleManager,
  createAgent, type BaseAgent,
} from "../distributions/compatibility.js";

function createOrg(): { registry: AgentRegistry; comms: AgentCommunicationBus; memory: OrganizationalMemory; metrics: AgentMetricsCollector; manager: AgentLifecycleManager } {
  const registry = new AgentRegistry();
  const comms = new AgentCommunicationBus();
  const memory = new OrganizationalMemory();
  const metrics = new AgentMetricsCollector();
  const manager = new AgentLifecycleManager(registry, comms, memory, metrics);
  manager.spawnAllAgents();
  return { registry, comms, memory, metrics, manager };
}

describe("Multi-Agent Integration", () => {
  // ── Agent Creation & Capabilities ──────────────────────────

  it("creates agent instances for all 18 roles", () => {
    const { manager } = createOrg();
    const state = manager.getOrganizationState();
    const roles = state.agents.map((a) => a.role);
    assert.equal(roles.length, 18);
    assert.ok(roles.includes("software-engineer"));
    assert.ok(roles.includes("architect"));
    assert.ok(roles.includes("tester"));
    assert.ok(roles.includes("security-engineer"));
    assert.ok(roles.includes("executive-brain"));
  });

  it("each agent has correct profile defaults", () => {
    const { manager } = createOrg();
    const execBrain = manager.getOrganizationState().agents.find((a) => a.role === "executive-brain")!;
    assert.equal(execBrain.config.profile.maxConcurrentTasks, 5);
    assert.equal(execBrain.config.profile.defaultPriority, "critical");
    assert.equal(execBrain.config.profile.requiresApproval, false);

    const se = manager.getOrganizationState().agents.find((a) => a.role === "software-engineer")!;
    assert.equal(se.config.profile.maxConcurrentTasks, 3);
    assert.equal(se.config.profile.defaultPriority, "medium");
  });

  it("createAgent returns correct agent class per role", () => {
    const { registry, comms } = createOrg();
    const instances = registry.getAll();
    for (const inst of instances) {
      const agent = createAgent(inst, comms);
      assert.equal(agent.role, inst.role);
    }
  });

  // ── Agent Communication ───────────────────────────────────

  it("agents can send and receive messages via communication bus", async () => {
    const { comms, registry } = createOrg();
    const se = registry.findByRole("software-engineer")[0];
    const arch = registry.findByRole("architect")[0];

    const messages: unknown[] = [];
    const unsub = comms.subscribe(se.id, (msg) => { messages.push(msg); });

    comms.send({ type: "request", from: arch.id, to: se.id, payload: { question: "review this design" }, priority: "high", requiresResponse: true });
    assert.equal(messages.length, 1);
    unsub();
  });

  it("agents can reply to messages", async () => {
    const { comms, registry } = createOrg();
    const se = registry.findByRole("software-engineer")[0];
    const arch = registry.findByRole("architect")[0];

    const incoming: unknown[] = [];
    comms.subscribe(arch.id, (msg) => { incoming.push(msg); });

    const req = comms.request(arch.id, se.id, "design review", { component: "auth" });
    comms.reply(req, se.id, { approved: true, suggestions: [] });

    assert.equal(incoming.length, 1);
    const reply = incoming[0] as { type: string; payload: unknown };
    assert.equal(reply.type, "reply");
  });

  it("unimplemented role execution returns a failed delegation result", async () => {
    const { comms, registry } = createOrg();
    const pm = registry.findByRole("project-manager")[0];
    const se = registry.findByRole("software-engineer")[0];

    const seAgent = createAgent(se, comms);
    seAgent.start();

    const messages: unknown[] = [];
    comms.subscribe(pm.id, (msg) => { messages.push(msg); });

    comms.delegate(pm.id, se.id, "task-1", "implement login", { priority: "high" });

    // Wait for async message processing
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(messages.length, 1);
    const result = messages[0] as { type: string; payload: { status: string } };
    assert.equal(result.type, "reply");
    assert.equal(result.payload.status, "failed");

    seAgent.stop();
  });

  // ── Task Assignment ────────────────────────────────────────

  it("assigns a task to an available agent", () => {
    const { manager, registry } = createOrg();
    const taskId = manager.assignTask("Fix login bug", "debugger", "high", { error: "401 on token refresh" });
    assert.ok(taskId);
    const assignment = manager.getAssignment(taskId!);
    assert.equal(assignment?.goal, "Fix login bug");
    assert.equal(assignment?.status, "assigned");

    const agent = registry.get(assignment!.assignedTo);
    assert.equal(agent?.status, "busy");
    assert.ok(agent?.currentTaskIds.includes(taskId!));
  });

  it("completes a task and updates agent metrics", () => {
    const { manager, registry } = createOrg();
    const taskId = manager.assignTask("Write unit tests", "tester", "medium")!;
    manager.completeTask(taskId, 1500);
    const agent = registry.get(manager.getAssignment(taskId)!.assignedTo);
    assert.equal(agent?.status, "idle");
    assert.equal(agent?.metrics.tasksCompleted, 1);
    assert.equal(agent?.metrics.totalExecutionTimeMs, 1500);
  });

  it("fails a task and increases error count", () => {
    const { manager, registry } = createOrg();
    const taskId = manager.assignTask("Deploy to prod", "devops-engineer", "high")!;
    manager.failTask(taskId, "Deploy script failed");
    const agent = registry.get(manager.getAssignment(taskId)!.assignedTo);
    assert.equal(agent?.metrics.tasksFailed, 1);
    assert.equal(agent?.metrics.errorCount, 1);
    assert.equal(agent?.metrics.lastError, "Deploy script failed");
  });

  it("reassigns a failed task to another agent of same role", () => {
    const { manager, registry } = createOrg();
    // Spawn a second software-engineer so reassign has a target
    manager.spawnAgent("software-engineer");
    const seList = registry.findByRole("software-engineer");
    assert.ok(seList.length >= 2);

    const firstTaskId = manager.assignTask("Build feature X", "software-engineer", "medium")!;
    manager.failTask(firstTaskId, "timeout");
    const newAgentId = manager.reassignTask(firstTaskId);
    assert.ok(newAgentId);
    assert.notEqual(newAgentId, seList[0].id);
  });

  it("fails to assign when no agents available", () => {
    const { manager, registry } = createOrg();
    const agents = registry.findByRole("software-engineer");
    for (const agent of agents) {
      registry.updateStatus(agent.id, "busy");
    }
    const taskId = manager.assignTask("Extra work", "software-engineer", "low");
    assert.equal(taskId, undefined);
  });

  // ── Workflows ──────────────────────────────────────────────

  it("creates a workflow with multiple steps", () => {
    const { manager } = createOrg();
    const workflow = manager.createWorkflow("Build auth system", [
      { id: "step-1", description: "Design auth architecture", assignedAgent: "architect-1", dependencies: [], estimatedDurationMs: 30000 },
      { id: "step-2", description: "Implement auth service", assignedAgent: "se-1", dependencies: ["step-1"], estimatedDurationMs: 60000 },
      { id: "step-3", description: "Test auth system", assignedAgent: "tester-1", dependencies: ["step-2"], estimatedDurationMs: 30000 },
    ], "pm-1");
    assert.equal(workflow.goal, "Build auth system");
    assert.equal(workflow.steps.length, 3);
    assert.equal(workflow.status, "planned");
    assert.equal(workflow.steps[0].status, "pending");
  });

  it("executes a workflow advancing through steps", () => {
    const { manager } = createOrg();
    const workflow = manager.createWorkflow("Simple task", [
      { id: "s1", description: "Step 1", assignedAgent: "software-engineer-1", dependencies: [], estimatedDurationMs: 1000 },
      { id: "s2", description: "Step 2", assignedAgent: "software-engineer-1", dependencies: ["s1"], estimatedDurationMs: 1000 },
    ], "pm-1");
    manager.executeWorkflow(workflow.id);
    const wf = manager.getWorkflow(workflow.id)!;
    assert.equal(wf.status, "running");
  });

  it("cancels a running workflow", () => {
    const { manager } = createOrg();
    const workflow = manager.createWorkflow("Cancellable work", [
      { id: "c1", description: "Cancellable step", assignedAgent: "software-engineer-1", dependencies: [], estimatedDurationMs: 10000 },
    ], "pm-1");
    manager.executeWorkflow(workflow.id);
    manager.cancelWorkflow(workflow.id);
    assert.equal(manager.getWorkflow(workflow.id)!.status, "cancelled");
  });

  // ── Agent Health ───────────────────────────────────────────

  it("reports all agents as healthy initially", () => {
    const { manager } = createOrg();
    const health = manager.checkHealth();
    assert.equal(health.healthy.length, 18);
    assert.equal(health.unhealthy.length, 0);
  });

  it("detects unhealthy agents after status change", () => {
    const { manager, registry } = createOrg();
    const agent = registry.getAll()[0];
    registry.updateStatus(agent.id, "error");
    const health = manager.checkHealth();
    assert.equal(health.unhealthy.length, 1);
    assert.equal(health.healthy.length, 17);
  });

  it("recovers an agent from error state", () => {
    const { manager, registry } = createOrg();
    const agent = registry.getAll()[0];
    registry.updateStatus(agent.id, "error");
    const recovered = manager.recoverAgent(agent.id);
    assert.ok(recovered);
    assert.equal(registry.get(agent.id)?.status, "idle");
  });

  // ── Organizational Memory ─────────────────────────────────

  it("records tasks in organizational memory", () => {
    const { manager, memory } = createOrg();
    manager.assignTask("Build feature", "software-engineer", "high");
    const stats = memory.getStats();
    assert.ok(stats.total > 0);
    assert.ok(stats.byType["decision"] > 0);
  });

  it("records completed and failed tasks in memory", () => {
    const { manager, memory } = createOrg();
    const t1 = manager.assignTask("Success", "tester", "low")!;
    manager.completeTask(t1, 100);
    const t2 = manager.assignTask("Failure", "tester", "low")!;
    manager.failTask(t2, "oops");

    const successes = memory.queryByType("success");
    const failures = memory.queryByType("failure");
    assert.ok(successes.length >= 1);
    assert.ok(failures.length >= 1);
  });

  // ── Agent Metrics ──────────────────────────────────────────

  it("captures agent metrics snapshots on task completion", () => {
    const { manager, metrics } = createOrg();
    const taskId = manager.assignTask("Test metrics", "tester", "medium")!;
    manager.completeTask(taskId, 500);
    const history = metrics.getHistory(manager.getAssignment(taskId)!.assignedTo);
    assert.ok(history.length >= 1);
    assert.equal(history[history.length - 1].tasksCompleted, 1);
  });

  it("compares agents by performance", () => {
    const { manager, metrics, registry } = createOrg();
    const se1 = manager.assignTask("Task A", "software-engineer", "high")!;
    manager.completeTask(se1, 200);
    const se2 = manager.assignTask("Task B", "software-engineer", "high")!;
    manager.completeTask(se2, 400);

    const seIds = registry.findByRole("software-engineer").map((a) => a.id);
    const comparison = metrics.compareAgents(seIds);
    assert.equal(Object.keys(comparison).length, seIds.length);
  });

  // ── Voting & Negotiation ──────────────────────────────────

  it("conducts a vote among agents and closes with winner", () => {
    const { comms, registry } = createOrg();
    const voters = registry.findByRole("architect").map((a) => a.id);
    const vote = comms.createVote("Choose framework", ["react", "vue", "svelte"], voters);
    for (const v of voters) comms.castVote(vote.id, v, "react");
    const result = comms.tallyVote(vote.id);
    assert.equal(result, "react");
  });

  it("detects a tied vote", () => {
    const { comms } = createOrg();
    const vote = comms.createVote("Tie test", ["a", "b"], ["agent-1", "agent-2"]);
    comms.castVote(vote.id, "agent-1", "a");
    comms.castVote(vote.id, "agent-2", "b");
    const result = comms.tallyVote(vote.id);
    assert.equal(result, undefined);
    assert.equal(vote.status, "tied");
  });

  it("runs a negotiation between agents", () => {
    const { comms } = createOrg();
    // Use agents of different roles to have 2+ participants
    const n = comms.createNegotiation("agent-a", ["agent-a", "agent-b"], "API design", { complexity: "high" });
    assert.ok(comms.propose(n.id, "agent-a", "Use REST"));
    assert.ok(comms.propose(n.id, "agent-b", "Use GraphQL"));
    assert.ok(comms.agree(n.id, "Use REST"));
    assert.equal(n.status, "agreed");
    assert.equal(n.agreedProposal, "Use REST");
  });
});
