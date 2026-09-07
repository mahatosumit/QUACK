/**
 * Learning Module - Main Export
 *
 * Continuous learning system for QUACK:
 * - Experience Store (Episodic, Semantic, Procedural, Performance, Failure Patterns)
 * - Experience Broker (Query interface)
 * - Daily Learning Routine (COLLECT → FILTER → RETRIEVE → GROUP → COMPARE → JUDGE → DISTILL → CONTRADICTION → VERIFY → CONSOLIDATE → REPORT → CHECKPOINT)
 * - Skill Effectiveness Evaluation & Evolution
 */

export * from "./types.js";
export * from "./experience-store.js";
export * from "./experience-broker.js";
export * from "./daily-learning.js";
export * from "./skill-evaluation.js";

export {
  createExperienceStore,
  ExperienceStore,
} from "./experience-store.js";

export {
  createExperienceBroker,
  type ExperienceBroker,
} from "./experience-broker.js";

export {
  createDailyLearningRoutine,
  type DailyLearningRoutine,
  type DailyLearningConfig,
} from "./daily-learning.js";

export {
  createSkillEffectivenessEvaluator,
  createSkillEvolutionManager,
  type SkillEffectivenessEvaluator,
  type SkillEvolutionManager,
  type SkillEffectivenessConfig,
} from "./skill-evaluation.js";