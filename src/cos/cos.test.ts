import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, AgentCommunicationBus, OrganizationalMemory, AgentMetricsCollector, AgentLifecycleManager } from "../organization/index.js";
import {
  GoalManager, TimeManager, ResourceManager, PriorityManager,
  DecisionEngine, CouncilEngine, MissionManager, StrategyEngine,
  ExperienceEngine, LearningEngine, GovernanceEngine,
  OrganizationalIntelligence, MetricsEngine, ProgressTracker,
  ContextManager, CapabilityManager, SkillEvolutionEngine,
  createCos, type CosDependencies,
} from "../cos/index.js";

function createDeps(): CosDependencies {
  const registry = new AgentRegistry();
  const comms = new AgentCommunicationBus();
  const orgMemory = new OrganizationalMemory();
  const agentMetrics = new AgentMetricsCollector();
  const lifecycleManager = new AgentLifecycleManager(registry, comms, orgMemory, agentMetrics);
  lifecycleManager.spawnAllAgents();
  return { registry, comms, orgMemory, agentMetrics, lifecycleManager };
}

describe("COS — GoalManager", () => {
  it("creates a goal with full lifecycle", () => {
    const gm = new GoalManager();
    const goal = gm.create({ mission: "Build auth system", objectives: ["Design", "Implement", "Test"], priority: "high" });
    assert.ok(goal.id);
    assert.equal(goal.status, "draft");
    assert.equal(goal.priority, "high");
    assert.equal(goal.objectives.length, 3);

    assert.ok(gm.activate(goal.id));
    assert.equal(gm.get(goal.id)!.status, "active");

    assert.ok(gm.pause(goal.id));
    assert.equal(gm.get(goal.id)!.status, "paused");

    assert.ok(gm.activate(goal.id));
    assert.equal(gm.get(goal.id)!.status, "active");
    assert.ok(gm.complete(goal.id));
    assert.equal(gm.get(goal.id)!.status, "completed");
    assert.equal(gm.get(goal.id)!.progress, 100);
  });

  it("manages milestones", () => {
    const gm = new GoalManager();
    const g = gm.create({ mission: "Release v2", objectives: ["Feature A", "Feature B"] });
    const ms1 = gm.addMilestone(g.id, "Design complete", "2026-12-31");
    const ms2 = gm.addMilestone(g.id, "Testing complete");
    assert.ok(ms1); assert.ok(ms2);
    assert.equal(g.milestones.length, 2);

    gm.completeMilestone(g.id, ms1!.id);
    assert.equal(g.milestones[0].status, "completed");
    assert.equal(g.progress, 50);
  });

  it("tracks overdue goals", () => {
    const gm = new GoalManager();
    const g = gm.create({ mission: "Quick task", objectives: ["Do it"], deadline: "2020-01-01" });
    gm.activate(g.id);
    assert.equal(gm.getOverdue().length, 1);
  });

  it("provides stats", () => {
    const gm = new GoalManager();
    gm.create({ mission: "A", objectives: ["a"] });
    const g2 = gm.create({ mission: "B", objectives: ["b"] });
    gm.activate(g2.id);
    gm.complete(g2.id);
    const stats = gm.getStats();
    assert.equal(stats.total, 2);
    assert.equal(stats.completed, 1);
  });
});

describe("COS — TimeManager", () => {
  it("records timeline entries", () => {
    const tm = new TimeManager();
    tm.recordEntry("goal-1", { type: "goal_created", description: "Created", relatedIds: [] });
    tm.recordEntry("goal-1", { type: "milestone_reached", description: "Phase 1 done", relatedIds: ["ms-1"] });
    assert.equal(tm.getTimeline("goal-1").length, 2);
  });

  it("manages recurring reviews", () => {
    const tm = new TimeManager();
    const r = tm.addRecurringReview({ cadence: "daily", description: "Daily standup" });
    assert.ok(r.id);
    assert.equal(tm.getAllReviews().length, 1);
  });

  it("tracks time budgets", () => {
    const tm = new TimeManager();
    tm.setTimeBudget("goal-1", 3600000);
    tm.recordTimeSpent("goal-1", 60000);
    const budget = tm.getTimeBudget("goal-1");
    assert.equal(budget?.usedMs, 60000);
    assert.equal(budget?.remainingMs, 3540000);
  });

  it("handles reminders", () => {
    const tm = new TimeManager();
    tm.addReminder("goal-1", "Review needed", "2000-01-01");
    const due = tm.getDueReminders();
    assert.equal(due.length, 1);
    assert.equal(due[0].message, "Review needed");
  });
});

