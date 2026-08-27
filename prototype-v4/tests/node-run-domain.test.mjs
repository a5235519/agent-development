import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeRunArtifactPreflight, assertNodeRunInput, createNodeRun, createNodeRunReceipt, NodeRunStatus, storyboardDraftContract } from '../src/domain/nodeRun.js';

const input = { projectId: 'EP01', pluginId: storyboardDraftContract.id, pluginVersion: storyboardDraftContract.version, operation: storyboardDraftContract.operation, mode: 'repair', shotId: 'S13', inputArtifactIds: ['artifact_1','artifact_1'] };

test('freezes the published Plugin Contract route in a queued NodeRun', () => {
  const run = createNodeRun(input, 'node_run_1', new Date('2026-08-12T00:00:00.000Z'));
  assert.equal(run.status, NodeRunStatus.queued); assert.equal(run.skillRoute, storyboardDraftContract.skillRoute); assert.deepEqual(run.inputArtifactIds, ['artifact_1']);
});

test('rejects command, shell and arbitrary repair scope from browser input', () => {
  assert.throws(() => assertNodeRunInput({ ...input, command: 'echo unsafe' }), /不能提交命令/);
  assert.throws(() => assertNodeRunInput({ ...input, shotId: 'S12' }), /只允许 S13/);
});

test('creates an immutable-shape receipt only for a completed NodeRun', () => {
  const queued = createNodeRun(input, 'node_run_2'); assert.throws(() => createNodeRunReceipt(queued, {}), /只有已完成/);
  const completed = { ...queued, status: NodeRunStatus.completed, runnerId: 'runner-local-01', startedAt: '2026-08-12T00:00:00.000Z', completedAt: '2026-08-12T00:01:00.000Z' };
  const receipt = createNodeRunReceipt(completed, { outputArtifactIds: [], validatorResults: [{ id: 'artifact-adapter', verdict: 'NEEDS_CODEX_ADAPTER' }] });
  assert.equal(receipt.id, 'receipt_node_run_2'); assert.equal(receipt.actualSkillRoute, storyboardDraftContract.skillRoute);
});

test('blocks repair before Codex when script, reference or adjacent shots are missing',()=>{const map=new Map([['script',{id:'script',projectId:'EP01',role:'script.final',isActive:true}]]);assert.throws(()=>assertNodeRunArtifactPreflight({...input,inputArtifactIds:['script']},map),/image.reference.*storyboard.draft:S12.*storyboard.draft:S14/)});
