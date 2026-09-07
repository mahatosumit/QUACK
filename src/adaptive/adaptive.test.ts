import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { now } from "../core/types.js";
import { createAdaptiveLayer } from "./adaptive-layer.js";
import { createExperimentManager } from "./experiment-manager.js";
import { createPromptRegistry } from "./prompt-registry.js";
import { createSkillEvolutionEngine } from "./skill-evolution.js";
import { createWorkflowEvolutionEngine } from "./workflow-evolution.js";
import { createDebateEngine } from "./debate-engine.js";
import { createScientificWorkflowEngine } from "./scientific-workflow.js";
import { createFailureAnalysisEngine } from "./failure-analysis.js";
import { createContinuousLearning } from "./continuous-learning.js";
import { createAutonomousImprovementScheduler } from "./improvement-scheduler.js";
import { createQualityPredictionEngine } from "./quality-prediction.js";
import { createKnowledgeDistillationEngine } from "./knowledge-distillation.js";
import { createDecisionReplayEngine } from "./decision-replay.js";
import { createExperienceMiningEngine } from "./experience-miner.js";
import { createReasoningArchive } from "./reasoning-archive.js";
import { createModelEvaluationFramework } from "./evaluation-framework.js";

describe("Phase 12: Adaptive Intelligence Layer", () => {
  describe("ExperimentManager", () => {
    it("creates and retrieves experiments", () => {
      const em = createExperimentManager();
      const exp = em.createExperiment({
        type: "ab-test",
        name: "test-ab",
        description: "A/B test",
        variants: [{ id: "a", label: "A", config: {}, weight: 0.5 }, { id: "b", label: "B", config: {}, weight: 0.5 }],
        metrics: ["accuracy", "latency"],
        iterations: 10,
        confidenceThreshold: 0.95,
      });
      assert.ok(exp.id.startsWith("exp_"));
      assert.equal(exp.status, "draft");
      assert.equal(em.getExperiment(exp.id)?.id, exp.id);
    });

    it("rejects unsupported execution without inventing results or a winner", async () => {
      const em = createExperimentManager();
      const exp = em.createExperiment({
        type: "ab-test",
        name: "run-test",
        description: "test",
        variants: [{ id: "v1", label: "V1", config: {}, weight: 0.5 }, { id: "v2", label: "V2", config: {}, weight: 0.5 }],
        metrics: ["score"],
        iterations: 5,
        confidenceThreshold: 0.9,
      });
      await assert.rejects(em.runExperiment(exp.id), /unsupported/);
      assert.equal(exp.status, "draft");
      assert.equal(exp.winner, null);
      assert.equal(exp.completedAt, null);
      assert.deepEqual(exp.results, []);
    });

    it("lists and filters experiments", () => {
      const em = createExperimentManager();
      em.createExperiment({ type: "ab-test", name: "e1", description: "", variants: [], metrics: ["m"], iterations: 1, confidenceThreshold: 0.9 });
      em.createExperiment({ type: "multi-model", name: "e2", description: "", variants: [], metrics: ["m"], iterations: 1, confidenceThreshold: 0.9 });
      assert.equal(em.listExperiments().length, 2);
      assert.equal(em.listExperiments("ab-test").length, 1);
    });

    it("compares variants", () => {
      const em = createExperimentManager();
      const exp = em.createExperiment({ type: "ab-test", name: "cmp", description: "", variants: [{ id: "x", label: "X", config: {}, weight: 0.5 }, { id: "y", label: "Y", config: {}, weight: 0.5 }], metrics: ["m"], iterations: 3, confidenceThreshold: 0.9 });
      const result = em.compareVariants("nonexistent");
      assert.deepEqual(result, {});
    });

    it("deletes experiments", () => {
      const em = createExperimentManager();
      const exp = em.createExperiment({ type: "ab-test", name: "del", description: "", variants: [], metrics: ["m"], iterations: 1, confidenceThreshold: 0.9 });
      assert.ok(em.deleteExperiment(exp.id));
      assert.ok(!em.deleteExperiment("nonexistent"));
    });
  });

  describe("PromptRegistry", () => {
    it("creates and retrieves prompts", () => {
      const pr = createPromptRegistry();
      const prompt = pr.createPrompt("test-helper", "You are a helpful assistant", "system");
      assert.ok(prompt.id.startsWith("prompt_"));
      assert.equal(prompt.activeVersion, 1);
      assert.equal(pr.getPrompt(prompt.id)?.name, "test-helper");
    });

    it("adds and manages versions", () => {
      const pr = createPromptRegistry();
      const prompt = pr.createPrompt("qa", "initial", "user");
      const v2 = pr.addVersion(prompt.id, "improved");
      assert.equal(v2.version, 2);
      assert.equal(v2.parentId, prompt.versions[0].id);
    });

    it("rolls back to previous version", () => {
      const pr = createPromptRegistry();
      const prompt = pr.createPrompt("rb", "v1", "system");
      pr.addVersion(prompt.id, "v2");
      const rolled = pr.rollback(prompt.id, 1);
      assert.equal(rolled.version, 1);
      assert.equal(pr.getActiveVersion(prompt.id)?.version, 1);
    });

    it("scores versions", () => {
      const pr = createPromptRegistry();
      const prompt = pr.createPrompt("scored", "v1", "system");
      const v1 = prompt.versions[0];
      pr.scoreVersion(prompt.id, v1.id, { benchmarkId: "b1", score: 95, latencyMs: 100, cost: 0.01, sampleSize: 10, timestamp: "2026-01-01T00:00:00.000Z" });
      assert.equal(pr.getPrompt(prompt.id)?.versions[0].scores.length, 1);
    });

    it("lists all prompts", () => {
      const pr = createPromptRegistry();
      pr.createPrompt("p1", "c1", "system");
      pr.createPrompt("p2", "c2", "user");
      assert.equal(pr.listPrompts().length, 2);
    });
  });

  describe("SkillEvolutionEngine", () => {
    it("records benchmarks and compares versions", () => {
      const se = createSkillEvolutionEngine();
      se.recordBenchmark("skill-1", { suite: "basic", passRate: 1, avgLatencyMs: 100, sampleSize: 10, timestamp: "2026-01-01T00:00:00.000Z" });
      const versions = se.getSkillVersions("skill-1");
      assert.equal(versions.length, 1);
      assert.equal(versions[0].benchmarks.length, 1);
    });

    it("recommends upgrade only when multiple versions exist", () => {
      const se = createSkillEvolutionEngine();
      se.recordBenchmark("skill-2", { suite: "s1", passRate: 0.7, avgLatencyMs: 100, sampleSize: 10, timestamp: now() });
      const rec = se.recommendUpgrade("skill-2");
      assert.equal(rec, null);
    });

    it("deprecates versions", () => {
      const se = createSkillEvolutionEngine();
      se.recordBenchmark("skill-3", { suite: "s1", passRate: 1, avgLatencyMs: 50, sampleSize: 10, timestamp: "2026-01-01T00:00:00.000Z" });
      se.deprecateVersion("skill-3", 1);
      const versions = se.getSkillVersions("skill-3");
      assert.ok(versions[0].deprecated);
    });
  });

  describe("WorkflowEvolutionEngine", () => {
    it("observes executions and generates recommendations", () => {
      const we = createWorkflowEvolutionEngine();
      we.observeExecution("wf-1", { stepId: "step1", latencyMs: 6000, failures: 2, retries: 1, toolCalls: 8, routingDecisions: 4 });
      const opts = we.getOptimizations("wf-1");
      assert.equal(opts.length, 1);
      assert.ok(opts[0].recommendations.length > 0);
    });

    it("applies optimizations", () => {
      const we = createWorkflowEvolutionEngine();
      we.observeExecution("wf-2", { stepId: "s1", latencyMs: 100, failures: 0, retries: 0, toolCalls: 1, routingDecisions: 0 });
      const opt = we.getOptimizations("wf-2")[0];
      we.applyOptimization("wf-2", opt.id);
      assert.ok(we.getOptimizations("wf-2")[0].applied);
    });

    it("returns deduplicated recommendations", () => {
      const we = createWorkflowEvolutionEngine();
      we.observeExecution("wf-3", { stepId: "s1", latencyMs: 10000, failures: 3, retries: 2, toolCalls: 1, routingDecisions: 0 });
      we.observeExecution("wf-3", { stepId: "s2", latencyMs: 6000, failures: 0, retries: 0, toolCalls: 1, routingDecisions: 0 });
      const recs = we.getRecommendations("wf-3");
      assert.ok(recs.length > 0);
    });
  });

  describe("DebateEngine", () => {
    it("creates and resolves debate sessions", () => {
      const de = createDebateEngine();
      const session = de.createSession("Should we use model A or model B?");
      assert.ok(session.id.startsWith("deb_"));
      assert.equal(de.listSessions().length, 1);
    });

    it("handles arguments and voting", () => {
      const de = createDebateEngine();
      const s = de.createSession("Test debate");
      de.addArgument(s.id, { agentId: "agent-1", role: "researcher", position: "for", claim: "Model A is faster", evidence: ["bench-1"], confidence: 0.8 });
      de.addArgument(s.id, { agentId: "agent-2", role: "reviewer", position: "against", claim: "Model A is less accurate", evidence: ["bench-2"], confidence: 0.7 });
      de.castVote(s.id, "agent-1", "for");
      de.castVote(s.id, "agent-2", "against");
      de.castVote(s.id, "agent-3", "for");
      const resolved = de.resolve(s.id);
      assert.ok(resolved.consensus !== null);
      assert.ok(resolved.resolvedAt !== null);
      assert.ok(resolved.minorityReport !== null);
    });

    it("handles empty sessions", () => {
      const de = createDebateEngine();
      const s = de.createSession("Empty");
      const resolved = de.resolve(s.id);
      assert.equal(resolved.consensus, "No arguments presented");
    });
  });

  describe("ScientificWorkflowEngine", () => {
    it("creates workflows with default phases", () => {
      const sw = createScientificWorkflowEngine();
      const wf = sw.createWorkflow("What causes quantum decoherence?");
      assert.ok(wf.id.startsWith("sci_"));
      assert.equal(Object.keys(wf.steps).length, 10);
      assert.equal(wf.steps["question-formulation"].status, "completed");
    });

    it("sets hypothesis and report", () => {
      const sw = createScientificWorkflowEngine();
      const wf = sw.createWorkflow("test question");
      sw.setHypothesis(wf.id, "Hypothesis X");
      sw.setReport(wf.id, "Report content");
      assert.equal(sw.getWorkflow(wf.id)?.hypothesis, "Hypothesis X");
      assert.equal(sw.getWorkflow(wf.id)?.report, "Report content");
    });

    it("retrieves provenance", () => {
      const sw = createScientificWorkflowEngine();
      const wf = sw.createWorkflow("provenance test");
      const prov = sw.getProvenance(wf.id);
      assert.ok(Object.keys(prov).length > 0);
    });
  });

  describe("FailureAnalysisEngine", () => {
    it("records and categorizes failures", () => {
      const fa = createFailureAnalysisEngine();
      const failure = fa.createFailureRecord("task-1", "model", "Model timeout", { model: "gpt-4" });
      fa.recordFailure(failure);
      assert.equal(fa.getStats().total, 1);
      assert.equal(fa.getStats().model, 1);
    });

    it("provides recommendations", () => {
      const fa = createFailureAnalysisEngine();
      fa.recordFailure(fa.createFailureRecord("task-2", "network", "Connection lost", {}));
      fa.recordFailure(fa.createFailureRecord("task-2", "network", "DNS failure", {}));
      const recs = fa.getRecommendations("task-2");
      assert.ok(recs.length > 0);
      assert.ok(recs[0].includes("backoff"));
    });

    it("returns failure rate", () => {
      const fa = createFailureAnalysisEngine();
      fa.recordFailure(fa.createFailureRecord("t1", "tool", "error", {}));
      const rate = fa.getFailureRate(60000);
      assert.ok(typeof rate === "number");
    });
  });

  describe("ContinuousLearning", () => {
    it("stores and searches knowledge entries", () => {
      const cl = createContinuousLearning();
      const entry = cl.createKnowledgeEntry("pattern", "Always validate input", "experience", ["validation", "security"]);
      cl.addEntry(entry);
      assert.equal(cl.search("validate").length, 1);
    });

    it("tracks usage and scores", () => {
      const cl = createContinuousLearning();
      cl.addEntry(cl.createKnowledgeEntry("lesson", "Lesson A", "source1", ["tag1"]));
      const entries = cl.getTopEntries(10);
      assert.equal(entries.length, 1);
      cl.recordUsage(entries[0].id);
      assert.equal(cl.getTopEntries(10)[0].usageCount, 1);
    });

    it("filters by tags", () => {
      const cl = createContinuousLearning();
      cl.addEntry(cl.createKnowledgeEntry("lesson", "L1", "s", ["a", "b"]));
      cl.addEntry(cl.createKnowledgeEntry("lesson", "L2", "s", ["c"]));
      assert.equal(cl.search("L", ["a"]).length, 1);
    });
  });

  describe("AutonomousImprovementScheduler", () => {
    it("manages proposal lifecycle", () => {
      const is = createAutonomousImprovementScheduler();
      is.proposeImprovement({ id: "ip-1", type: "prompt", target: "sys-prompt", description: "Optimize", expectedImprovement: "+10%", evidence: ["obs"], status: "draft", score: 85, createdAt: "2026-01-01T00:00:00.000Z", appliedAt: null });
      assert.equal(is.getProposals().length, 1);
      is.approveProposal("ip-1");
      assert.equal(is.getProposals("approved").length, 1);
    });

    it("does not invent automated improvement evidence", async () => {
      const is = createAutonomousImprovementScheduler();
      await assert.rejects(is.runCycle(), /unsupported/);
      assert.deepEqual(is.getProposals(), []);
    });

    it("rejects and applies proposals", async () => {
      const is = createAutonomousImprovementScheduler();
      is.proposeImprovement({ id: "ip-2", type: "workflow", target: "wf", description: "fix", expectedImprovement: "~15%", evidence: [], status: "draft", score: 50, createdAt: "2026-01-01T00:00:00.000Z", appliedAt: null });
      is.rejectProposal("ip-2", "Not needed");
      assert.equal(is.getProposals("rejected").length, 1);
      is.proposeImprovement({ id: "ip-3", type: "skill", target: "sk", description: "upgrade", expectedImprovement: "~20%", evidence: [], status: "approved", score: 90, createdAt: "2026-01-01T00:00:00.000Z", appliedAt: null });
      await assert.rejects(is.applyProposal("ip-3"), /unsupported/);
      assert.equal(is.getProposals("applied").length, 0);
      assert.equal(is.getProposals("approved")[0].appliedAt, null);
    });
  });

  describe("QualityPredictionEngine", () => {
    it("predicts success probability", () => {
      const qp = createQualityPredictionEngine();
      const pred = qp.predict({ complexity: 0.3, modelCapability: 0.9, historySuccessRate: 0.85 });
      assert.ok(pred.successProbability > 0.5);
      assert.ok(pred.expectedLatencyMs > 0);
      assert.equal(pred.risk, "low");
    });

    it("tracks accuracy", () => {
      const qp = createQualityPredictionEngine();
      qp.updateModel(true, { successProbability: 0.9, expectedCost: 0.01, expectedLatencyMs: 100, risk: "low", confidence: 0.9 });
      qp.updateModel(false, { successProbability: 0.2, expectedCost: 0.01, expectedLatencyMs: 100, risk: "high", confidence: 0.5 });
      assert.ok(qp.getAccuracy() > 0);
    });
  });

  describe("KnowledgeDistillationEngine", () => {
    it("rejects unsupported distillation without invented artifacts", () => {
      const kd = createKnowledgeDistillationEngine();
      assert.throws(() => kd.distill("model", "test-model", "agent", "response-cache"), /unsupported/);
      assert.deepEqual(kd.getDistillations("test-model"), []);
    });

    it("tracks provenance", () => {
      const kd = createKnowledgeDistillationEngine();
      assert.throws(() => kd.distill("model", "test-model", "skill"), /unsupported/);
      assert.deepEqual(kd.getProvenance("missing"), []);
    });
  });

  describe("DecisionReplayEngine", () => {
    it("records and replays decisions", () => {
      const dr = createDecisionReplayEngine();
      dr.recordDecision({ id: "dr-1", sessionId: "sess-1", decision: "Use model A", alternatives: ["B", "C"], rationale: "Faster", evidence: ["bench"], confidence: 0.9, createdAt: "2026-01-01T00:00:00.000Z" });
      dr.recordDecision({ id: "dr-2", sessionId: "sess-1", decision: "Defer", alternatives: [], rationale: "More data needed", evidence: [], confidence: 0.6, createdAt: "2026-01-02T00:00:00.000Z" });
      assert.equal(dr.getDecision("dr-1")?.decision, "Use model A");
      const replay = dr.replaySession("sess-1");
      assert.equal(replay.length, 2);
    });
  });

  describe("ExperienceMiningEngine", () => {
    it("records and finds patterns", () => {
      const em = createExperienceMiningEngine();
      em.recordPattern({ id: "ep-1", pattern: "retry-on-timeout", frequency: 10, successRate: 0.9, context: ["network", "api"], tags: ["retry", "resilience"], lastObserved: "2026-01-01T00:00:00.000Z" });
      em.recordPattern({ id: "ep-2", pattern: "cache-results", frequency: 20, successRate: 0.95, context: ["performance"], tags: ["cache"], lastObserved: "2026-01-01T00:00:00.000Z" });
      const found = em.findPatterns(["network"]);
      assert.equal(found.length, 1);
      assert.equal(found[0].pattern, "retry-on-timeout");
    });

    it("merges duplicate patterns", () => {
      const em = createExperienceMiningEngine();
      em.recordPattern({ id: "ep-3", pattern: "validate-input", frequency: 5, successRate: 0.8, context: ["security"], tags: ["input"], lastObserved: "2026-01-01T00:00:00.000Z" });
      em.recordPattern({ id: "ep-4", pattern: "validate-input", frequency: 3, successRate: 0.9, context: ["security"], tags: ["input", "safety"], lastObserved: "2026-01-01T00:00:00.000Z" });
      assert.equal(em.getFrequentPatterns(10).length, 1);
      assert.equal(em.getFrequentPatterns(10)[0].frequency, 6);
    });
  });

  describe("ReasoningArchive", () => {
    it("stores and searches reasoning traces", () => {
      const ra = createReasoningArchive();
      const step = ra.createReasoningStep("observation", "The model response is slow", ["latency: 5s"], 0.9);
      ra.storeTrace({ id: "rt-1", sessionId: "s1", goal: "Optimize model latency", steps: [step], conclusion: "Need caching", confidence: 0.85, createdAt: "2026-01-01T00:00:00.000Z" });
      const found = ra.searchTraces("latency");
      assert.equal(found.length, 1);
      assert.equal(ra.getTrace("rt-1")?.goal, "Optimize model latency");
    });
  });

  describe("ModelEvaluationFramework", () => {
    it("evaluates models", async () => {
      const mf = createModelEvaluationFramework();
      await assert.rejects(mf.evaluateModel("gpt-4", "coding"), /unsupported/);
      assert.deepEqual(mf.getHistory("gpt-4"), []);
    });

    it("compares models", async () => {
      const mf = createModelEvaluationFramework();
      await assert.rejects(mf.compareModels(["gpt-4", "claude-3"], "reasoning"), /unsupported/);
    });

    it("maintains leaderboard", async () => {
      const mf = createModelEvaluationFramework();
      await assert.rejects(mf.evaluateModel("model-a", "general"), /unsupported/);
      await assert.rejects(mf.evaluateModel("model-b", "general"), /unsupported/);
      const board = mf.getLeaderboard("general");
      assert.equal(board.length, 0);
    });
  });

  describe("AdaptiveLayer (integration)", () => {
    it("creates all 15 subsystems", () => {
      const layer = createAdaptiveLayer();
      assert.ok(typeof layer.experimentManager.createExperiment === "function");
      assert.ok(typeof layer.promptRegistry.createPrompt === "function");
      assert.ok(typeof layer.skillEvolution.recordBenchmark === "function");
      assert.ok(typeof layer.workflowEvolution.observeExecution === "function");
      assert.ok(typeof layer.debateEngine.createSession === "function");
      assert.ok(typeof layer.scientificWorkflow.createWorkflow === "function");
      assert.ok(typeof layer.failureAnalysis.recordFailure === "function");
      assert.ok(typeof layer.continuousLearning.addEntry === "function");
      assert.ok(typeof layer.improvementScheduler.proposeImprovement === "function");
      assert.ok(typeof layer.qualityPrediction.predict === "function");
      assert.ok(typeof layer.knowledgeDistillation.distill === "function");
      assert.ok(typeof layer.decisionReplay.recordDecision === "function");
      assert.ok(typeof layer.experienceMiner.recordPattern === "function");
      assert.ok(typeof layer.reasoningArchive.storeTrace === "function");
      assert.ok(typeof layer.evaluationFramework.evaluateModel === "function");
    });

    it("fails closed for the unsupported experiment and improvement workflow", async () => {
      const layer = createAdaptiveLayer();

      const exp = layer.experimentManager.createExperiment({
        type: "multi-model",
        name: "model-comparison",
        description: "Compare AI models",
        variants: [
          { id: "gpt4", label: "GPT-4", config: {}, weight: 0.5 },
          { id: "claude", label: "Claude 3", config: {}, weight: 0.5 },
        ],
        metrics: ["accuracy", "speed"],
        iterations: 5,
        confidenceThreshold: 0.9,
      });

      await assert.rejects(layer.experimentManager.runExperiment(exp.id), /unsupported/);
      assert.equal(exp.winner, null);

      const pred = layer.qualityPrediction.predict({ complexity: 0.5, modelCapability: 0.8, historySuccessRate: 0.7 });
      assert.ok(pred.successProbability > 0);

      await assert.rejects(layer.improvementScheduler.runCycle(), /unsupported/);
      assert.deepEqual(layer.improvementScheduler.getProposals(), []);

      const step = layer.reasoningArchive.createReasoningStep("conclusion", "Model comparison complete — GPT-4 wins", ["accuracy: 92%"], 0.9);
      layer.reasoningArchive.storeTrace({
        id: "rt-final",
        sessionId: "s-final",
        goal: "improvement cycle completed",
        steps: [step],
        conclusion: "GPT-4 selected as primary model",
        confidence: 0.85,
        createdAt: now(),
      });

      const traces = layer.reasoningArchive.searchTraces("improvement");
      assert.equal(traces.length, 1);
    });
  });
});
