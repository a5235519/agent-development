export const ReviewTaskStatus = Object.freeze({ open: 'OPEN', claimed: 'CLAIMED', submitted: 'SUBMITTED' });
export const ReviewVerdict = Object.freeze({ pass: 'PASS', fail: 'FAIL', needsChanges: 'NEEDS_CHANGES' });
export const ReviewRoles = Object.freeze({ reviewer: 'reviewer', admin: 'admin', viewer: 'viewer', system: 'system' });

export function assertReviewActor(actor, allowedRoles = [ReviewRoles.reviewer, ReviewRoles.admin]) {
  if (!actor?.id) throw new Error('缺少复核操作者');
  if (!allowedRoles.includes(actor.role)) throw new Error(`角色 ${actor.role || 'unknown'} 无权执行复核操作`);
  return actor;
}

export function createReviewTask(input, id, now = new Date()) {
  if (!input?.projectId || !input?.runId || !input?.caseId) throw new Error('ReviewTask 缺少 projectId、runId 或 caseId');
  return {
    id,
    projectId: input.projectId,
    runId: input.runId,
    caseId: input.caseId,
    shotId: input.shotId || null,
    title: input.title || `${input.caseId} 人工复核`,
    evidenceArtifactIds: [...new Set(input.evidenceArtifactIds || [])],
    status: ReviewTaskStatus.open,
    requiredRole: ReviewRoles.reviewer,
    assigneeId: null,
    createdAt: now.toISOString(),
  };
}

export function claimReviewTask(task, actor, claim, now = new Date()) {
  assertReviewActor(actor);
  if (task.status === ReviewTaskStatus.submitted) throw new Error('已提交的复核任务不能重新领取');
  return { ...task, status: ReviewTaskStatus.claimed, assigneeId: actor.id, claimedAt: now.toISOString(), claimExpiresAt: claim.expiresAt };
}

export function submitReviewDecision(task, actor, input, now = new Date()) {
  assertReviewActor(actor);
  if (task.status !== ReviewTaskStatus.claimed || task.assigneeId !== actor.id) throw new Error('只能提交本人已领取的复核任务');
  if (!Object.values(ReviewVerdict).includes(input?.verdict)) throw new Error('复核结论必须为 PASS、FAIL 或 NEEDS_CHANGES');
  if (!input.comment?.trim()) throw new Error('提交复核必须填写审核意见');
  return {
    ...task,
    status: ReviewTaskStatus.submitted,
    verdict: input.verdict,
    comment: input.comment.trim(),
    evidenceArtifactIds: [...new Set([...(task.evidenceArtifactIds || []), ...(input.evidenceArtifactIds || [])])],
    submittedAt: now.toISOString(),
  };
}
