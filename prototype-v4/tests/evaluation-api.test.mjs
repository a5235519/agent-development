import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentWorkbenchServer } from '../server/agent-workbench-server.mjs';

async function startApi(dataDir, options = {}) {
  dataDir ||= await mkdtemp(join(tmpdir(), 'agent-workbench-api-'));
  const app = await createAgentWorkbenchServer({ dataDir, evaluationDelayMs: 20, nodeRunStepDelayMs: 4, heartbeatIntervalMs: 4, eventPollIntervalMs: 4, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return { ...app, dataDir, baseUrl: `http://127.0.0.1:${address.port}` };
}

const nodeRunInput = (overrides = {}) => ({ projectId: 'EP01', pluginId: 'storyboard-draft', pluginVersion: '1.4.0', operation: 'generate_storyboard_drafts', mode: 'repair', shotId: 'S13', inputArtifactIds: [], ...overrides });
async function seedNodeRunInputs(baseUrl){const values=[['script.final',null,'script.md'],['image.reference',null,'reference.png'],['storyboard.draft','S12','S12.png'],['storyboard.draft','S14','S14.png']];const items=[];for(const [role,shotId,filename] of values){items.push(await fetch(`${baseUrl}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:'EP01',role,shotId,filename,mediaType:role==='script.final'?'text/markdown':'image/png',contentBase64:Buffer.from(filename).toString('base64'),producerRunId:'seed_preflight',sourceArtifactIds:[]})}).then(result=>result.json()))}return items.map(item=>item.id)}

test('queues a whitelisted NodeRun, streams progress and persists a receipt', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const inputArtifactIds=await seedNodeRunInputs(api.baseUrl);const response = await fetch(`${api.baseUrl}/api/node-runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': 'editor-1', 'x-actor-role': 'admin' }, body: JSON.stringify(nodeRunInput({inputArtifactIds})) });
  assert.equal(response.status, 202); const created = await response.json(); assert.equal(created.status, 'QUEUED');
  const events = await fetch(`${api.baseUrl}/api/node-runs/${created.id}/events`).then((result) => result.text());
  assert.match(events, /NODE_RUN_STARTED/); assert.match(events, /NODE_RUN_PROGRESS/); assert.match(events, /NODE_RUN_COMPLETED/);
  const completed = await fetch(`${api.baseUrl}/api/node-runs/${created.id}`).then((result) => result.json());
  assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.executionAdapter, 'contract-dry-run'); assert.equal(completed.output.validatorResults[0].verdict, 'NEEDS_CODEX_ADAPTER');
  const receipt = await fetch(`${api.baseUrl}/api/node-runs/${created.id}/receipt`).then((result) => result.json());
  assert.equal(receipt.actualSkillRoute, 'skills.storyboard.generate_drafts'); assert.deepEqual(receipt.outputArtifactIds, []);
  const runners = await fetch(`${api.baseUrl}/api/runners`).then((result) => result.json()); assert.equal(runners.items[0].adapter, 'contract-dry-run');
});

test('rejects browser command injection and supports cancellation plus one retry', async (t) => {
  const api = await startApi(undefined, { nodeRunStepDelayMs: 25 }); t.after(() => api.server.close());
  const headers = { 'content-type': 'application/json', 'x-actor-id': 'editor-1', 'x-actor-role': 'admin' };
  const rejected = await fetch(`${api.baseUrl}/api/node-runs`, { method: 'POST', headers, body: JSON.stringify(nodeRunInput({ command: 'rm -rf /' })) }); assert.equal(rejected.status, 400);
  const inputArtifactIds=await seedNodeRunInputs(api.baseUrl);const created = await fetch(`${api.baseUrl}/api/node-runs`, { method: 'POST', headers, body: JSON.stringify(nodeRunInput({inputArtifactIds})) }).then((result) => result.json());
  await fetch(`${api.baseUrl}/api/node-runs/${created.id}/cancel`, { method: 'POST', headers, body: '{}' });
  const cancelledEvents = await fetch(`${api.baseUrl}/api/node-runs/${created.id}/events`).then((result) => result.text()); assert.match(cancelledEvents, /NODE_RUN_CANCELLED/);
  const retriedResponse = await fetch(`${api.baseUrl}/api/node-runs/${created.id}/retry`, { method: 'POST', headers, body: '{}' }); assert.equal(retriedResponse.status, 202); const retried = await retriedResponse.json(); assert.equal(retried.attempt, 2); assert.equal(retried.parentRunId, created.id);
  await fetch(`${api.baseUrl}/api/node-runs/${retried.id}/events`).then((result) => result.text());
  const secondRetry = await fetch(`${api.baseUrl}/api/node-runs/${retried.id}/retry`, { method: 'POST', headers, body: '{}' }); assert.equal(secondRetry.status, 409);
});

test('fails a NodeRun when its contract timeout expires', async (t) => {
  const api = await startApi(undefined, { nodeRunStepDelayMs: 12, nodeRunTimeoutMs: 3 }); t.after(() => api.server.close());
  const inputArtifactIds=await seedNodeRunInputs(api.baseUrl);const created = await fetch(`${api.baseUrl}/api/node-runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': 'system', 'x-actor-role': 'system' }, body: JSON.stringify(nodeRunInput({inputArtifactIds})) }).then((result) => result.json());
  const events = await fetch(`${api.baseUrl}/api/node-runs/${created.id}/events`).then((result) => result.text()); assert.match(events, /NODE_RUN_FAILED/); assert.match(events, /NODE_RUN_TIMEOUT/);
});

test('bridges a NodeRun to Codex Gateway and commits only validated Artifact output', async (t) => {
  let runId; const gateway={health:async()=>({ok:true}),startTask:async({cwd,prompt})=>{assert.match(prompt,/固定 Operation：generate_storyboard_drafts/);runId=JSON.parse(await readFile(join(cwd,'execution-envelope.json'),'utf8')).nodeRunId;await writeFile(join(cwd,'staging','S13-draft.png'),'codex-image');await writeFile(join(cwd,'staging','node-result.json'),JSON.stringify({schemaVersion:1,nodeRunId:runId,status:'completed',summary:'generated',outputs:[{path:'S13-draft.png',role:'storyboard.draft',mediaType:'image/png',shotId:'S13',sourceArtifactIds:[]}],warnings:[]}));return {id:'task_remote_1',status:'running',threadId:'thread_1',activeTurnId:'turn_1'}},waitForTask:async(id,{onEvent})=>{await onEvent({eventId:'event_remote_1',seq:1,type:'turn.started',threadId:'thread_1',turnId:'turn_1',payload:{}});await onEvent({eventId:'event_remote_2',seq:2,type:'turn.completed',threadId:'thread_1',turnId:'turn_1',payload:{}});return {id,status:'completed',threadId:'thread_1'}}};
  const api=await startApi(undefined,{codexGatewayClient:gateway});t.after(()=>api.server.close());const headers={'content-type':'application/json','x-actor-id':'editor-1','x-actor-role':'admin'};const inputArtifactIds=await seedNodeRunInputs(api.baseUrl);const created=await fetch(`${api.baseUrl}/api/node-runs`,{method:'POST',headers,body:JSON.stringify(nodeRunInput({inputArtifactIds}))}).then(result=>result.json());const events=await fetch(`${api.baseUrl}/api/node-runs/${created.id}/events`).then(result=>result.text());assert.match(events,/CODEX_EVENT/);assert.match(events,/NODE_RUN_COMPLETED/);const completed=await fetch(`${api.baseUrl}/api/node-runs/${created.id}`).then(result=>result.json());assert.equal(completed.executionAdapter,'remote-codex-app-server');assert.equal(completed.output.outputArtifactIds.length,1);const artifact=await fetch(`${api.baseUrl}/api/artifacts/${completed.output.outputArtifactIds[0]}`).then(result=>result.json());assert.equal(artifact.producerRunId,created.id);assert.equal(artifact.shotId,'S13');const receipt=await fetch(`${api.baseUrl}/api/node-runs/${created.id}/receipt`).then(result=>result.json());assert.equal(receipt.codexBinding.taskId,'task_remote_1');assert.equal(receipt.validatorResults[2].verdict,'PASS');
});

test('blocks an incomplete NodeRun before any Runner or Codex task is created',async(t)=>{const api=await startApi();t.after(()=>api.server.close());const response=await fetch(`${api.baseUrl}/api/node-runs`,{method:'POST',headers:{'content-type':'application/json','x-actor-id':'editor-1','x-actor-role':'admin'},body:JSON.stringify(nodeRunInput())});assert.equal(response.status,422);const body=await response.json();assert.equal(body.code,'NODE_RUN_PREFLIGHT_FAILED');assert.deepEqual(body.missing,['script.final','image.reference','storyboard.draft:S12','storyboard.draft:S14'])});

test('creates, persists and completes an evaluation run', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const createResponse = await fetch(`${api.baseUrl}/api/evaluation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'test-run-1' }, body: JSON.stringify({ suiteId: 'EP01-quality-v1' }),
  });
  assert.equal(createResponse.status, 202);
  const created = await createResponse.json();
  assert.equal(created.status, 'RUNNING');
  const runningList = await fetch(`${api.baseUrl}/api/evaluation-runs?projectId=EP01&status=RUNNING`).then((response) => response.json());
  assert.equal(runningList.items[0].id, created.id);

  const eventResponse = await fetch(`${api.baseUrl}/api/evaluation-runs/${created.id}/events`);
  const eventText = await eventResponse.text();
  assert.match(eventText, /EVALUATION_STARTED/);
  assert.match(eventText, /HEARTBEAT/);
  assert.match(eventText, /EVALUATION_COMPLETED/);
  const eventIds = [...eventText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]);
  const resumedEvents = await fetch(`${api.baseUrl}/api/evaluation-runs/${created.id}/events`, { headers: { 'Last-Event-ID': eventIds[0] } }).then((response) => response.text());
  assert.doesNotMatch(resumedEvents, /EVALUATION_STARTED/);
  assert.match(resumedEvents, /EVALUATION_COMPLETED/);

  const completed = await fetch(`${api.baseUrl}/api/evaluation-runs/${created.id}`).then((response) => response.json());
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.result.gate.verdict, 'BLOCKED');
  assert.equal(completed.result.deterministicResults[0].score, 0);
  const gateDecisions = await fetch(`${api.baseUrl}/api/gate-decisions?projectId=EP01`).then((response) => response.json());
  assert.equal(gateDecisions.items[0].runId, created.id);
  assert.equal(gateDecisions.items[0].verdict, 'BLOCKED');
  const stored = await api.repository.loadMap('evaluation-runs');
  assert.equal(stored.get(created.id).result.summary.passed, 3);
});

