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

test('SDK package exports resolve to the public implementation', () => {
  assert.equal(QuackClient, SubpathClient);
  assert.equal(typeof InMemoryKnowledgeGraph, 'function');
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