describe("COS — ResourceManager", () => {
  it("reports available capacity", () => {
    const deps = createDeps();
    const rm = new ResourceManager(deps.registry);
    const plan = rm.getCapacityPlan();
    assert.ok(plan.length > 0);
    const se = plan.find((p) => p.role === "software-engineer");
    assert.ok(se);
    assert.equal(se!.available, 1);
  });

  it("tracks allocations", () => {
    const deps = createDeps();
    const rm = new ResourceManager(deps.registry);
    rm.recordAllocation("agent-1", "task-1", 5000);
    const allocs = rm.getAgentAllocations("agent-1");
    assert.equal(allocs.length, 1);
  });
});

describe("COS — PriorityManager", () => {
  it("enqueues and dequeues by priority", () => {
    const gm = new GoalManager();
    const pm = new PriorityManager();
    const low = gm.create({ mission: "Low", objectives: ["x"], priority: "low" });
    const high = gm.create({ mission: "High", objectives: ["x"], priority: "high" });
    pm.enqueue(low);
    pm.enqueue(high);
    assert.equal(pm.peek(), high.id);
    assert.equal(pm.dequeue(), high.id);
    assert.equal(pm.dequeue(), low.id);
  });

  it("reorders goals", () => {
    const gm = new GoalManager();
    const pm = new PriorityManager();
    const g1 = gm.create({ mission: "A", objectives: ["a"] });
    const g2 = gm.create({ mission: "B", objectives: ["b"] });
    pm.reorder(gm.getAll());
    assert.equal(pm.getQueue().length, 2);
  });
});

describe("COS — DecisionEngine", () => {
  it("creates, makes, implements, and reviews decisions", () => {
    const de = new DecisionEngine();
    const d = de.create({
      problem: "Choose database",
      alternatives: [
        { name: "Postgres", description: "SQL", pros: ["Reliable"], cons: ["Slow writes"] },
        { name: "Mongo", description: "NoSQL", pros: ["Fast"], cons: ["No joins"] },
      ],
      madeBy: "architect-1",
      participants: ["architect-1", "se-1"],
      tags: ["database"],
    });
    assert.equal(d.status, "pending");

    de.make(d.id, "Postgres", "Need ACID", "Reliable data", "Postgres (2/3)");
    assert.equal(de.get(d.id)!.status, "made");

    de.implement(d.id);
    assert.equal(de.get(d.id)!.status, "implemented");

    de.review(d.id, "Works well", ["success"]);
    assert.equal(de.get(d.id)!.status, "reviewed");
  });

  it("searches decisions", () => {
    const de = new DecisionEngine();
    de.create({ problem: "API design", alternatives: [], madeBy: "architect-1" });
    assert.equal(de.search("API").length, 1);
    assert.equal(de.search("nonexistent").length, 0);
  });
});

