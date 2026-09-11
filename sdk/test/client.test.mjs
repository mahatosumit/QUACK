import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { QuackClient, InMemoryKnowledgeGraph } from '@quack/sdk';
import { QuackClient as SubpathClient } from '@quack/sdk/client';
import {
  materializeTool, GovernedProviderRouter, DelegationRuntime, assertChildReceipt,
  buildCompletionReceipt, assertCompletionReceipt, GovernedHookExecutor,
  InMemoryCapabilityGrantRegistry, ToolRegistry, EchoTool,
} from '@quack/sdk';
import {
  INSTRUCTION_PLAN_VERSION, INSTRUCTION_LAYER_ORDER, TRUST_CLASS_PRECEDENCE,
  CATEGORY_TRUST_PAIRING,
  createInstructionPlan, validateInstructionPlan, collectPlanIssues,
  resolvePrecedence, trustClassRank,
  composeInstructionPlan, renderComposedText, canonicalJson,
  selectContext, admitContext,
  adaptComposedInstruction, invokeGovernedInstruction,
  enforceInstructionDefense, flagsToMetadata, assertDispatchable,
  buildInstructionRecord, parseInstructionRecord, recordToJsonObject,
  distinctTrustClasses, scoreInstructionQuality, dominantTrustLane,
  InstructionObserver,
} from '@quack/sdk';
import {
  SEMANTIC_MEMORY_SCOPES, SEMANTIC_MEMORY_BOUNDS, semanticContentHash,
  chunkSemanticMemory, parseSemanticMemoryRecord, admitSemanticMemory,
  cosineSimilarity, retrieveSemanticMemory, resolveKnowledgeSource,
  memoryCandidate, memoryCandidatesFromRetrieval, semanticMemoryAuthorities,
  pipelineMemoryToQie, scoreMemoryQuality,
  SemanticMemoryService,
} from '@quack/sdk';

test('SDK package exports resolve to the public implementation', () => {
  assert.equal(QuackClient, SubpathClient);
  assert.equal(typeof InMemoryKnowledgeGraph, 'function');
});

test('P8.9 SDK exports the QIE instruction compiler surface', () => {
  // Contract constants and pure functions are reachable through the package.
  assert.equal(INSTRUCTION_PLAN_VERSION, 1);
  assert.equal(INSTRUCTION_LAYER_ORDER.length, 11);
  assert.equal(TRUST_CLASS_PRECEDENCE[0], 'SYSTEM_POLICY');
  assert.equal(CATEGORY_TRUST_PAIRING['tool'][0], 'TOOL_OUTPUT');
  for (const fn of [
    createInstructionPlan, validateInstructionPlan, collectPlanIssues,
    resolvePrecedence, trustClassRank, composeInstructionPlan,
    renderComposedText, canonicalJson, selectContext, admitContext,
    adaptComposedInstruction, invokeGovernedInstruction,
    enforceInstructionDefense, flagsToMetadata, assertDispatchable,
    buildInstructionRecord, parseInstructionRecord, recordToJsonObject,
    distinctTrustClasses, scoreInstructionQuality, dominantTrustLane,
  ]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(typeof InstructionObserver, 'function');
});

test('P8.9 QIE surface behaves deterministically through the SDK', () => {
  // Build a minimal valid plan; compose it twice — identical digests.
  const item = (id, trust) => {
    const category = trust === 'TRUSTED_RUNTIME' ? 'system' : trust === 'USER_INPUT' ? 'user' : 'project';
    return { id, provenance: { source: 'sdk-test', category, trust }, data: { note: 'x' } };
  };
  const planInput = {
    missionId: 'sdk-research-1',
    layers: [
      { name: 'identity', items: [item('id-1', 'TRUSTED_RUNTIME')] },
      { name: 'objective', items: [item('goal-1', 'TRUSTED_RUNTIME')] },
      { name: 'task', items: [item('task-1', 'USER_INPUT')] },
    ],
    budget: { maxInstructionChars: 10_000, reservedOutputChars: 1_000 },
    outputContract: { kind: 'plainResponse' },
    failurePolicy: { allowedModes: ['insufficient_context'], preferAdmission: true },
  };
  const plan = createInstructionPlan(planInput);
  assert.equal(plan.ok, true);
  const first = composeInstructionPlan(plan.data);
  const second = composeInstructionPlan({ ...plan.data, layers: [...plan.data.layers] }); // cloned input, same semantics
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.composed.digest, second.composed.digest, 'digest determinism through the SDK');

  // Defense passes; adaptation carries the digest verbatim; quality scores from records.
  const defense = enforceInstructionDefense(first.composed);
  assert.equal(defense.ok, true);
  const adapted = adaptComposedInstruction(first.composed);
  assert.equal(adapted.ok, true);
  assert.equal(adapted.data.metadata.instructionDigest, first.composed.digest);

  const record = buildInstructionRecord({
    composed: first.composed, flags: defense.flags, outcome: 'dispatched',
    recordId: 'sdk-rec-1', dispatchedAt: new Date().toISOString(),
  });
  const quality = scoreInstructionQuality([record]);
  assert.equal(quality.dimensions.instructionIntegrity, 100);
  // Record round-trips through the fail-closed parser.
  const parsed = parseInstructionRecord(recordToJsonObject(record));
  assert.equal(parsed.ok, true);
  // Tampering is rejected through the SDK surface too.
  const tampered = { ...recordToJsonObject(record), digest: 'deadbeef' };
  assert.equal(parseInstructionRecord(tampered).ok, false);
});

