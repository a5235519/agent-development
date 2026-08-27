export const EvaluationRunStatus = Object.freeze({
  queued: 'QUEUED',
  running: 'RUNNING',
  completed: 'COMPLETED',
  failed: 'FAILED',
});

export const GateVerdict = Object.freeze({ pass: 'PASS', blocked: 'BLOCKED' });

export function assertEvaluationSuite(suite) {
  const required = ['id', 'projectId', 'dataset', 'baselineVersion', 'candidateVersion', 'evaluators', 'gatePolicy'];
  const missing = required.filter((key) => suite?.[key] == null);
  if (missing.length) throw new Error(`EvaluationSuite 缺少字段: ${missing.join(', ')}`);
  if (!Array.isArray(suite.dataset.cases) || suite.dataset.cases.length === 0) {
    throw new Error('EvaluationSuite 至少需要一个测试样本');
  }
  return suite;
}

export function decideGate({ metrics, pendingReviews = 0 }, policy) {
  const failedRules = policy.requiredMetrics.filter((name) => (metrics[name]?.score ?? 0) < metrics[name]?.threshold);
  const blocked = failedRules.length > 0 || (policy.requireHumanReview && pendingReviews > 0);
  return {
    verdict: blocked ? GateVerdict.blocked : GateVerdict.pass,
    failedRules,
    pendingReviews,
  };
}

export function createEvaluationRun(suite, now = new Date()) {
  assertEvaluationSuite(suite);
  return {
    id: `eval_${now.getTime().toString(36)}`,
    suiteId: suite.id,
    projectId: suite.projectId,
    baselineVersion: suite.baselineVersion,
    candidateVersion: suite.candidateVersion,
    datasetVersion: suite.dataset.version,
    evaluatorVersions: suite.evaluators.map(({ id, version }) => ({ id, version })),
    status: EvaluationRunStatus.queued,
    createdAt: now.toISOString(),
  };
}