describe("COS — CouncilEngine", () => {
  it("assembles a council for a matching topic", () => {
    const deps = createDeps();
    const ce = new CouncilEngine(deps.comms, deps.registry);
    const session = ce.assemble("architecture review for new module", "executive-brain-1");
    assert.ok(session);
    assert.ok(session!.participants.length >= 2);
    assert.equal(session!.status, "assembling");
  });

  it("returns undefined when not enough participants", () => {
    const deps = createDeps();
    for (const agent of deps.registry.getAll()) {
      deps.registry.updateStatus(agent.id, "busy");
    }
    const ce = new CouncilEngine(deps.comms, deps.registry);
    const session = ce.assemble("test topic", "executive-brain-1");
    assert.equal(session, undefined);
  });

  it("adds evidence and alternatives", () => {
    const deps = createDeps();
    const ce = new CouncilEngine(deps.comms, deps.registry);
    const s = ce.assemble("security review", "security-engineer-1")!;

    ce.addEvidence(s.id, "security-engineer-1", "Found SQL injection risk");
    assert.equal(s.evidence.length, 1);

    ce.addAlternative(s.id, "Use parameterized queries");
    assert.equal(s.alternatives.length, 1);
  });

  it("casts votes and tallies", () => {
    const deps = createDeps();
    const ce = new CouncilEngine(deps.comms, deps.registry);
    const s = ce.assemble("architecture topic", "architect-1")!;

    for (const p of s.participants) {
      ce.castVote(s.id, p.agentId, "Option A");
    }

    ce.conclude(s.id, "dec-1");
    assert.equal(s.status, "concluded");
  });
});

describe("COS — ExperienceEngine", () => {
  it("saves and retrieves experiences", () => {
    const ee = new ExperienceEngine();
    const exp = ee.save({
      title: "Fix OAuth null pointer",
      category: "bugfix",
      description: "Null check on token response",
      context: ["Node.js", "OAuth", "passport"],
      steps: ["Add null guard", "Add test"],
      createdBy: "se-1",
    });
    assert.ok(exp.id);
    assert.equal(exp.category, "bugfix");

    const found = ee.search("OAuth");
    assert.equal(found.length, 1);
  });

  it("recommends experiences by context", () => {
    const ee = new ExperienceEngine();
    ee.save({ title: "React performance fix", category: "optimization", description: "Use React.memo for pure components", context: ["React", "performance", "memo"], steps: [], createdBy: "se-1" });
    ee.save({ title: "Docker build", category: "deployment", description: "Multi-stage build for Node", context: ["Docker", "deploy", "container"], steps: [], createdBy: "devops-1" });
    const recs = ee.recommend(["React", "memo", "performance"]);
    assert.ok(recs.length >= 1);
    assert.equal(recs[0].category, "optimization");
  });

  it("tracks usage and boosts relevance", () => {
    const ee = new ExperienceEngine();
    const exp = ee.save({ title: "Logging pattern", category: "pattern", description: "Structured logging", context: ["logging"], steps: [], createdBy: "se-1" });
    ee.recordUsage(exp.id);
    assert.equal(ee.get(exp.id)!.usageCount, 1);
    assert.equal(ee.get(exp.id)!.relevance, 1.5);
  });
});

describe("COS — LearningEngine", () => {
  it("records learning from success and failure", () => {
    const le = new LearningEngine();
    const l1 = le.recordFromSuccess("Parallel testing", "Run tests in parallel for 3x speed", ["test-runner.ts"]);
    assert.ok(l1.id);
    assert.equal(l1.confidence, 0.8);

    const l2 = le.recordFromFailure("Memory leak", "Always clean up event listeners", ["event-bus.ts"]);
    assert.equal(l2.confidence, 0.6);
  });

  it("applies learning and increases confidence", () => {
    const le = new LearningEngine();
    const l = le.record({ pattern: "X", insight: "Y", category: "workflow" });
    le.apply(l.id);
    assert.equal(le.get(l.id)!.appliedCount, 1);
    assert.equal(le.get(l.id)!.confidence, 0.6);
  });

  it("finds high-confidence records", () => {
    const le = new LearningEngine();
    le.record({ pattern: "P1", insight: "I1", category: "agent", confidence: 0.9 });
    le.record({ pattern: "P2", insight: "I2", category: "agent", confidence: 0.5 });
    assert.equal(le.findHighConfidence(0.7).length, 1);
  });

  it("integrates with org memory", () => {
    const om = new OrganizationalMemory();
    const le = new LearningEngine(om);
    le.record({ pattern: "Test pattern", insight: "Test insight", category: "architecture" });
    const entries = om.queryByType("lesson");
    assert.ok(entries.length >= 1);
    assert.ok(entries[0].content.includes("Test pattern"));
  });
});