test('stores hashed artifacts and blocks deterministic evaluation when S13 is missing', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const createArtifact = (shotId) => fetch(`${api.baseUrl}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'EP01', role: 'storyboard.draft', shotId, filename: `${shotId}.png`, mediaType: 'image/png', contentBase64: Buffer.from(`image-${shotId}`).toString('base64'), producerRunId: 'run_storyboard_1', sourceArtifactIds: [] }),
  }).then((response) => response.json());
  const s12 = await createArtifact('S12'); const s14 = await createArtifact('S14');
  assert.match(s12.sha256, /^[a-f0-9]{64}$/);
  const content = await fetch(`${api.baseUrl}${s14.uri}`).then((response) => response.text());
  assert.equal(content, 'image-S14');

  const evaluation = await fetch(`${api.baseUrl}/api/evaluator-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'EP01', expectedShotIds: ['S12', 'S13', 'S14'] }),
  }).then((response) => response.json());
  assert.equal(evaluation.verdict, 'BLOCKED');
  assert.deepEqual(evaluation.results[0].missingShotIds, ['S13']);
  assert.equal(evaluation.results[1].verdict, 'PASS');
});

test('creates replacement versions and persists active artifact switching', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const create = (body) => fetch(`${api.baseUrl}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((response) => response.json());
  const first = await create({ projectId: 'EP01', role: 'storyboard.draft', shotId: 'S12', filename: 'S12-v1.png', mediaType: 'image/png', contentBase64: Buffer.from('v1').toString('base64'), producerRunId: 'run_1', sourceArtifactIds: [] });
  const downstream = await create({ projectId: 'EP01', role: 'storyboard.final', shotId: 'S12', filename: 'S12-final.png', mediaType: 'image/png', contentBase64: Buffer.from('final').toString('base64'), producerRunId: 'run_final', sourceArtifactIds: [first.id] });
  const replacement = await create({ projectId: 'EP01', role: 'storyboard.draft', shotId: 'S12', filename: 'S12-v2.png', mediaType: 'image/png', contentBase64: Buffer.from('v2').toString('base64'), producerRunId: 'run_2', sourceArtifactIds: [first.id], versionGroupId: first.id });
  let listed = await fetch(`${api.baseUrl}/api/artifacts?projectId=EP01&shotId=S12`).then((response) => response.json());
  assert.equal(listed.items.find((item) => item.id === first.id).isActive, false);
  assert.equal(listed.items.find((item) => item.id === replacement.id).isActive, true);
  assert.equal(listed.items.find((item) => item.id === downstream.id).stale, true);
  const activated = await fetch(`${api.baseUrl}/api/artifacts/${first.id}/activate`, { method: 'PATCH' }).then((response) => response.json());
  assert.equal(activated.isActive, true);
  listed = await fetch(`${api.baseUrl}/api/artifacts?projectId=EP01&shotId=S12`).then((response) => response.json());
  assert.equal(listed.items.find((item) => item.id === replacement.id).isActive, false);
});

test('honors idempotency and persists regression cases', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const request = () => fetch(`${api.baseUrl}/api/evaluation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'same-command' }, body: '{}',
  }).then((response) => response.json());
  const first = await request(); const second = await request();
  assert.equal(first.id, second.id);

  const regression = await fetch(`${api.baseUrl}/api/evaluation-datasets/EP01-golden/regression-cases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'CASE-099' }),
  }).then((response) => response.json());
  assert.equal(regression.added, true);
  assert.equal(regression.regressionCount, 4);
});

test('server lease blocks concurrent evaluation creation with different idempotency keys', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const create = (key) => fetch(`${api.baseUrl}/api/evaluation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: '{}',
  });
  const first = await create('lease-run-a');
  const second = await create('lease-run-b');
  assert.equal(first.status, 202);
  assert.equal(second.status, 409);
  const conflict = await second.json();
  assert.equal(conflict.code, 'EVALUATION_LEASE_HELD');
  assert.match(conflict.activeRunId, /^eval_/);
  await fetch(`${api.baseUrl}/api/evaluation-runs/${conflict.activeRunId}/events`).then((response) => response.text());
});