test('SDK exposes the governed execution surfaces with compatible behavior', async () => {
  assert.equal(typeof materializeTool, 'function');
  assert.equal(typeof buildCompletionReceipt, 'function');
  assert.equal(typeof assertCompletionReceipt, 'function');
  assert.equal(typeof assertChildReceipt, 'function');
  assert.equal(typeof GovernedProviderRouter, 'function');
  assert.equal(typeof DelegationRuntime, 'function');
  assert.equal(typeof GovernedHookExecutor, 'function');
  assert.equal(typeof InMemoryCapabilityGrantRegistry, 'function');

  // Materialization contract is usable through the SDK and fails closed on invalid identity.
  const materialized = materializeTool({
    toolId: 'demo.tool', capabilityId: 'permission.workspace.read', retrySafety: 'READ_ONLY',
    missionId: 'mission', taskId: 'task', executionId: 'task', sessionId: 'session', actor: 'user',
  });
  assert.equal(materialized.ok, true);
  const invalid = materializeTool({ toolId: '', capabilityId: 'permission.workspace.read', retrySafety: 'READ_ONLY',
    missionId: 'm', taskId: 't', executionId: 't', sessionId: 's', actor: 'a' });
  assert.equal(invalid.ok, false);

  // Governed hook executor denies execution without broker authority.
  const deniedBroker = { resolve: async () => ({ granted: false, reason: 'no authority' }) };
  const executor = new GovernedHookExecutor(deniedBroker);
  const record = await executor.dispatch(
    { pluginId: 'demo.plugin', pluginVersion: '1.0.0', kind: 'tool', permissions: ['workspace.read'], handler: () => undefined },
    {}, {});
  assert.equal(record.status, 'DENIED');

  // Completion receipt validation rejects forged chains through the SDK surface.
  const unverified = buildCompletionReceipt({
    identity: { missionId: 'm', executionId: 't', taskId: 't', sessionId: 's', workflowId: 'w', actor: 'a' },
    summary: 's', evidence: { contractVersion: '1.0.0', id: 'e', missionId: 'm', executionId: 't', kind: 'state',
      createdAt: '2026-01-01T00:00:00.000Z', source: 'runtime.workflow', data: {}, redactions: [] },
    verification: { success: false, reason: 'failed', evidenceId: 'e' }, independent: true,
  });
  assert.equal(unverified.ok, false);
});

test('SDK preserves configuration and propagates runtime failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quack-sdk-test-'));
  const client = new QuackClient();
  try {
    await assert.rejects(client.submitGoal('test'), /not initialized/);
    await client.initialize({ workspaceRoot: root, dataDir: join(root, 'state') });
    const system = client.getSystem();
    assert.equal(system.config.workspaceRoot, root);
    assert.equal(system.config.dataDir, join(root, 'state'));
    assert.equal(typeof system.governedProviderRouter.route, 'function');
    await assert.rejects(client.initialize(), /already initialized/);
    system.runtime.submitGoal = async () => ({ ok: false, error: {
      code: 'runtime.unsupported', message: 'No executor is configured.',
      category: 'runtime', recoverable: false,
    }});
    await assert.rejects(client.submitGoal('test'), { code: 'runtime.unsupported' });
    await client.shutdown();
    assert.throws(() => client.getSystem(), /not initialized/);
  } finally {
    await client.shutdown();
    await rm(root, { recursive: true, force: true });
  }
});

