import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { completedEvaluationResult, evaluationSuite } from '../src/data/evaluationSuite.js';
import { createEvaluationRun, decideGate, EvaluationRunStatus } from '../src/domain/evaluation.js';
import { assertArtifactInput, evaluateArtifactProvenance, evaluateShotCoverage } from '../src/domain/artifacts.js';
import { assertReviewActor, claimReviewTask, createReviewTask, ReviewRoles, ReviewTaskStatus, submitReviewDecision } from '../src/domain/humanReview.js';
import { assertNodeRunArtifactPreflight, assertNodeRunInput, createNodeRun, createNodeRunReceipt, NodeRunStatus, storyboardDraftContract } from '../src/domain/nodeRun.js';
import { assertRepository, createRepository } from './repository.mjs';
import { RemoteCodexGatewayClient } from './codex-gateway-client.mjs';
import { collectNodeRunOutputs, prepareNodeRunWorkspace } from './node-run-workspace.mjs';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const clone = (value) => structuredClone(value);
const safeFilename = (value) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120);

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, value) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(value));
}

function readActor(request) {
  return { id: request.headers['x-actor-id'] || 'anonymous', role: request.headers['x-actor-role'] || ReviewRoles.viewer };
}

export async function createAgentWorkbenchServer({ dataDir, evaluationDelayMs = 900, nodeRunStepDelayMs = 180, nodeRunTimeoutMs = storyboardDraftContract.timeoutMs, enableLocalRunner = true, codexGatewayUrl = process.env.CODEX_GATEWAY_URL, codexGatewayClient: suppliedCodexGateway, codexGatewayRunnerId = process.env.CODEX_RUNNER_ID, codexPollIntervalMs = 500, heartbeatIntervalMs = 15000, eventPollIntervalMs = 250, leaseTtlMs = 30000, repository: suppliedRepository, repositoryDriver, databaseUrl } = {}) {
  const resolvedDataDir = dataDir || join(process.cwd(), '.data');
  await mkdir(resolvedDataDir, { recursive: true });
  const runsPath = join(resolvedDataDir, 'evaluation-runs.json');
  const regressionsPath = join(resolvedDataDir, 'regression-cases.json');
  const eventsPath = join(resolvedDataDir, 'evaluation-events.json');
  const artifactsPath = join(resolvedDataDir, 'artifacts.json');
  const gateDecisionsPath = join(resolvedDataDir, 'gate-decisions.json');
  const databasePath = join(resolvedDataDir, 'agent-workbench.sqlite');
  const artifactFilesDir = join(resolvedDataDir, 'artifact-files');
  const nodeRunRoot = join(resolvedDataDir, 'node-runs');
  await mkdir(artifactFilesDir, { recursive: true });
  await mkdir(nodeRunRoot, { recursive: true });
  const repository = suppliedRepository
    ? assertRepository(suppliedRepository)
    : await createRepository({ driver: repositoryDriver || process.env.AGENT_REPOSITORY, databasePath, connectionString: databaseUrl });
  if (suppliedRepository) await repository.initialize();
  const migrateLegacyMap = async (kind, path) => {
    if (await repository.count(kind) > 0) return;
    const legacy = new Map(Object.entries(await readJson(path, {})));
    if (legacy.size) await repository.replaceMap(kind, legacy);
  };
  await migrateLegacyMap('evaluation-runs', runsPath);
  await migrateLegacyMap('artifacts', artifactsPath);
  await migrateLegacyMap('gate-decisions', gateDecisionsPath);
  const legacyEvents = new Map(Object.entries(await readJson(eventsPath, {})));
  for (const [runId, runEvents] of legacyEvents) {
    if (await repository.countEvents(runId) > 0) continue;
    for (const event of runEvents) await repository.appendEvent(runId, event);
  }
  if (await repository.countSet('regression-cases') === 0) {
    await repository.replaceSet('regression-cases', new Set(await readJson(regressionsPath, ['CASE-006', 'CASE-011', 'CASE-013'])));
  }
  const runs = await repository.loadMap('evaluation-runs');
  const regressions = await repository.loadSet('regression-cases');
  const artifacts = await repository.loadMap('artifacts');
  const gateDecisions = await repository.loadMap('gate-decisions');
  const reviewTasks = await repository.loadMap('review-tasks');
  const auditEvents = await repository.loadMap('audit-events');
  const nodeRuns = await repository.loadMap('node-runs');
  const nodeRunReceipts = await repository.loadMap('node-run-receipts');
  const runners = await repository.loadMap('runners');
  const instanceId = `api_${randomUUID()}`;
  const activeLeases = new Map();
  const scheduledTimers = new Set();

  const persistRun = async (run) => repository.putEntity('evaluation-runs', run.id, run);
  const persistArtifacts = async () => repository.putEntities('artifacts', artifacts);
  const persistGateDecision = async (decision) => repository.putEntity('gate-decisions', decision.id, decision);
  const persistReviewTask = async (task) => repository.putEntity('review-tasks', task.id, task);
  const persistNodeRun = async (run) => repository.putEntity('node-runs', run.id, run);
  const appendAudit = async ({ actor, action, entityType, entityId, details = {} }) => {
    const event = { id: `audit_${randomUUID()}`, actorId: actor.id, actorRole: actor.role, action, entityType, entityId, details, occurredAt: new Date().toISOString() };
    auditEvents.set(event.id, event); await repository.putEntity('audit-events', event.id, event); return event;
  };
  const ensureReviewTasks = async (run, result) => {
    const failedCaseIds = result.failedCaseIds || [];
    for (const caseId of failedCaseIds) {
      if ([...reviewTasks.values()].some((task) => task.runId === run.id && task.caseId === caseId)) continue;
      const shotId = caseId === 'CASE-013' ? 'S13' : caseId === 'CASE-017' ? 'S17' : null;
      const evidenceArtifactIds = [...artifacts.values()].filter((item) => item.projectId === run.projectId && (!shotId || item.shotId === shotId)).map((item) => item.id);
      const task = createReviewTask({ projectId: run.projectId, runId: run.id, caseId, shotId, title: `${caseId}${shotId ? ` · ${shotId}` : ''} 人工复核`, evidenceArtifactIds }, `review_${randomUUID()}`);
      reviewTasks.set(task.id, task); await persistReviewTask(task);
      await appendAudit({ actor: { id: instanceId, role: ReviewRoles.system }, action: 'REVIEW_TASK_CREATED', entityType: 'ReviewTask', entityId: task.id, details: { runId: run.id, caseId } });
    }
    return [...reviewTasks.values()].filter((task) => task.runId === run.id && task.status !== ReviewTaskStatus.submitted).length;
  };
  const invalidateDescendants = (rootArtifactIds, excludedIds = new Set()) => {
    const queue = [...rootArtifactIds]; const visited = new Set(queue); const invalidatedArtifactIds = [];
    while (queue.length) {
      const sourceId = queue.shift();
      for (const [artifactId, artifact] of artifacts) {
        if (visited.has(artifactId) || excludedIds.has(artifactId) || !artifact.sourceArtifactIds?.includes(sourceId)) continue;
        visited.add(artifactId); queue.push(artifactId);
        if (artifact.isActive !== false) {
          artifacts.set(artifactId, { ...artifact, stale: true, staleReason: 'UPSTREAM_VERSION_CHANGED', invalidatedByArtifactId: sourceId, invalidatedAt: new Date().toISOString() });
          invalidatedArtifactIds.push(artifactId);
        }
      }
    }
    return invalidatedArtifactIds;
  };
  const emitRunEvent = async (runId, type, payload = {}) => {
    return repository.appendEvent(runId, { type, occurredAt: new Date().toISOString(), payload });
  };
  const localRunnerId = 'runner-local-01';
  const runnerTimers = new Set();
  const codexGateway = suppliedCodexGateway || (codexGatewayUrl ? new RemoteCodexGatewayClient({ baseUrl: codexGatewayUrl, pollIntervalMs: codexPollIntervalMs }) : null);
  const registerLocalRunner = async () => {
    if (!enableLocalRunner) return;
    let status = 'ONLINE'; if (codexGateway) try { await codexGateway.health(); } catch { status = 'OFFLINE'; }
    const runner = { id: localRunnerId, name: codexGateway ? 'Remote Codex Bridge' : 'Local Contract Runner', adapter: codexGateway ? 'remote-codex-app-server' : 'contract-dry-run', gatewayUrl: codexGatewayUrl || null, status, capabilities: [storyboardDraftContract.id], concurrency: 1, lastHeartbeatAt: new Date().toISOString() };
    runners.set(runner.id, runner); await repository.putEntity('runners', runner.id, runner);
  };
  const finishNodeRun = async (run, status, payload = {}) => {
    const finishedAt = new Date().toISOString();
    const finished = { ...run, ...payload, status, completedAt: finishedAt };
    nodeRuns.set(finished.id, finished); await persistNodeRun(finished);
    const type = status === NodeRunStatus.cancelled ? 'NODE_RUN_CANCELLED' : 'NODE_RUN_FAILED';
    await appendAudit({ actor: { id: localRunnerId, role: ReviewRoles.system }, action: type, entityType: 'NodeRun', entityId: finished.id, details: { errorCode: finished.errorCode || null } });
    await emitRunEvent(finished.id, type, { progress: finished.progress, errorCode: finished.errorCode || null, message: finished.error || null });
    return finished;
  };
  const executeContractDryRun = async (runId) => {
    let run = (await repository.loadMap('node-runs')).get(runId); if (!run || run.status !== NodeRunStatus.queued) return;
    const lease = await repository.acquireLease(`node-run:${run.id}`, localRunnerId, 30000); if (!lease) return;
    const startedAt = new Date();
    run = { ...run, status: NodeRunStatus.running, runnerId: localRunnerId, executionAdapter: 'contract-dry-run', startedAt: startedAt.toISOString(), deadlineAt: new Date(startedAt.getTime() + nodeRunTimeoutMs).toISOString(), progress: { current: 1, total: 6, step: '冻结输入快照' } };
    nodeRuns.set(run.id, run); await persistNodeRun(run); await emitRunEvent(run.id, 'NODE_RUN_STARTED', { runnerId: localRunnerId, progress: run.progress });
    const steps = ['冻结输入快照','解析 Plugin Contract','解析实际 Skill 路由','执行受控生成适配器','运行输出 Validator','写入 NodeRun Receipt'];
    for (let index = 1; index < steps.length; index += 1) {
      await new Promise((resolve) => { const timer=setTimeout(()=>{runnerTimers.delete(timer);resolve()},nodeRunStepDelayMs);runnerTimers.add(timer); });
      run = (await repository.loadMap('node-runs')).get(run.id) || run;
      if (run.cancelRequestedAt) {
        await finishNodeRun(run, NodeRunStatus.cancelled, { cancelledAt: new Date().toISOString(), progress: { current: index, total: 6, step: '已取消' } }); await repository.releaseLease(`node-run:${run.id}`,localRunnerId,lease.token);return;
      }
      if (Date.now() > new Date(run.deadlineAt).getTime()) { await finishNodeRun(run, NodeRunStatus.failed, { errorCode: 'NODE_RUN_TIMEOUT', error: 'NodeRun 超过 Plugin Contract 的执行时限', progress: { current: index, total: 6, step: '执行超时' } }); await repository.releaseLease(`node-run:${run.id}`,localRunnerId,lease.token); return; }
      run = { ...run, progress: { current: index + 1, total: 6, step: steps[index] } }; nodeRuns.set(run.id,run);await persistNodeRun(run);await emitRunEvent(run.id,'NODE_RUN_PROGRESS',{progress:run.progress});
    }
    const completed = { ...run, status: NodeRunStatus.completed, completedAt: new Date().toISOString(), output: { outputArtifactIds: [], validatorResults: [{ id: 'artifact-adapter', verdict: 'NEEDS_CODEX_ADAPTER', detail: '控制面执行完成；尚未接入真实 Codex 产物适配器。' }] } };
    const receipt = createNodeRunReceipt(completed, completed.output); nodeRuns.set(run.id,completed);nodeRunReceipts.set(receipt.id,receipt);await persistNodeRun(completed);await repository.putEntity('node-run-receipts',receipt.id,receipt);
    await appendAudit({actor:{id:localRunnerId,role:ReviewRoles.system},action:'NODE_RUN_COMPLETED',entityType:'NodeRun',entityId:run.id,details:{receiptId:receipt.id}});await emitRunEvent(run.id,'NODE_RUN_COMPLETED',{receiptId:receipt.id,progress:completed.progress});await repository.releaseLease(`node-run:${run.id}`,localRunnerId,lease.token);
  };
  const executeRemoteNodeRun = async (runId) => {
    let run = (await repository.loadMap('node-runs')).get(runId); if (!run || run.status !== NodeRunStatus.queued) return;
    const lease = await repository.acquireLease(`node-run:${run.id}`, localRunnerId, 30000); if (!lease) return;
    try {
      const startedAt = new Date(); run = { ...run, status: NodeRunStatus.running, runnerId: localRunnerId, executionAdapter: 'remote-codex-app-server', startedAt: startedAt.toISOString(), deadlineAt: new Date(startedAt.getTime() + nodeRunTimeoutMs).toISOString(), progress: { current: 1, total: 5, step: '准备隔离运行目录' } };
      nodeRuns.set(run.id, run); await persistNodeRun(run); await emitRunEvent(run.id, 'NODE_RUN_STARTED', { runnerId: localRunnerId, executionAdapter: run.executionAdapter, progress: run.progress });
      const currentArtifacts = await repository.loadMap('artifacts'); const workspace = await prepareNodeRunWorkspace({ rootDir: nodeRunRoot, run, contract: storyboardDraftContract, artifacts: currentArtifacts, artifactFilesDir });
      run = { ...run, workspaceRoot: workspace.runRoot, progress: { current: 2, total: 5, step: '提交到 Codex Gateway' } }; nodeRuns.set(run.id,run);await persistNodeRun(run);await emitRunEvent(run.id,'NODE_RUN_PROGRESS',{progress:run.progress});
      const task = await codexGateway.startTask({ prompt: workspace.prompt, cwd: workspace.runRoot, runnerId: codexGatewayRunnerId });
      run = { ...run, codexBinding: { taskId: task.id, threadId: task.threadId || null, turnId: task.activeTurnId || null }, progress: { current: 3, total: 5, step: 'Codex Turn 执行中' } }; nodeRuns.set(run.id,run);await persistNodeRun(run);await emitRunEvent(run.id,'NODE_RUN_PROGRESS',{progress:run.progress,codexBinding:run.codexBinding});
      const finalTask = await codexGateway.waitForTask(task.id, { timeoutMs: nodeRunTimeoutMs, shouldCancel: async()=>Boolean((await repository.loadMap('node-runs')).get(run.id)?.cancelRequestedAt), onEvent: async(event)=>{ const binding={taskId:task.id,threadId:event.threadId||run.codexBinding?.threadId||null,turnId:event.turnId||run.codexBinding?.turnId||null};run={...(await repository.loadMap('node-runs')).get(run.id),codexBinding:binding};nodeRuns.set(run.id,run);await persistNodeRun(run);await emitRunEvent(run.id,'CODEX_EVENT',{sourceEventId:event.eventId,sourceSeq:event.seq,type:event.type,threadId:event.threadId,turnId:event.turnId,payload:event.payload}); } });
      if (finalTask.status === 'interrupted') { await finishNodeRun(run,NodeRunStatus.cancelled,{cancelledAt:new Date().toISOString(),progress:{current:3,total:5,step:'Codex Turn 已中断'}});return; }
      if (finalTask.status !== 'completed') throw Object.assign(new Error(finalTask.error||`Codex 任务终态为 ${finalTask.status}`),{code:'CODEX_TASK_FAILED'});
      run = { ...(await repository.loadMap('node-runs')).get(run.id), progress: { current: 4, total: 5, step: '收集并验证 Artifact' } };nodeRuns.set(run.id,run);await persistNodeRun(run);await emitRunEvent(run.id,'NODE_RUN_PROGRESS',{progress:run.progress});
      const collected = await collectNodeRunOutputs({ workspace, run, contract: storyboardDraftContract, artifactFilesDir });
      for (const artifact of collected.outputs) { artifacts.set(artifact.id,artifact); await repository.putEntity('artifacts',artifact.id,artifact); }
      const output = { outputArtifactIds: collected.outputs.map(item=>item.id), validatorResults: [{id:'node-result-schema',verdict:'PASS'},{id:'output-path-boundary',verdict:'PASS'},{id:'shot-coverage',verdict:'PASS'}] };
      const completed = { ...run, status:NodeRunStatus.completed,completedAt:new Date().toISOString(),committedOutputRoot:collected.committedDir,progress:{current:5,total:5,step:'Artifact 已提交并生成收据'},output };
      const receipt=createNodeRunReceipt(completed,output);nodeRuns.set(run.id,completed);nodeRunReceipts.set(receipt.id,receipt);await persistNodeRun(completed);await repository.putEntity('node-run-receipts',receipt.id,receipt);await appendAudit({actor:{id:localRunnerId,role:ReviewRoles.system},action:'NODE_RUN_COMPLETED',entityType:'NodeRun',entityId:run.id,details:{receiptId:receipt.id,taskId:task.id,outputArtifactIds:output.outputArtifactIds}});await emitRunEvent(run.id,'NODE_RUN_COMPLETED',{receiptId:receipt.id,outputArtifactIds:output.outputArtifactIds,progress:completed.progress});
    } catch (error) { run=(await repository.loadMap('node-runs')).get(run.id)||run;await finishNodeRun(run,NodeRunStatus.failed,{errorCode:error.code||'CODEX_ADAPTER_FAILED',error:error.message,progress:{...(run.progress||{current:0,total:5}),step:'Codex Adapter 执行失败'}}); }
    finally { await repository.releaseLease(`node-run:${run.id}`,localRunnerId,lease.token); }
  };
  const executeNodeRun = (runId) => codexGateway ? executeRemoteNodeRun(runId) : executeContractDryRun(runId);
  await registerLocalRunner();
  if (enableLocalRunner) {
    const runnerHeartbeat = setInterval(async () => { const current = runners.get(localRunnerId); if (!current) return; let status='ONLINE';if(codexGateway)try{await codexGateway.health()}catch{status='OFFLINE'}const updated = { ...current, status, lastHeartbeatAt: new Date().toISOString() }; runners.set(localRunnerId, updated); await repository.putEntity('runners', localRunnerId, updated); }, Math.max(1000, heartbeatIntervalMs));
    runnerTimers.add(runnerHeartbeat);
  }
  for (const run of nodeRuns.values()) if (enableLocalRunner && run.status === NodeRunStatus.queued) void executeNodeRun(run.id);

  const completeRun = async (runId) => {
    const current = runs.get(runId);
    if (!current || current.status === EvaluationRunStatus.completed) return current;
    const projectArtifacts = [...artifacts.values()].filter((item) => item.projectId === current.projectId);
    const expectedShotIds = Array.from({ length: 19 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`);
    const coverage = evaluateShotCoverage(projectArtifacts, expectedShotIds); const provenance = evaluateArtifactProvenance(projectArtifacts);
    const metrics = { ...clone(completedEvaluationResult.metrics), coverage: { score: coverage.score, threshold: coverage.threshold }, provenance: { score: provenance.score, threshold: provenance.threshold } };
    const failedCount = new Set([...completedEvaluationResult.failedCaseIds, ...coverage.missingShotIds, ...provenance.invalidArtifactIds]).size;
    const summary = { ...clone(completedEvaluationResult.summary), score: Math.round(Object.values(metrics).reduce((sum,metric)=>sum+metric.score,0)/Object.keys(metrics).length), passed: Math.max(0, completedEvaluationResult.summary.total-failedCount) };
    const result = { ...clone(completedEvaluationResult), summary, metrics, deterministicResults: [coverage, provenance] };
    result.pendingReviews = await ensureReviewTasks(current, result);
    const gate = decideGate(result, evaluationSuite.gatePolicy);
    const gateDecision = { id: `gate_${randomUUID()}`, projectId: current.projectId, stageId: 'storyboard-finalization', runId, policyVersion: evaluationSuite.gatePolicy.version, score: summary.score, passed: summary.passed, total: summary.total, ...gate, decidedAt: new Date().toISOString() };
    gateDecisions.set(gateDecision.id, gateDecision); await persistGateDecision(gateDecision);
    const completed = { ...current, status: EvaluationRunStatus.completed, completedAt: new Date().toISOString(), result: { ...result, gate, gateDecision } };
    runs.set(runId, completed); await persistRun(completed);
    await emitRunEvent(runId, 'EVALUATION_COMPLETED', { summary: completed.result.summary, gate });
    const lease = activeLeases.get(runId);
    if (lease) { await repository.releaseLease(lease.leaseKey, lease.ownerId, lease.token); activeLeases.delete(runId); }
    return completed;
  };
  const leaseKeyFor = (run) => `evaluation:${run.projectId}:${run.suiteId || evaluationSuite.id}`;
  const scheduleManagedRun = (run, lease) => {
    activeLeases.set(run.id, lease);
    const renewal = setInterval(async () => {
      const renewed = await repository.renewLease(lease.leaseKey, lease.ownerId, lease.token, leaseTtlMs);
      if (renewed) { activeLeases.set(run.id, renewed); lease = renewed; }
    }, Math.max(50, Math.floor(leaseTtlMs / 3)));
    const completion = setTimeout(async () => {
      clearInterval(renewal); scheduledTimers.delete(renewal); scheduledTimers.delete(completion);
      try { await completeRun(run.id); }
      catch (error) { await emitRunEvent(run.id, 'EVALUATION_FAILED', { message: error.message }); }
    }, evaluationDelayMs);
    scheduledTimers.add(renewal); scheduledTimers.add(completion);
  };
  const recoverManagedRun = async (run) => {
    const fresh = (await repository.loadMap('evaluation-runs')).get(run.id);
    if (!fresh || fresh.status !== EvaluationRunStatus.running) return;
    runs.set(fresh.id, fresh);
    const lease = await repository.acquireLease(leaseKeyFor(fresh), instanceId, leaseTtlMs);
    if (lease) return scheduleManagedRun(fresh, lease);
    const retry = setTimeout(() => { scheduledTimers.delete(retry); void recoverManagedRun(fresh); }, leaseTtlMs + 25);
    scheduledTimers.add(retry);
  };
  for (const run of runs.values()) if (run.status === EvaluationRunStatus.running) await recoverManagedRun(run);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,idempotency-key,x-actor-id,x-actor-role,x-review-claim-token' }); return response.end(); }
      response.setHeader('access-control-allow-origin', '*');

      if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok', service: 'agent-workbench-api', instanceId, repository: repository.driver || 'custom', eventStore: 'append-only', eventTransport: repository.eventTransport || 'custom', leaseTtlMs });
      if (request.method === 'POST' && url.pathname === '/api/artifacts') {
        const input = assertArtifactInput(await readBody(request));
        const bytes = Buffer.from(input.contentBase64, 'base64');
        const id = `artifact_${randomUUID()}`;
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const storedFilename = `${id}-${safeFilename(input.filename)}`;
        await writeFile(join(artifactFilesDir, storedFilename), bytes);
        const versionGroupId = input.versionGroupId || id;
        const previousActive = input.versionGroupId ? [...artifacts.values()].find((current) => (current.versionGroupId || current.id) === versionGroupId && current.isActive !== false) : null;
        if (input.versionGroupId) for (const [artifactId, current] of artifacts) if ((current.versionGroupId || current.id) === versionGroupId) artifacts.set(artifactId, { ...current, isActive: false });
        const artifact = { id, projectId: input.projectId, role: input.role, shotId: input.shotId || null, filename: input.filename, mediaType: input.mediaType, byteSize: bytes.length, sha256, uri: `/api/artifacts/${id}/content`, producerRunId: input.producerRunId || null, sourceArtifactIds: input.sourceArtifactIds || [], versionGroupId, isActive: true, createdAt: new Date().toISOString(), storedFilename };
        artifacts.set(id, artifact);
        const invalidatedArtifactIds = previousActive ? invalidateDescendants([previousActive.id], new Set([id, ...[...artifacts.values()].filter((item)=>(item.versionGroupId||item.id)===versionGroupId).map((item)=>item.id)])) : [];
        await persistArtifacts();
        return sendJson(response, 201, { ...artifact, invalidatedArtifactIds });
      }
      if (request.method === 'GET' && url.pathname === '/api/artifacts') {
        const projectId = url.searchParams.get('projectId'); const role = url.searchParams.get('role'); const shotId = url.searchParams.get('shotId');
        const result = [...artifacts.values()].filter((item) => (!projectId || item.projectId === projectId) && (!role || item.role === role) && (!shotId || item.shotId === shotId));
        return sendJson(response, 200, { items: result, total: result.length });
      }
      if (request.method === 'GET' && parts[1] === 'artifacts' && parts[2]) {
        const artifact = artifacts.get(parts[2]); if (!artifact) return sendJson(response, 404, { error: 'Artifact 不存在' });
        if (parts[3] === 'content') { response.writeHead(200, { 'content-type': artifact.mediaType, 'content-length': artifact.byteSize, etag: `"${artifact.sha256}"` }); return response.end(await readFile(join(artifactFilesDir, artifact.storedFilename))); }
        return sendJson(response, 200, artifact);
      }
      if (request.method === 'PATCH' && parts[1] === 'artifacts' && parts[2] && parts[3] === 'activate') {
        const artifact = artifacts.get(parts[2]); if (!artifact) return sendJson(response, 404, { error: 'Artifact 不存在' });
        const versionGroupId = artifact.versionGroupId || artifact.id;
        const previousActive = [...artifacts.values()].find((current) => (current.versionGroupId || current.id) === versionGroupId && current.isActive !== false);
        for (const [artifactId, current] of artifacts) if ((current.versionGroupId || current.id) === versionGroupId) artifacts.set(artifactId, { ...current, isActive: artifactId === artifact.id, activatedAt: artifactId === artifact.id ? new Date().toISOString() : current.activatedAt });
        const groupIds = new Set([...artifacts.values()].filter((item)=>(item.versionGroupId||item.id)===versionGroupId).map((item)=>item.id));
        const invalidatedArtifactIds = previousActive && previousActive.id !== artifact.id ? invalidateDescendants([previousActive.id], groupIds) : [];
        await persistArtifacts();
        return sendJson(response, 200, { ...artifacts.get(artifact.id), invalidatedArtifactIds });
      }
      if (request.method === 'GET' && url.pathname === '/api/plugin-contracts/storyboard-draft') return sendJson(response, 200, storyboardDraftContract);
      if (request.method === 'GET' && url.pathname === '/api/runners') {
        const persisted = await repository.loadMap('runners');
        const items = [...persisted.values()].map((runner) => ({ ...runner, status: Date.now() - new Date(runner.lastHeartbeatAt).getTime() > heartbeatIntervalMs * 3 ? 'OFFLINE' : runner.status }));
        return sendJson(response, 200, { items, total: items.length });
      }
      if (request.method === 'POST' && parts[1] === 'runners' && parts[2] && parts[3] === 'heartbeat') {
        const runner = (await repository.loadMap('runners')).get(parts[2]); if (!runner) return sendJson(response, 404, { error: 'Runner 不存在' });
        const updated = { ...runner, status: 'ONLINE', lastHeartbeatAt: new Date().toISOString() }; runners.set(updated.id, updated); await repository.putEntity('runners', updated.id, updated); return sendJson(response, 200, updated);
      }
      if (request.method === 'GET' && url.pathname === '/api/node-runs') {
        const persisted = await repository.loadMap('node-runs'); const status = url.searchParams.get('status'); const projectId = url.searchParams.get('projectId');
        const items = [...persisted.values()].filter((run) => (!status || run.status === status) && (!projectId || run.projectId === projectId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
        return sendJson(response, 200, { items, total: items.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/node-runs') {
        const actor = readActor(request); if (![ReviewRoles.admin, ReviewRoles.system].includes(actor.role)) return sendJson(response, 403, { error: '只有管理员或系统执行器可以创建 NodeRun' });
        let body; try { body = assertNodeRunInput(await readBody(request)); } catch (error) { return sendJson(response, 400, { error: error.message }); }
        const currentArtifacts = await repository.loadMap('artifacts'); const invalidInputs = (body.inputArtifactIds || []).filter((id) => !currentArtifacts.has(id) || currentArtifacts.get(id).projectId !== body.projectId);
        if (invalidInputs.length) return sendJson(response, 400, { error: `输入 Artifact 无效: ${invalidInputs.join(', ')}` });
        try { assertNodeRunArtifactPreflight(body, currentArtifacts); } catch (error) { return sendJson(response, 422, { error: error.message, code: error.code, missing: error.missing }); }
        const run = createNodeRun(body, `node_run_${randomUUID()}`); nodeRuns.set(run.id, run); await persistNodeRun(run);
        await appendAudit({ actor, action: 'NODE_RUN_QUEUED', entityType: 'NodeRun', entityId: run.id, details: { pluginId: run.pluginId, operation: run.operation, mode: run.mode } });
        await emitRunEvent(run.id, 'NODE_RUN_QUEUED', { pluginId: run.pluginId, operation: run.operation, mode: run.mode });
        if (enableLocalRunner) void executeNodeRun(run.id);
        return sendJson(response, 202, run);
      }
      if (parts[1] === 'node-runs' && parts[2]) {
        const persisted = await repository.loadMap('node-runs'); const run = persisted.get(parts[2]); if (!run) return sendJson(response, 404, { error: 'NodeRun 不存在' });
        if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, run);
        if (request.method === 'GET' && parts[3] === 'receipt') { const receipt = (await repository.loadMap('node-run-receipts')).get(`receipt_${run.id}`); return receipt ? sendJson(response, 200, receipt) : sendJson(response, 404, { error: 'NodeRun Receipt 尚未生成' }); }
        if (request.method === 'POST' && parts[3] === 'cancel') {
          const actor = readActor(request); if (![ReviewRoles.admin, ReviewRoles.system].includes(actor.role)) return sendJson(response, 403, { error: '无权取消 NodeRun' });
          if ([NodeRunStatus.completed, NodeRunStatus.failed, NodeRunStatus.cancelled].includes(run.status)) return sendJson(response, 409, { error: `NodeRun 已处于终态 ${run.status}` });
          const updated = { ...run, cancelRequestedAt: new Date().toISOString(), cancelRequestedBy: actor.id }; nodeRuns.set(run.id, updated); await persistNodeRun(updated); await appendAudit({ actor, action: 'NODE_RUN_CANCEL_REQUESTED', entityType: 'NodeRun', entityId: run.id }); await emitRunEvent(run.id, 'NODE_RUN_CANCEL_REQUESTED'); return sendJson(response, 202, updated);
        }
        if (request.method === 'POST' && parts[3] === 'retry') {
          const actor = readActor(request); if (![ReviewRoles.admin, ReviewRoles.system].includes(actor.role)) return sendJson(response, 403, { error: '无权重试 NodeRun' });
          if (![NodeRunStatus.failed, NodeRunStatus.cancelled].includes(run.status)) return sendJson(response, 409, { error: '只有失败或已取消的 NodeRun 可以重试' });
          if (run.attempt > storyboardDraftContract.maxRetries) return sendJson(response, 409, { error: '已达到 Plugin Contract 最大重试次数' });
          const retried = createNodeRun({ ...run, attempt: run.attempt + 1, parentRunId: run.id }, `node_run_${randomUUID()}`); nodeRuns.set(retried.id, retried); await persistNodeRun(retried); await appendAudit({ actor, action: 'NODE_RUN_RETRIED', entityType: 'NodeRun', entityId: retried.id, details: { parentRunId: run.id } }); await emitRunEvent(retried.id, 'NODE_RUN_QUEUED', { parentRunId: run.id, attempt: retried.attempt }); if (enableLocalRunner) void executeNodeRun(retried.id); return sendJson(response, 202, retried);
        }
        if (request.method === 'GET' && parts[3] === 'events') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const allEvents = await repository.loadEvents(run.id); const lastEventId = request.headers['last-event-id']; const lastIndex = lastEventId ? allEvents.findIndex((event) => event.eventId === lastEventId) : -1;
          for (const event of allEvents.slice(lastIndex + 1)) response.write(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if ([NodeRunStatus.completed, NodeRunStatus.failed, NodeRunStatus.cancelled].includes(run.status)) return response.end();
          const heartbeat = setInterval(() => { const event = { type: 'HEARTBEAT', runId: run.id, occurredAt: new Date().toISOString(), payload: { status: nodeRuns.get(run.id)?.status } }; response.write(`event: HEARTBEAT\ndata: ${JSON.stringify(event)}\n\n`); }, heartbeatIntervalMs);
          let unsubscribe = async () => {}; let closed = false; const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); void unsubscribe(); };
          const terminal = new Set(['NODE_RUN_COMPLETED','NODE_RUN_FAILED','NODE_RUN_CANCELLED']); const listener = (event) => { if (closed) return; response.write(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); if (terminal.has(event.type)) { cleanup(); response.end(); } };
          unsubscribe = await repository.subscribeEvents(run.id, allEvents.at(-1)?.sequence || 0, listener, { pollIntervalMs: eventPollIntervalMs }); request.on('close', cleanup); return;
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/evaluator-runs') {
        const body = await readBody(request); const projectArtifacts = [...artifacts.values()].filter((item) => item.projectId === body.projectId);
        const expectedShotIds = body.expectedShotIds || Array.from({ length: 19 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`);
        const results = [evaluateShotCoverage(projectArtifacts, expectedShotIds), evaluateArtifactProvenance(projectArtifacts)];
        return sendJson(response, 201, { id: `evaluator_${randomUUID()}`, projectId: body.projectId, status: 'COMPLETED', results, verdict: results.some((result) => result.verdict === 'FAIL') ? 'BLOCKED' : 'PASS', completedAt: new Date().toISOString() });
      }
      if (request.method === 'GET' && parts[1] === 'evaluation-suites') {
        if (parts[2] !== evaluationSuite.id) return sendJson(response, 404, { error: 'EvaluationSuite 不存在' });
        return sendJson(response, 200, evaluationSuite);
      }
      if (request.method === 'GET' && url.pathname === '/api/evaluation-runs') {
        const status = url.searchParams.get('status'); const projectId = url.searchParams.get('projectId');
        const items = [...runs.values()].filter((run)=>(!status||run.status===status)&&(!projectId||run.projectId===projectId)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
        return sendJson(response, 200, { items, total: items.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/evaluation-runs') {
        const body = await readBody(request);
        if (body.suiteId && body.suiteId !== evaluationSuite.id) return sendJson(response, 404, { error: 'EvaluationSuite 不存在' });
        const idempotencyKey = request.headers['idempotency-key'];
        const existing = idempotencyKey && [...runs.values()].find((run) => run.idempotencyKey === idempotencyKey);
        if (existing) return sendJson(response, 200, existing);
        const run = { ...createEvaluationRun(evaluationSuite), status: EvaluationRunStatus.running, idempotencyKey: idempotencyKey || null };
        const leaseKey = leaseKeyFor(run);
        const lease = await repository.acquireLease(leaseKey, instanceId, leaseTtlMs);
        if (!lease) {
          const persistedRuns = await repository.loadMap('evaluation-runs');
          for (const [runId, persistedRun] of persistedRuns) runs.set(runId, persistedRun);
          const activeRun = [...persistedRuns.values()].find((item) => item.status === EvaluationRunStatus.running && leaseKeyFor(item) === leaseKey);
          return sendJson(response, 409, { error: '该工程评估已由其他执行实例持有', code: 'EVALUATION_LEASE_HELD', activeRunId: activeRun?.id || null, lease: await repository.getLease(leaseKey) });
        }
        runs.set(run.id, run); await persistRun(run);
        await emitRunEvent(run.id, 'EVALUATION_STARTED', { totalCases: evaluationSuite.dataset.totalCount });
        scheduleManagedRun(run, lease);
        return sendJson(response, 202, run);
      }
      if (parts[1] === 'evaluation-runs' && parts[2]) {
        const runId = parts[2];
        const persistedRun = (await repository.loadMap('evaluation-runs')).get(runId);
        if (persistedRun) runs.set(runId, persistedRun);
        const run = persistedRun || runs.get(runId);
        if (!run) return sendJson(response, 404, { error: 'EvaluationRun 不存在' });
        if (request.method === 'GET' && parts.length === 3) return sendJson(response, 200, run);
        if (request.method === 'GET' && parts[3] === 'events') {
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const allEvents = await repository.loadEvents(runId); const lastEventId = request.headers['last-event-id']; const lastIndex = lastEventId ? allEvents.findIndex((event) => event.eventId === lastEventId) : -1;
          for (const event of allEvents.slice(lastIndex + 1)) response.write(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (run.status === EvaluationRunStatus.completed) return response.end();
          const heartbeat = setInterval(() => { const event = { type: 'HEARTBEAT', runId, occurredAt: new Date().toISOString(), payload: { status: runs.get(runId)?.status } }; response.write(`event: HEARTBEAT\ndata: ${JSON.stringify(event)}\n\n`); }, heartbeatIntervalMs);
          let unsubscribe = async () => {}; let closed = false;
          const cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); void unsubscribe(); };
          const listener = (event) => { if (closed) return; response.write(`id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); if (event.type === 'EVALUATION_COMPLETED') { cleanup(); response.end(); } };
          unsubscribe = await repository.subscribeEvents(runId, allEvents.at(-1)?.sequence || 0, listener, { pollIntervalMs: eventPollIntervalMs });
          request.on('close', cleanup); return;
        }
      }
      if (request.method === 'POST' && parts[1] === 'evaluation-datasets' && parts[3] === 'regression-cases') {
        const body = await readBody(request); if (!body.caseId) return sendJson(response, 400, { error: 'caseId 必填' });
        regressions.add(body.caseId); await repository.addSetMember('regression-cases', body.caseId);
        return sendJson(response, 201, { caseId: body.caseId, added: true, regressionCount: regressions.size });
      }
      if (request.method === 'GET' && url.pathname === '/api/review-tasks') {
        const persistedTasks = await repository.loadMap('review-tasks');
        for (const [taskId, task] of persistedTasks) reviewTasks.set(taskId, task);
        const projectId = url.searchParams.get('projectId'); const runId = url.searchParams.get('runId'); const status = url.searchParams.get('status');
        const items = [...persistedTasks.values()].filter((task) => (!projectId || task.projectId === projectId) && (!runId || task.runId === runId) && (!status || task.status === status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
        return sendJson(response, 200, { items, total: items.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/review-tasks') {
        const actor = readActor(request);
        try { assertReviewActor(actor, [ReviewRoles.admin, ReviewRoles.system]); }
        catch (error) { return sendJson(response, 403, { error: error.message }); }
        const body = await readBody(request); const persistedRun = (await repository.loadMap('evaluation-runs')).get(body.runId);
        if (!persistedRun) return sendJson(response, 404, { error: 'EvaluationRun 不存在' });
        const task = createReviewTask({ ...body, projectId: body.projectId || persistedRun.projectId }, `review_${randomUUID()}`);
        reviewTasks.set(task.id, task); await persistReviewTask(task);
        await appendAudit({ actor, action: 'REVIEW_TASK_CREATED', entityType: 'ReviewTask', entityId: task.id, details: { runId: task.runId, caseId: task.caseId } });
        await emitRunEvent(task.runId, 'REVIEW_TASK_CREATED', { taskId: task.id, caseId: task.caseId });
        return sendJson(response, 201, task);
      }
      if (parts[1] === 'review-tasks' && parts[2] && request.method === 'POST' && parts[3] === 'claim') {
        const actor = readActor(request);
        try { assertReviewActor(actor); }
        catch (error) { return sendJson(response, 403, { error: error.message }); }
        const task = (await repository.loadMap('review-tasks')).get(parts[2]);
        if (!task) return sendJson(response, 404, { error: 'ReviewTask 不存在' });
        if (task.status === ReviewTaskStatus.submitted) return sendJson(response, 409, { error: 'ReviewTask 已提交' });
        const lease = await repository.acquireLease(`review:${task.id}`, actor.id, 15 * 60 * 1000);
        if (!lease) return sendJson(response, 409, { error: 'ReviewTask 已被其他复核人领取', code: 'REVIEW_LEASE_HELD', lease: await repository.getLease(`review:${task.id}`) });
        const claimed = claimReviewTask(task, actor, lease); reviewTasks.set(task.id, claimed); await persistReviewTask(claimed);
        await appendAudit({ actor, action: 'REVIEW_TASK_CLAIMED', entityType: 'ReviewTask', entityId: task.id, details: { expiresAt: lease.expiresAt } });
        await emitRunEvent(task.runId, 'REVIEW_TASK_CLAIMED', { taskId: task.id, assigneeId: actor.id });
        return sendJson(response, 200, { task: claimed, claimToken: lease.token });
      }
      if (parts[1] === 'review-tasks' && parts[2] && request.method === 'POST' && parts[3] === 'decision') {
        const actor = readActor(request);
        try { assertReviewActor(actor); }
        catch (error) { return sendJson(response, 403, { error: error.message }); }
        const task = (await repository.loadMap('review-tasks')).get(parts[2]);
        if (!task) return sendJson(response, 404, { error: 'ReviewTask 不存在' });
        const token = request.headers['x-review-claim-token']; const lease = await repository.getLease(`review:${task.id}`);
        if (!token || !lease || lease.ownerId !== actor.id || lease.token !== token || new Date(lease.expiresAt).getTime() <= Date.now()) return sendJson(response, 409, { error: '复核领取凭证无效或已过期', code: 'REVIEW_CLAIM_INVALID' });
        const body = await readBody(request);
        const currentArtifacts = await repository.loadMap('artifacts');
        const invalidEvidence = (body.evidenceArtifactIds || []).filter((id) => !currentArtifacts.has(id) || currentArtifacts.get(id).projectId !== task.projectId);
        if (invalidEvidence.length) return sendJson(response, 400, { error: `证据 Artifact 无效: ${invalidEvidence.join(', ')}` });
        let submitted;
        try { submitted = submitReviewDecision(task, actor, body); }
        catch (error) { return sendJson(response, 400, { error: error.message }); }
        reviewTasks.set(task.id, submitted); await persistReviewTask(submitted);
        await repository.releaseLease(`review:${task.id}`, actor.id, token);
        await appendAudit({ actor, action: 'REVIEW_DECISION_SUBMITTED', entityType: 'ReviewTask', entityId: task.id, details: { verdict: submitted.verdict, evidenceArtifactIds: submitted.evidenceArtifactIds } });
        const persistedTasks = await repository.loadMap('review-tasks');
        const pendingReviews = [...persistedTasks.values()].filter((item) => item.runId === task.runId && item.status !== ReviewTaskStatus.submitted).length;
        const persistedRuns = await repository.loadMap('evaluation-runs'); const run = persistedRuns.get(task.runId);
        let gateDecision = null;
        if (run?.status === EvaluationRunStatus.completed) {
          const result = { ...run.result, pendingReviews }; const gate = decideGate(result, evaluationSuite.gatePolicy);
          const previousDecision = run.result.gateDecision;
          gateDecision = { id: `gate_${randomUUID()}`, projectId: run.projectId, stageId: 'storyboard-finalization', runId: run.id, policyVersion: evaluationSuite.gatePolicy.version, score: result.summary.score, passed: result.summary.passed, total: result.summary.total, ...gate, supersedesDecisionId: previousDecision?.id || null, decidedAt: new Date().toISOString() };
          gateDecisions.set(gateDecision.id, gateDecision); await persistGateDecision(gateDecision);
          const updatedRun = { ...run, result: { ...result, gate, gateDecision } }; runs.set(run.id, updatedRun); await persistRun(updatedRun);
        }
        await emitRunEvent(task.runId, 'REVIEW_DECISION_SUBMITTED', { taskId: task.id, verdict: submitted.verdict, pendingReviews, gate: gateDecision });
        return sendJson(response, 200, { task: submitted, pendingReviews, gateDecision });
      }
      if (request.method === 'GET' && url.pathname === '/api/audit-events') {
        const actor = readActor(request);
        try { assertReviewActor(actor, [ReviewRoles.admin]); }
        catch (error) { return sendJson(response, 403, { error: error.message }); }
        const persistedAudit = await repository.loadMap('audit-events'); const entityType = url.searchParams.get('entityType'); const entityId = url.searchParams.get('entityId');
        const items = [...persistedAudit.values()].filter((event) => (!entityType || event.entityType === entityType) && (!entityId || event.entityId === entityId)).sort((a,b)=>new Date(b.occurredAt)-new Date(a.occurredAt));
        return sendJson(response, 200, { items, total: items.length });
      }
      if (request.method === 'POST' && url.pathname === '/api/gate-decisions') {
        const body = await readBody(request); const run = runs.get(body.runId);
        if (!run) return sendJson(response, 404, { error: 'EvaluationRun 不存在' });
        if (run.status !== EvaluationRunStatus.completed) return sendJson(response, 409, { error: 'EvaluationRun 尚未完成' });
        const existing = [...gateDecisions.values()].find((decision)=>decision.runId===run.id);
        if (existing) return sendJson(response, 200, existing);
        const decision = { id: `gate_${randomUUID()}`, projectId: run.projectId, stageId: 'storyboard-finalization', runId: run.id, policyVersion: evaluationSuite.gatePolicy.version, ...run.result.gate, decidedAt: new Date().toISOString() };
        gateDecisions.set(decision.id, decision); await persistGateDecision(decision); return sendJson(response, 201, decision);
      }
      if (request.method === 'GET' && url.pathname === '/api/gate-decisions') {
        const projectId = url.searchParams.get('projectId');
        const items = [...gateDecisions.values()].filter((decision)=>!projectId||decision.projectId===projectId).sort((a,b)=>new Date(b.decidedAt)-new Date(a.decidedAt));
        return sendJson(response, 200, { items, total: items.length });
      }
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) { sendJson(response, 500, { error: error.message }); }
  });

  server.on('close', async () => {
    for (const timer of scheduledTimers) { clearTimeout(timer); clearInterval(timer); }
    for (const timer of runnerTimers) { clearTimeout(timer); clearInterval(timer); }
    for (const lease of activeLeases.values()) await repository.releaseLease(lease.leaseKey, lease.ownerId, lease.token);
    await repository.close();
  });
  return { server, completeRun, repository, paths: { databasePath, artifactFilesDir, nodeRunRoot, legacy: { runsPath, regressionsPath, eventsPath, artifactsPath, gateDecisionsPath } } };
}