test('shared SQLite lease blocks duplicate runs across two API instances', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agent-workbench-multi-instance-'));
  const firstApi = await startApi(dataDir);
  const secondApi = await startApi(dataDir);
  try {
    const first = await fetch(`${firstApi.baseUrl}/api/evaluation-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'instance-a' }, body: '{}',
    });
    const second = await fetch(`${secondApi.baseUrl}/api/evaluation-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'instance-b' }, body: '{}',
    });
    assert.equal(first.status, 202);
    assert.equal(second.status, 409);
    const run = await first.json();
    const crossInstanceEvents = await fetch(`${secondApi.baseUrl}/api/evaluation-runs/${run.id}/events`).then((response) => response.text());
    assert.match(crossInstanceEvents, /EVALUATION_STARTED/);
    assert.match(crossInstanceEvents, /EVALUATION_COMPLETED/);
    const events = await firstApi.repository.loadEvents(run.id);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  } finally {
    await new Promise((resolve) => firstApi.server.close(resolve));
    await new Promise((resolve) => secondApi.server.close(resolve));
  }
});

test('persists human review claim, evidence, decision, gate revision and audit trail', async (t) => {
  const api = await startApi(); t.after(() => api.server.close());
  const artifact = await fetch(`${api.baseUrl}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'EP01', role: 'evaluation.evidence', shotId: 'S13', filename: 'S13-evidence.png', mediaType: 'image/png', contentBase64: Buffer.from('review-evidence').toString('base64'), producerRunId: 'evaluator-1', sourceArtifactIds: [] }),
  }).then((response) => response.json());
  const run = await fetch(`${api.baseUrl}/api/evaluation-runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'review-run' }, body: '{}' }).then((response) => response.json());
  await fetch(`${api.baseUrl}/api/evaluation-runs/${run.id}/events`).then((response) => response.text());
  const tasks = await fetch(`${api.baseUrl}/api/review-tasks?runId=${run.id}`).then((response) => response.json());
  assert.equal(tasks.total, 2);
  const task = tasks.items.find((item) => item.caseId === 'CASE-013');
  assert.deepEqual(task.evidenceArtifactIds, [artifact.id]);

  const forbidden = await fetch(`${api.baseUrl}/api/review-tasks/${task.id}/claim`, { method: 'POST', headers: { 'x-actor-id': 'viewer-1', 'x-actor-role': 'viewer' } });
  assert.equal(forbidden.status, 403);
  const claimedResponse = await fetch(`${api.baseUrl}/api/review-tasks/${task.id}/claim`, { method: 'POST', headers: { 'x-actor-id': 'reviewer-1', 'x-actor-role': 'reviewer' } });
  assert.equal(claimedResponse.status, 200);
  const claimed = await claimedResponse.json();
  const conflict = await fetch(`${api.baseUrl}/api/review-tasks/${task.id}/claim`, { method: 'POST', headers: { 'x-actor-id': 'reviewer-2', 'x-actor-role': 'reviewer' } });
  assert.equal(conflict.status, 409);
  const decisionResponse = await fetch(`${api.baseUrl}/api/review-tasks/${task.id}/decision`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-actor-id': 'reviewer-1', 'x-actor-role': 'reviewer', 'x-review-claim-token': claimed.claimToken }, body: JSON.stringify({ verdict: 'NEEDS_CHANGES', comment: 'S13 构图需要重新生成', evidenceArtifactIds: [artifact.id] }),
  });
  assert.equal(decisionResponse.status, 200);
  const decision = await decisionResponse.json();
  assert.equal(decision.task.status, 'SUBMITTED');
  assert.equal(decision.pendingReviews, 1);
  assert.equal(decision.gateDecision.supersedesDecisionId != null, true);
  const audit = await fetch(`${api.baseUrl}/api/audit-events?entityType=ReviewTask&entityId=${task.id}`, { headers: { 'x-actor-id': 'admin-1', 'x-actor-role': 'admin' } }).then((response) => response.json());
  assert.deepEqual(new Set(audit.items.map((item) => item.action)), new Set(['REVIEW_TASK_CREATED', 'REVIEW_TASK_CLAIMED', 'REVIEW_DECISION_SUBMITTED']));
});