describe("COS — GovernanceEngine", () => {
  it("creates and enforces policies", () => {
    const ge = new GovernanceEngine();
    const p = ge.create({ name: "Code Review Required", description: "All PRs need review", scope: "workflow", rules: [{ field: "reviewCount", condition: "gte", value: 1 }] });
    assert.ok(p.id);

    const pass = ge.enforce(p.id, { reviewCount: 2 });
    assert.ok(pass.passed);

    const fail = ge.enforce(p.id, { reviewCount: 0 });
    assert.equal(fail.passed, false);
    assert.equal(fail.violations.length, 1);
  });

  it("supports multiple rule conditions", () => {
    const ge = new GovernanceEngine();
    const p = ge.create({ name: "Test rules", description: "All conditions", scope: "global", rules: [
      { field: "name", condition: "eq", value: "hello" },
      { field: "count", condition: "gt", value: 0 },
      { field: "tags", condition: "in", value: ["a", "b"] },
      { field: "email", condition: "exists", value: null },
    ]});
    assert.ok(ge.enforce(p.id, { name: "hello", count: 5, tags: "a", email: "x@y.com" }).passed);
    assert.equal(ge.enforce(p.id, { name: "bad", count: 5, tags: "a", email: "x@y.com" }).passed, false);
  });

  it("tracks stats", () => {
    const ge = new GovernanceEngine();
    ge.create({ name: "P1", description: "D1", scope: "agent", rules: [] });
    ge.create({ name: "P2", description: "D2", scope: "workflow", rules: [] });
    const stats = ge.getStats();
    assert.equal(stats.total, 2);
  });
});

describe("COS — MissionManager", () => {
  it("creates and manages missions", () => {
    const mm = new MissionManager();
    const m = mm.create({ name: "Q4 Release", description: "Ship v2.0", priority: "high" });
    assert.equal(m.status, "draft");

    mm.activate(m.id);
    assert.equal(mm.get(m.id)!.status, "active");

    mm.addGoal(m.id, "goal-1");
    mm.addGoal(m.id, "goal-2");
    assert.equal(mm.get(m.id)!.goals.length, 2);

    mm.complete(m.id);
    assert.equal(mm.getActive().length, 0);
  });

  it("notifies activation listeners once a draft mission becomes active", () => {
    const mm = new MissionManager();
    const activated: string[] = [];
    const unsubscribe = mm.onActivate((mission) => activated.push(mission.id));
    const m = mm.create({ name: "Capability scoped mission", description: "Load grants" });

    assert.equal(mm.activate(m.id), true);
    assert.deepEqual(activated, [m.id]);

    assert.equal(mm.activate(m.id), false);
    assert.deepEqual(activated, [m.id]);

    unsubscribe();
  });
});

describe("COS — StrategyEngine", () => {
  it("generates a strategy from a goal", () => {
    const gm = new GoalManager();
    const se = new StrategyEngine();
    const g = gm.create({ mission: "Build feature", objectives: ["Design", "Code", "Test"] });
    const s = se.generateForGoal(g);
    assert.equal(s.goalId, g.id);
    assert.equal(s.taskGraph.length, 3);
    assert.ok(s.approach.includes("3 objectives"));
  });

  it("manages strategy lifecycle", () => {
    const se = new StrategyEngine();
    const s = se.create({ goalId: "g-1", approach: "Agile" });
    assert.equal(s.status, "draft");
    se.approve(s.id);
    assert.equal(se.get(s.id)!.status, "approved");
    se.activate(s.id);
    assert.equal(se.get(s.id)!.status, "active");
    se.complete(s.id);
    assert.equal(se.get(s.id)!.status, "completed");
  });
});

describe("COS — OrganizationalIntelligence", () => {
  it("takes a snapshot of org state", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const s = oi.snapshot();
    assert.ok(s.timestamp);
    assert.equal(s.agentUtilization.total, 18);
    assert.equal(typeof s.taskCompletionRate, "number");
  });

  it("detects knowledge gaps", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const gaps = oi.getKnowledgeGaps();
    assert.ok(Array.isArray(gaps));
  });

  it("computes health summary", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const health = oi.getHealthSummary();
    assert.ok(typeof health.score === "number");
    assert.ok(Array.isArray(health.issues));
  });
});

