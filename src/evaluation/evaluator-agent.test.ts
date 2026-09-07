import test from "node:test";
import assert from "node:assert/strict";
import { EvaluatorAgent } from "./evaluator-agent.js";

test("EvaluatorAgent issues passing report for clean output", () => {
  const agent = new EvaluatorAgent({ threshold: 0.7 });
  const report = agent.evaluate({
    output: { hello: "world" },
    taskIdAvailable: true,
    cost: 0.01,
    latencyMs: 500,
  });
  assert.ok(report.passed);
  assert.equal(report.dimensions.length, 5);
  assert.ok(report.overallScore >= 0.7);
  assert.equal(report.blockingIssues.length, 0);
});

test("EvaluatorAgent flags secrets in security dimension", () => {
  const agent = new EvaluatorAgent();
  const report = agent.evaluate({
    output: { apiKey: "sk-xxx", containsSecret: true } as never,
    taskIdAvailable: true,
    latencyMs: 100,
    cost: 0,
  });
  const sec = report.dimensions.find((d) => d.dimension === "security");
  assert.equal(sec?.failed, true);
  assert.equal(report.passed, false);
  assert.ok(report.blockingIssues.length > 0);
});

test("EvaluatorAgent penalizes high latency", () => {
  const agent = new EvaluatorAgent();
  const report = agent.evaluate({
    output: { ok: true },
    taskIdAvailable: true,
    latencyMs: 70_000,
    cost: 0,
  });
  const perf = report.dimensions.find((d) => d.dimension === "performance");
  assert.ok((perf?.score ?? 1) < 0.5);
});

test("EvaluatorAgent penalizes high cost", () => {
  const agent = new EvaluatorAgent();
  const report = agent.evaluate({
    output: { ok: true },
    taskIdAvailable: true,
    latencyMs: 10,
    cost: 2.5,
  });
  const cost = report.dimensions.find((d) => d.dimension === "cost");
  assert.ok((cost?.score ?? 1) < 0.5);
});

test("EvaluatorAgent summarize aggregates history", () => {
  const agent = new EvaluatorAgent();
  agent.evaluate({ output: {}, taskIdAvailable: false });
  agent.evaluate({ output: {}, taskIdAvailable: true, latencyMs: 1, cost: 0.01 });
  const s = agent.summarize();
  assert.equal(s.total, 2);
  assert.ok(s.passed >= 1);
});

test("EvaluatorAgent custom scorer overrides a dimension", () => {
  const agent = new EvaluatorAgent();
  agent.registerScorer({
    dimension: "correctness",
    score: () => ({ dimension: "correctness", score: 0.0, failed: true, notes: "always fail" }),
  });
  const report = agent.evaluate({ output: {}, taskIdAvailable: true });
  assert.equal(report.passed, false);
});
