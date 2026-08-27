export const ArtifactRole = Object.freeze({
  script: 'script.final',
  storyboardDraft: 'storyboard.draft',
  storyboardFinal: 'storyboard.final',
  imageReference: 'image.reference',
  evaluationEvidence: 'evaluation.evidence',
});

export function assertArtifactInput(input) {
  const required = ['projectId', 'role', 'filename', 'mediaType', 'contentBase64'];
  const missing = required.filter((key) => !input?.[key]);
  if (missing.length) throw new Error(`Artifact 缺少字段: ${missing.join(', ')}`);
  if (!Array.isArray(input.sourceArtifactIds ?? [])) throw new Error('sourceArtifactIds 必须是数组');
  return input;
}

export function evaluateShotCoverage(artifacts, expectedShotIds) {
  const actual = new Set(artifacts.filter((item) => item.isActive !== false && item.role.startsWith('storyboard.')).map((item) => item.shotId).filter(Boolean));
  const missingShotIds = expectedShotIds.filter((shotId) => !actual.has(shotId));
  const score = expectedShotIds.length ? Math.round(((expectedShotIds.length - missingShotIds.length) / expectedShotIds.length) * 100) : 100;
  return { evaluatorId: 'shot-coverage', version: '1.1.0', score, threshold: 100, verdict: missingShotIds.length ? 'FAIL' : 'PASS', missingShotIds, actualCount: actual.size, expectedCount: expectedShotIds.length };
}

export function evaluateArtifactProvenance(artifacts) {
  const generated = artifacts.filter((item) => item.isActive !== false && item.role !== ArtifactRole.imageReference);
  const invalidArtifactIds = generated.filter((item) => !item.producerRunId || !item.sha256 || !Array.isArray(item.sourceArtifactIds)).map((item) => item.id);
  const score = generated.length ? Math.round(((generated.length - invalidArtifactIds.length) / generated.length) * 100) : 100;
  return { evaluatorId: 'artifact-provenance', version: '1.0.0', score, threshold: 100, verdict: invalidArtifactIds.length ? 'FAIL' : 'PASS', invalidArtifactIds, checkedCount: generated.length };
}
