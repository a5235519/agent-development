export const NodeRunStatus = Object.freeze({ queued: 'QUEUED', running: 'RUNNING', completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED' });

export const storyboardDraftContract = Object.freeze({
  id: 'storyboard-draft',
  version: '1.4.0',
  operation: 'generate_storyboard_drafts',
  skillRoute: 'skills.storyboard.generate_drafts',
  entrySkill: 'designing-travel-comedy-series',
  allowedModes: ['full', 'repair'],
  allowedReadRoles: ['image.reference', 'script.final', 'storyboard.draft', 'storyboard.execution_config'],
  requiredInputs: Object.freeze({ full: ['script.final', 'image.reference'], repair: ['script.final', 'image.reference', 'storyboard.draft:S12', 'storyboard.draft:S14'] }),
  allowedWriteRoles: ['storyboard.draft', 'evaluation.evidence'],
  allowedTools: ['image.generate'],
  timeoutMs: 30 * 60 * 1000,
  maxRetries: 1,
});

export function assertNodeRunInput(input, contract = storyboardDraftContract) {
  if (input?.pluginId !== contract.id || input?.pluginVersion !== contract.version) throw new Error('Plugin Contract 版本不匹配');
  if (input.operation !== contract.operation) throw new Error('Operation 不在已发布 Plugin Contract 中');
  if (!contract.allowedModes.includes(input.mode)) throw new Error(`不支持的执行模式：${input.mode}`);
  if (!input.projectId) throw new Error('projectId 必填');
  if (input.command || input.shell || input.cwd) throw new Error('浏览器不能提交命令、Shell 或工作目录');
  if (input.mode === 'repair' && input.shotId !== 'S13') throw new Error('当前修复操作只允许 S13');
  return input;
}

export function assertNodeRunArtifactPreflight(input, artifactMap, contract = storyboardDraftContract) {
  const selected = (input.inputArtifactIds || []).map((id) => artifactMap.get(id)).filter(Boolean);
  const requirements = contract.requiredInputs[input.mode] || [];
  const missing = requirements.filter((requirement) => { const [role, shotId] = requirement.split(':'); return !selected.some((artifact) => artifact.projectId === input.projectId && artifact.isActive !== false && artifact.stale !== true && artifact.role === role && (!shotId || artifact.shotId === shotId)); });
  if (missing.length) throw Object.assign(new Error(`NodeRun 输入预检失败，缺少: ${missing.join(', ')}`), { code: 'NODE_RUN_PREFLIGHT_FAILED', missing });
  return selected;
}

export function createNodeRun(input, id, now = new Date()) {
  assertNodeRunInput(input);
  return {
    id,
    projectId: input.projectId,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    operation: input.operation,
    skillRoute: storyboardDraftContract.skillRoute,
    mode: input.mode,
    shotId: input.shotId || null,
    inputArtifactIds: [...new Set(input.inputArtifactIds || [])],
    status: NodeRunStatus.queued,
    attempt: input.attempt || 1,
    parentRunId: input.parentRunId || null,
    createdAt: now.toISOString(),
  };
}

export function createNodeRunReceipt(run, output, now = new Date()) {
  if (run.status !== NodeRunStatus.completed) throw new Error('只有已完成的 NodeRun 可以生成收据');
  return {
    id: `receipt_${run.id}`,
    nodeRunId: run.id,
    projectId: run.projectId,
    plugin: { id: run.pluginId, version: run.pluginVersion, operation: run.operation },
    actualSkillRoute: run.skillRoute,
    runnerId: run.runnerId,
    executionAdapter: run.executionAdapter,
    codexBinding: run.codexBinding || null,
    attempt: run.attempt,
    inputSnapshot: { artifactIds: run.inputArtifactIds },
    outputArtifactIds: output.outputArtifactIds || [],
    validatorResults: output.validatorResults || [],
    committedOutputRoot: run.committedOutputRoot || null,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    generatedAt: now.toISOString(),
  };
}
