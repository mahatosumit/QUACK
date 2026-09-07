import type { AdaptiveLayer } from "./types.js";
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

export function createAdaptiveLayer(): AdaptiveLayer {
  return {
    experimentManager: createExperimentManager(),
    promptRegistry: createPromptRegistry(),
    skillEvolution: createSkillEvolutionEngine(),
    workflowEvolution: createWorkflowEvolutionEngine(),
    debateEngine: createDebateEngine(),
    scientificWorkflow: createScientificWorkflowEngine(),
    failureAnalysis: createFailureAnalysisEngine(),
    continuousLearning: createContinuousLearning(),
    improvementScheduler: createAutonomousImprovementScheduler(),
    qualityPrediction: createQualityPredictionEngine(),
    knowledgeDistillation: createKnowledgeDistillationEngine(),
    decisionReplay: createDecisionReplayEngine(),
    experienceMiner: createExperienceMiningEngine(),
    reasoningArchive: createReasoningArchive(),
    evaluationFramework: createModelEvaluationFramework(),
  };
}
