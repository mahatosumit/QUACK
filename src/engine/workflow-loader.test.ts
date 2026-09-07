import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkflowYaml, WorkflowLoader } from "./workflow-loader.js";

const SD = `name: software-development
description: Autonomous software dev.
stages:
  - id: plan
    agent: planner
    description: "Plan the work"
    depends_on: []
  - id: code
    agent: software-engineer
    description: "Write code"
    depends_on: [plan]
outputs:
  - plan.md
  - src
risk_policy: medium
`;

test("parseWorkflowYaml parses name, description, risk policy", () => {
  const wfd = parseWorkflowYaml(SD);
  assert.equal(wfd.name, "software-development");
  assert.equal(wfd.description, "Autonomous software dev.");
  assert.equal(wfd.risk_policy, "medium");
});

test("parseWorkflowYaml parses outputs list", () => {
  const wfd = parseWorkflowYaml(SD);
  assert.deepEqual(wfd.outputs, ["plan.md", "src"]);
});

test("parseWorkflowYaml parses stages with dependencies", () => {
  const wfd = parseWorkflowYaml(SD);
  assert.equal(wfd.stages.length, 2);
  assert.equal(wfd.stages[0].id, "plan");
  assert.equal(wfd.stages[0].agent, "planner");
  assert.deepEqual(wfd.stages[0].depends_on, []);
  assert.equal(wfd.stages[1].agent, "software-engineer");
  assert.deepEqual(wfd.stages[1].depends_on, ["plan"]);
});

test("WorkflowLoader loads yaml from workflows dir", async () => {
  const loader = new WorkflowLoader("workflows");
  const sd = await loader.load("software-development");
  assert.ok(sd, "should load software-development.yaml");
  assert.equal(sd!.name, "software-development");

  const research = await loader.load("research");
  assert.ok(research);
  assert.equal(research!.name, "research");

  const robotics = await loader.load("robotics");
  assert.ok(robotics);
  assert.equal(robotics!.name, "robotics");
});

test("WorkflowLoader loadAll returns all three workflows", async () => {
  const loader = new WorkflowLoader("workflows");
  const all = await loader.loadAll();
  assert.equal(all.length, 3);
  assert.ok(all.some((w) => w.name === "software-development"));
  assert.ok(all.some((w) => w.name === "research"));
  assert.ok(all.some((w) => w.name === "robotics"));
});

test("WorkflowLoader returns undefined for missing workflow", async () => {
  const loader = new WorkflowLoader("workflows");
  const missing = await loader.load("does-not-exist");
  assert.equal(missing, undefined);
});