describe("COS — MetricsEngine", () => {
  it("captures a snapshot", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const de = new DecisionEngine();
    const ee = new ExperienceEngine();
    const le = new LearningEngine();
    const ge = new GovernanceEngine();
    const me = new MetricsEngine(deps.registry, deps.orgMemory, deps.agentMetrics, gm, de, ee, le, ge, deps.lifecycleManager);
    const s = me.snapshot();
    assert.ok(s.timestamp);
    assert.equal(typeof s.goals.total, "number");
    assert.equal(typeof s.agents.total, "number");
  });

  it("tracks history and trends", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const de = new DecisionEngine();
    const ee = new ExperienceEngine();
    const le = new LearningEngine();
    const ge = new GovernanceEngine();
    const me = new MetricsEngine(deps.registry, deps.orgMemory, deps.agentMetrics, gm, de, ee, le, ge, deps.lifecycleManager);
    me.snapshot();
    me.snapshot();
    assert.equal(me.getHistory().length, 2);
  });
});

describe("COS — ProgressTracker", () => {
  it("reports overall progress", () => {
    const gm = new GoalManager();
    const tm = new TimeManager();
    const pt = new ProgressTracker(gm, tm);
    const p = pt.getOverallProgress();
    assert.equal(p.totalCompleted, 0);
    assert.equal(p.totalActive, 0);
  });

  it("detects at-risk goals", () => {
    const gm = new GoalManager();
    const tm = new TimeManager();
    const pt = new ProgressTracker(gm, tm);
    const g = gm.create({ mission: "Urgent", objectives: ["x"], deadline: "2099-01-01" });
    gm.activate(g.id);
    assert.equal(pt.getOnTrack().length, 1);
  });
});

describe("COS — ContextManager", () => {
  it("builds a context frame", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const de = new DecisionEngine();
    const ee = new ExperienceEngine();
    const cm = new ContextManager(gm, de, ee, deps.registry);
    const frame = cm.buildFrame();
    assert.ok(frame.id);
    assert.ok(Array.isArray(frame.activeGoalIds));
    assert.ok(frame.createdAt);
  });

  it("manages attention stack", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const de = new DecisionEngine();
    const ee = new ExperienceEngine();
    const cm = new ContextManager(gm, de, ee, deps.registry);
    cm.setAttention("goal-1");
    cm.setAttention("goal-2");
    assert.equal(cm.getAttention().length, 2);
    assert.equal(cm.getAttention()[0], "goal-1");
  });
});

describe("COS — CapabilityManager", () => {
  it("builds inventories for all agents", () => {
    const deps = createDeps();
    const cm = new CapabilityManager(deps.registry);
    const inventories = cm.buildAll();
    assert.equal(inventories.length, 18);
    assert.ok(inventories[0].capabilities.length > 0);
  });

  it("finds agents with specific capability", () => {
    const deps = createDeps();
    const cm = new CapabilityManager(deps.registry);
    cm.buildAll();
    const agents = cm.findAgentsWithCapability("org.strategy");
    assert.ok(agents.length >= 1);
  });
});

