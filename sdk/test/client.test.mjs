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
