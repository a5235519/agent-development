import test from 'node:test';
import assert from 'node:assert/strict';
import { claimReviewTask, createReviewTask, ReviewTaskStatus, submitReviewDecision } from '../src/domain/humanReview.js';

test('creates and claims a review task with an expiring claim', () => {
  const task = createReviewTask({ projectId: 'EP01', runId: 'run-1', caseId: 'CASE-013', evidenceArtifactIds: ['a1', 'a1'] }, 'review-1');
  const claimed = claimReviewTask(task, { id: 'reviewer-1', role: 'reviewer' }, { expiresAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(task.status, ReviewTaskStatus.open);
  assert.equal(claimed.status, ReviewTaskStatus.claimed);
  assert.equal(claimed.assigneeId, 'reviewer-1');
  assert.deepEqual(claimed.evidenceArtifactIds, ['a1']);
});

test('requires the assignee, a valid verdict and a review comment', () => {
  const task = claimReviewTask(createReviewTask({ projectId: 'EP01', runId: 'run-1', caseId: 'CASE-013' }, 'review-1'), { id: 'reviewer-1', role: 'reviewer' }, { expiresAt: '2030-01-01T00:00:00.000Z' });
  assert.throws(() => submitReviewDecision(task, { id: 'reviewer-2', role: 'reviewer' }, { verdict: 'PASS', comment: 'ok' }), /本人已领取/);
  assert.throws(() => submitReviewDecision(task, { id: 'reviewer-1', role: 'reviewer' }, { verdict: 'UNKNOWN', comment: 'ok' }), /复核结论/);
  assert.throws(() => submitReviewDecision(task, { id: 'reviewer-1', role: 'reviewer' }, { verdict: 'PASS', comment: '' }), /审核意见/);
});

test('submits an immutable review outcome with merged evidence', () => {
  const task = claimReviewTask(createReviewTask({ projectId: 'EP01', runId: 'run-1', caseId: 'CASE-013', evidenceArtifactIds: ['a1'] }, 'review-1'), { id: 'reviewer-1', role: 'admin' }, { expiresAt: '2030-01-01T00:00:00.000Z' });
  const submitted = submitReviewDecision(task, { id: 'reviewer-1', role: 'admin' }, { verdict: 'NEEDS_CHANGES', comment: '构图需要修复', evidenceArtifactIds: ['a1', 'a2'] });
  assert.equal(submitted.status, ReviewTaskStatus.submitted);
  assert.equal(submitted.verdict, 'NEEDS_CHANGES');
  assert.deepEqual(submitted.evidenceArtifactIds, ['a1', 'a2']);
});