test('P9.25 SDK exports the semantic-memory surface with stable contracts', async () => {
  // Scope vocabulary + bounds are contract constants.
  assert.deepEqual([...SEMANTIC_MEMORY_SCOPES], ['session', 'task', 'agent', 'workspace', 'project', 'global']);
  assert.equal(SEMANTIC_MEMORY_BOUNDS.maxRetrievalResults > 0, true);

  // Content hashing + chunking are deterministic through the package.
  assert.equal(semanticContentHash('a'), semanticContentHash('a'));
  const chunks = chunkSemanticMemory('smem-sdk', 'x'.repeat(SEMANTIC_MEMORY_BOUNDS.maxChunkChars * 2 + 1));
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].chunkId, chunkSemanticMemory('smem-sdk', 'x'.repeat(SEMANTIC_MEMORY_BOUNDS.maxChunkChars * 2 + 1))[0].chunkId);

  // Admission rejects non-explicit persistence through the SDK surface.
  const rejected = admitSemanticMemory({
    content: 'sdk note', scope: 'global', owner: 'o',
    provenance: { sourceKind: 'user', sourceId: 'o' }, actor: 'o', persistence: 'implicit',
  }, new Date().toISOString(), 'smem-sdk-1');
  assert.equal(rejected.ok && rejected.data.rejection.code, 'memory.admission_persistence_not_explicit');

  // Memory candidates flow through the full QIE pipeline in the MEMORY lane.
  const retrieval = {
    hits: [], admittedMemoryIds: ['smem-sdk-1'], scope: 'global', owner: 'o',
  };
  const candidate = memoryCandidate('smem-sdk-1', 'sdk note content', 0.5, 'chunk-1');
  assert.equal(candidate.item.provenance.trust, 'MEMORY');
  assert.deepEqual(semanticMemoryAuthorities(retrieval).admittedMemory, ['smem-sdk-1']);
  assert.equal(memoryCandidatesFromRetrieval({
    hits: [{ memory: { memoryId: 'smem-sdk-1', content: 'sdk note content' }, score: 0.5, matchedChunkId: 'chunk-1' }],
    admittedMemoryIds: ['smem-sdk-1'], scope: 'global', owner: 'o',
  })[0].item.id, 'memory:smem-sdk-1');

  // Cosine + quality scoring are pure and deterministic.
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  const quality = scoreMemoryQuality({ records: [], deletedIds: [], retrievals: [] });
  assert.equal(quality.recordCount, 0);

  // Unsupported knowledge sources fail closed through the SDK.
  assert.equal((await resolveKnowledgeSource({ kind: 'url', path: 'https://x.example' }, '.')).ok, false);
});

test('P9.25 SDK semantic-memory service round-trips through the package path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quack-sdk-semantic-'));
  try {
    const service = new SemanticMemoryService({
      dataDir: join(root, 'state'),
      workspaceRoot: root,
    });
    const remembered = await service.remember({
      content: 'operator prefers short summaries',
      scope: 'global', owner: 'operator', actor: 'operator',
      context: { actor: 'operator' },
    });
    assert.equal(remembered.ok, true);
    assert.equal(remembered.data.embedded, false, 'embeddings disabled without a governed runtime');
    assert.equal(typeof remembered.data.record.memoryId, 'string');

    const inspected = await service.inspect(remembered.data.record.memoryId);
    assert.equal(inspected.ok, true);
    const roundTrip = parseSemanticMemoryRecord(JSON.parse(JSON.stringify(inspected.data)));
    assert.equal(roundTrip.ok, true, 'canonical record round-trips through fail-closed parse');

    const listed = await service.list('global');
    assert.equal(listed.length, 1);

    const deleted = await service.forget(remembered.data.record.memoryId, { actor: 'operator' });
    assert.equal(deleted.ok && deleted.data.deleted, true);
    assert.equal((await service.list()).length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