test('restores runs, artifacts, gates and regression cases after a SQLite service restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'agent-workbench-restart-'));
  const first = await startApi(dataDir);
  const artifact = await fetch(`${first.baseUrl}/api/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'EP01', role: 'storyboard.draft', shotId: 'S13', filename: 'S13.png', mediaType: 'image/png', contentBase64: Buffer.from('persistent-image').toString('base64'), producerRunId: 'run_restart', sourceArtifactIds: [] }),
  }).then((response) => response.json());
  const created = await fetch(`${first.baseUrl}/api/evaluation-runs`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'restart-run' }, body: '{}',
  }).then((response) => response.json());
  await fetch(`${first.baseUrl}/api/evaluation-runs/${created.id}/events`).then((response) => response.text());
  await fetch(`${first.baseUrl}/api/evaluation-datasets/EP01-golden/regression-cases`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseId: 'CASE-RESTART' }),
  });
  await new Promise((resolve) => first.server.close(resolve));

  const second = await startApi(dataDir);
  try {
    const restoredRun = await fetch(`${second.baseUrl}/api/evaluation-runs/${created.id}`).then((response) => response.json());
    const restoredArtifacts = await fetch(`${second.baseUrl}/api/artifacts?projectId=EP01`).then((response) => response.json());
    const restoredGates = await fetch(`${second.baseUrl}/api/gate-decisions?projectId=EP01`).then((response) => response.json());
    const restoredReviews = await fetch(`${second.baseUrl}/api/review-tasks?runId=${created.id}`).then((response) => response.json());
    assert.equal(restoredRun.status, 'COMPLETED');
    assert.equal(restoredArtifacts.items.some((item) => item.id === artifact.id), true);
    assert.equal(restoredGates.items.some((item) => item.runId === created.id), true);
    assert.equal(restoredReviews.total, 2);
    assert.equal((await second.repository.loadSet('regression-cases')).has('CASE-RESTART'), true);
    assert.equal(second.paths.databasePath.endsWith('agent-workbench.sqlite'), true);
  } finally {
    await new Promise((resolve) => second.server.close(resolve));
  }
});
