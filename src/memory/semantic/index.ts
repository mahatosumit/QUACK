/**
 * P9 Semantic Memory / Knowledge (ADR 0043) — public surface.
 *
 * MEMORY IS DATA, NOT AUTHORITY. Semantic memory supplies governed context
 * to QUACK through the existing QIE pipeline (P8.3 firewall → P8.2 selector
 * → P8.1 composer → P8.5 defense → P8.4 adapter → GovernedModelRuntime);
 * embeddings dispatch exclusively through the governed model path. No
 * second memory authority, policy engine, compaction engine, event system,
 * or budget authority exists here.
 */
export {
  SEMANTIC_MEMORY_SCOPES,
  SEMANTIC_MEMORY_BOUNDS,
  semanticContentHash,
  chunkSemanticMemory,
  parseSemanticMemoryRecord,
  type SemanticMemoryScope,
  type SemanticMemorySourceKind,
  type SemanticMemoryLifecycle,
  type SemanticMemoryIdentity,
  type SemanticMemoryProvenance,
  type SemanticEmbeddingMetadata,
  type SemanticMemoryRecord,
  type SemanticMemoryChunk,
  type SemanticMemoryRecordErrorCode,
} from "./records.js";
export {
  admitSemanticMemory,
  type SemanticMemoryAdmissionRequest,
  type AdmissionRejectionCode,
  type SemanticAdmissionRejection,
  type SemanticAdmissionResult,
} from "./admission.js";
export {
  embedSemanticContent,
  type EmbedGatewayOptions,
  type EmbeddingRuntimeSurface,
  type GovernedEmbedResult,
} from "./embedding.js";
export {
  SemanticMemoryIndex,
  cosineSimilarity,
  indexEntryHash,
  type IndexedChunk,
  type IndexMatch,
} from "./vector-index.js";
export { SemanticMemoryStore, MemoryStoreError, nextSemanticMemoryId } from "./store.js";
export {
  retrieveSemanticMemory,
  type SemanticRetrievalQuery,
  type SemanticRetrievalHit,
  type SemanticRetrievalResult,
} from "./retrieval.js";
export {
  resolveKnowledgeSource,
  KNOWLEDGE_SOURCE_BOUNDS,
  type KnowledgeSourceRequest,
  type KnowledgeSourceResult,
} from "./knowledge.js";
export {
  memoryCandidatesFromRetrieval,
  memoryCandidate,
  semanticMemoryAuthorities,
  pipelineMemoryToQie,
  memoryLayerName,
  memoryLanePreserved,
  type MemoryQiePipelineInput,
  type MemoryQiePipelineResult,
  type AuthorityExtras,
} from "./qie.js";
export {
  scoreMemoryQuality,
  retrievalToEvidence,
  type MemoryQualityDimensions,
  type MemoryQualityResult,
  type MemoryEvaluationEvidence,
} from "./evaluation.js";
export {
  SemanticMemoryService,
  type SemanticMemoryServiceOptions,
  type RememberRequest,
  type RememberResult,
  type RecallRequest,
} from "./service.js";
