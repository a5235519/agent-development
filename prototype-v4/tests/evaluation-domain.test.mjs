import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvaluationRun, decideGate, GateVerdict } from '../src/domain/evaluation.js';
import { completedEvaluationResult, evaluationSuite } from '../src/data/evaluationSuite.js';
import { mockAgentWorkbenchApi } from '../src/services/mockAgentWorkbenchApi.js';
import { evaluateArtifactProvenance, evaluateShotCoverage } from '../src/domain/artifacts.js';

test('creates an immutable evaluation receipt with version snapshots', () => {
  const run = createEvaluationRun(evaluationSuite, new Date('2026-08-11T00:00:00.000Z'));
  assert.match(run.id, /^eval_[a-z0-9]+$/);
  assert.equal(run.datasetVersion, 'v3');
  assert.equal(run.evaluatorVersions.length, 6);
  assert.equal(run.candidateVersion, 'workflow-v1.3');
});

test('blocks release when a required metric fails or reviews remain', () => {
  const decision = decideGate(completedEvaluationResult, evaluationSuite.gatePolicy);
  assert.equal(decision.verdict, GateVerdict.blocked);
  assert.deepEqual(decision.failedRules, ['coverage', 'compositionContinuity']);
  assert.equal(decision.pendingReviews, 2);
});

test('mock API preserves run state and returns a gate decision', async () => {
  const created = await mockAgentWorkbenchApi.createEvaluationRun();
  const events = [];
  const completed = await mockAgentWorkbenchApi.waitForEvaluationEvents(created.id, (event) => events.push(event.type), 0);
  const stored = await mockAgentWorkbenchApi.getEvaluationRun(created.id);
  assert.equal(completed.result.summary.passed, 3);
  assert.equal(completed.result.gate.verdict, GateVerdict.blocked);
  assert.equal(stored.status, 'COMPLETED');
  assert.deepEqual(events, ['EVALUATION_STARTED', 'HEARTBEAT', 'EVALUATION_COMPLETED']);
  const decisions = await mockAgentWorkbenchApi.listGateDecisions('EP01');
  assert.equal(decisions.items[0].runId, created.id);
});

test('deterministic evaluators expose missing shots and broken provenance', () => {
  const artifacts = [
    { id: 'a1', role: 'storyboard.draft', shotId: 'S01', sha256: 'hash', producerRunId: 'run_1', sourceArtifactIds: [] },
    { id: 'a2', role: 'storyboard.draft', shotId: 'S02', sha256: 'hash', producerRunId: null, sourceArtifactIds: [] },
  ];
  const coverage = evaluateShotCoverage(artifacts, ['S01', 'S02', 'S03']);
  const provenance = evaluateArtifactProvenance(artifacts);
  assert.deepEqual(coverage.missingShotIds, ['S03']);
  assert.equal(coverage.verdict, 'FAIL');
  assert.deepEqual(provenance.invalidArtifactIds, ['a2']);
  assert.equal(provenance.verdict, 'FAIL');
});
