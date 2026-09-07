import test from "node:test";
import assert from "node:assert/strict";
import { ObjectiveTree, type ObjectiveNode } from "./objective-tree.js";
import { GoalsProgressTracker } from "./progress-tracker.js";
import { GoalManager } from "../../cos/goal-manager.js";

function must<T>(v: T | undefined): T { if (v === undefined) throw new Error("must: undefined"); return v; }

test("ObjectiveTree builds vision -> goal -> project -> task hierarchy", () => {
  const tree = new ObjectiveTree();
  const vision = must(tree.setVision("Autonomous AI startup"));
  const goalNode = must(tree.addChild(vision.id, "goal", "Crop Detection System"));
  const project = must(tree.addChild(goalNode.id, "project", "Dataset Collection"));
  const task = must(tree.addChild(project.id, "task", "Scrape images"));
  assert.equal(tree.getChildren(vision.id).length, 1);
  assert.equal(tree.getChildren(goalNode.id)[0].id, project.id);
  assert.equal(tree.getChildren(project.id)[0].id, task.id);
  const path = tree.getPath(task.id);
  assert.equal(path.length, 4);
  assert.equal(path[0].level, "vision");
  assert.equal(path[3].level, "task");
});

test("ObjectiveTree setStatus recalculates parent progress", () => {
  const tree = new ObjectiveTree();
  const vision = must(tree.setVision("Robotics"));
  const g = must(tree.addChild(vision.id, "goal", "Goal A"));
  const t1 = must(tree.addChild(g.id, "project", "P1"));
  const t2 = must(tree.addChild(g.id, "project", "P2"));
  tree.setStatus(t1.id, "completed");
  assert.equal(tree.get(g.id)!.progress, 50);
  tree.setStatus(t2.id, "completed");
  assert.equal(tree.get(g.id)!.progress, 100);
  assert.equal(tree.get(g.id)!.status, "completed");
});

test("ObjectiveTree.decomposeGoal links goals and milestones", () => {
  const tree = new ObjectiveTree();
  const vision = must(tree.setVision("Agri startup"));
  const gm = new GoalManager();
  const goal = gm.create({ mission: "Agriculture Automation", objectives: ["Detect crops", "Monitor farm"] });
  gm.addMilestone(goal.id, "Collect dataset");
  const goalNode = tree.decomposeGoal(goal, vision.id);
  assert.ok(goalNode.goalId === goal.id);
  assert.ok(tree.getChildren(goalNode.id).length >= 2);
});

test("GoalsProgressTracker tracks a single goal", () => {
  const tracker = new GoalsProgressTracker();
  const gm = new GoalManager();
  const goal = gm.create({ mission: "X", objectives: [], estimatedEffortHours: 10 });
  gm.addMilestone(goal.id, "Milestone 1");
  gm.completeMilestone(goal.id, goal.milestones[0].id);
  const snap = tracker.track(goal);
  assert.equal(snap.milestonesCompleted, 1);
  assert.equal(snap.milestonesTotal, 1);
});

test("GoalsProgressTracker summarize aggregates many goals", () => {
  const tracker = new GoalsProgressTracker();
  const gm = new GoalManager();
  const g1 = gm.create({ mission: "A", objectives: [] });
  const g2 = gm.create({ mission: "B", objectives: [] });
  gm.activate(g1.id);
  gm.activate(g2.id);
  gm.complete(g2.id);
  const overall = tracker.trackMany(gm.getAll());
  assert.equal(overall.totalGoals, 2);
  assert.equal(overall.completedGoals, 1);
  assert.equal(overall.activeGoals, 1);
  assert.ok(overall.byStatus["active"] >= 1);
});
