export const evaluationSuite = {
  id: 'EP01-quality-v1',
  projectId: 'EP01',
  name: 'EP01 · 分镜质量评估',
  baselineVersion: 'workflow-v1.2',
  candidateVersion: 'workflow-v1.3',
  dataset: {
    id: 'EP01-golden',
    version: 'v3',
    cases: [
      { id: 'CASE-001', kind: 'normal', shotId: 'S01' },
      { id: 'CASE-013', kind: 'regression', shotId: 'S13' },
      { id: 'CASE-017', kind: 'edge', shotId: 'S17' },
    ],
    totalCount: 24,
  },
  evaluators: [
    { id: 'shot-coverage', version: '1.1.0', type: 'deterministic' },
    { id: 'character-continuity', version: '2.0.0', type: 'vision-judge' },
    { id: 'composition-continuity', version: '1.4.0', type: 'vision-judge' },
    { id: 'script-alignment', version: '1.2.0', type: 'model-judge' },
    { id: 'artifact-provenance', version: '1.0.0', type: 'schema' },
    { id: 'human-review', version: '1.0.0', type: 'human' },
  ],
  gatePolicy: {
    id: 'storyboard-finalization-gate',
    version: '1.0.0',
    requiredMetrics: ['coverage', 'compositionContinuity'],
    requireHumanReview: true,
  },
};

export const completedEvaluationResult = {
  summary: { score: 82, passed: 22, total: 24, baselineDelta: 9 },
  metrics: {
    coverage: { score: 96, threshold: 100 },
    compositionContinuity: { score: 84, threshold: 90 },
    provenance: { score: 100, threshold: 100 },
    costEfficiency: { score: 76, threshold: 70 },
  },
  pendingReviews: 2,
  failedCaseIds: ['CASE-013', 'CASE-017'],
};