describe("COS — SkillEvolutionEngine", () => {
  it("records skill versions", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const se = new SkillEvolutionEngine(gm, oi);
    se.recordVersion("code-review", "1.0.0", 0.85, 0.9, ["Initial release"]);
    se.recordVersion("code-review", "1.1.0", 0.88, 0.92, ["Improved accuracy"]);
    assert.equal(se.getVersions("code-review").length, 2);
    assert.equal(se.getLatestVersion("code-review")!.version, "1.1.0");
  });

  it("manages improvement proposals", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const se = new SkillEvolutionEngine(gm, oi);
    const p = se.proposeImprovement({
      title: "Optimize CI pipeline",
      description: "Reduce build time with caching",
      category: "performance",
      currentState: "Build takes 10 min",
      proposedState: "Build takes 3 min",
      expectedBenefit: "Faster feedback loop",
    });
    assert.equal(p.status, "draft");
    se.approveProposal(p.id);
    assert.equal(se.getProposal(p.id)!.status, "approved");
    se.implementProposal(p.id);
    assert.equal(se.getProposal(p.id)!.status, "implemented");
  });

  it("generates self evaluation report", () => {
    const deps = createDeps();
    const gm = new GoalManager();
    const oi = new OrganizationalIntelligence(deps.registry, deps.orgMemory, gm, deps.lifecycleManager);
    const se = new SkillEvolutionEngine(gm, oi);
    const report = se.generateSelfEvaluation();
    assert.ok(report.id);
    assert.ok(typeof report.score === "number");
    assert.ok(Array.isArray(report.dimensions));
    assert.equal(report.dimensions.length, 3);
  });
});

describe("COS — createCos factory", () => {
  it("creates all subsystems", () => {
    const deps = createDeps();
    const cos = createCos(deps);
    assert.ok(cos.goalManager);
    assert.ok(cos.timeManager);
    assert.ok(cos.resourceManager);
    assert.ok(cos.priorityManager);
    assert.ok(cos.decisionEngine);
    assert.ok(cos.councilEngine);
    assert.ok(cos.missionManager);
    assert.ok(cos.strategyEngine);
    assert.ok(cos.experienceEngine);
    assert.ok(cos.learningEngine);
    assert.ok(cos.governanceEngine);
    assert.ok(cos.organizationalIntelligence);
    assert.ok(cos.metricsEngine);
    assert.ok(cos.progressTracker);
    assert.ok(cos.contextManager);
    assert.ok(cos.capabilityManager);
    assert.ok(cos.skillEvolutionEngine);
  });

  it("goal-real-world workflow: create goal → strategy → decision → execute → track", () => {
    const deps = createDeps();
    const cos = createCos(deps);

    // 1. Create and activate goal
    const g = cos.goalManager.create({ mission: "Migrate to TypeScript", objectives: ["Set up tsconfig", "Convert files", "Fix type errors"], priority: "high" });
    cos.goalManager.activate(g.id);
    cos.goalManager.addMilestone(g.id, "tsconfig complete");

    // 2. Generate strategy
    const s = cos.strategyEngine.generateForGoal(g);

    // 3. Make decision
    const d = cos.decisionEngine.create({ problem: "Migration approach", alternatives: [{ name: "Incremental", description: "File by file", pros: ["Low risk"], cons: ["Slow"] }], madeBy: "architect-1" });
    cos.decisionEngine.make(d.id, "Incremental", "Safer", "Low risk migration", "Incremental (2/3)");

    // 4. Assign via lifecycle
    deps.lifecycleManager.assignTask("Convert src/ to TS", "software-engineer", "high");

    // 5. Track progress
    const progress = cos.progressTracker.getGoalProgress(g.id);
    assert.equal(progress.milestonesTotal, 1);
    assert.equal(progress.milestonesCompleted, 0);

    // 6. Record experience
    cos.experienceEngine.save({ title: "TS migration pattern", category: "refactoring", description: "Incremental approach with strict mode", context: ["TypeScript", "migration"], steps: ["Enable strict", "Fix errors"], createdBy: "architect-1" });

    // 7. Record learning
    cos.learningEngine.recordFromSuccess("TS migration", "Start with strict mode enabled", ["migration-log"]);

    // 8. Take snapshot
    const snapshot = cos.organizationalIntelligence.snapshot();
    assert.equal(snapshot.goalCount, 1);

    // Complete
    cos.goalManager.completeMilestone(g.id, g.milestones[0].id);
    assert.equal(cos.goalManager.get(g.id)!.progress, 100);
  });
});

describe("COS — DesktopServer integration (via constructor)", () => {
  it("creates COS with organization dependencies attached", () => {
    const deps = createDeps();
    const cos = createCos(deps);
    assert.equal(deps.registry.getAll().length, 18);
    assert.ok(cos.councilEngine);
    assert.ok(cos.organizationalIntelligence);
  });
});
