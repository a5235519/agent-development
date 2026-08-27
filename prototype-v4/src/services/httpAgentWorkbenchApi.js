const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class HttpAgentWorkbenchApi {
  constructor(baseUrl = '/api') { this.baseUrl = baseUrl; }

  async request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  getEvaluationSuite(id = 'EP01-quality-v1') { return this.request(`/evaluation-suites/${id}`); }

  getPluginContract() { return this.request('/plugin-contracts/storyboard-draft'); }

  createNodeRun({ mode = 'full', shotId, inputArtifactIds = [] } = {}) {
    return this.request('/node-runs', { method: 'POST', headers: { 'x-actor-id': 'editor-demo', 'x-actor-role': 'admin' }, body: JSON.stringify({ projectId: 'EP01', pluginId: 'storyboard-draft', pluginVersion: '1.4.0', operation: 'generate_storyboard_drafts', mode, shotId, inputArtifactIds }) });
  }

  getNodeRun(runId) { return this.request(`/node-runs/${runId}`); }

  listNodeRuns(filters = {}) { const query = new URLSearchParams(Object.entries(filters).filter(([,value])=>value!=null)); return this.request(`/node-runs?${query}`); }

  cancelNodeRun(runId) { return this.request(`/node-runs/${runId}/cancel`, { method: 'POST', headers: { 'x-actor-id': 'editor-demo', 'x-actor-role': 'admin' }, body: '{}' }); }

  retryNodeRun(runId) { return this.request(`/node-runs/${runId}/retry`, { method: 'POST', headers: { 'x-actor-id': 'editor-demo', 'x-actor-role': 'admin' }, body: '{}' }); }

  getNodeRunReceipt(runId) { return this.request(`/node-runs/${runId}/receipt`); }

  listRunners() { return this.request('/runners'); }

  waitForNodeRunEvents(runId, onEvent) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(`${this.baseUrl}/node-runs/${runId}/events`);
      const handle = (event) => {
        const message = JSON.parse(event.data); onEvent?.(message);
        if (message.type === 'NODE_RUN_COMPLETED') { source.close(); this.getNodeRun(runId).then(resolve, reject); }
        if (message.type === 'NODE_RUN_FAILED') { source.close(); this.getNodeRun(runId).then(resolve, reject); }
        if (message.type === 'NODE_RUN_CANCELLED') { source.close(); this.getNodeRun(runId).then(resolve, reject); }
      };
      ['NODE_RUN_QUEUED','NODE_RUN_STARTED','NODE_RUN_PROGRESS','NODE_RUN_CANCEL_REQUESTED','NODE_RUN_COMPLETED','NODE_RUN_FAILED','NODE_RUN_CANCELLED','CODEX_EVENT','HEARTBEAT'].forEach((type)=>source.addEventListener(type,handle));
      source.onerror = () => { if (source.readyState === EventSource.CLOSED) reject(new Error('NodeRun 事件流已关闭')); };
    });
  }

  createEvaluationRun(suiteId = 'EP01-quality-v1') {
    return this.request('/evaluation-runs', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ suiteId }) });
  }

  async waitForEvaluation(runId) {
    for (;;) {
      const run = await this.getEvaluationRun(runId);
      if (run.status === 'COMPLETED') return run;
      if (run.status === 'FAILED') throw new Error(run.error || 'EvaluationRun 失败');
      await wait(250);
    }
  }

  getEvaluationRun(runId) { return this.request(`/evaluation-runs/${runId}`); }

  listEvaluationRuns(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([,value])=>value!=null));
    return this.request(`/evaluation-runs?${query}`);
  }

  waitForEvaluationEvents(runId, onEvent) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(`${this.baseUrl}/evaluation-runs/${runId}/events`);
      const handle = (event) => {
        const message = JSON.parse(event.data); onEvent?.(message);
        if (message.type === 'EVALUATION_COMPLETED') { source.close(); this.getEvaluationRun(runId).then(resolve, reject); }
        if (message.type === 'EVALUATION_FAILED') { source.close(); reject(new Error(message.payload?.message || 'EvaluationRun 失败')); }
      };
      source.addEventListener('EVALUATION_STARTED', handle);
      source.addEventListener('EVALUATION_COMPLETED', handle);
      source.addEventListener('EVALUATION_FAILED', handle);
      source.addEventListener('HEARTBEAT', handle);
      source.onerror = () => { if (source.readyState === EventSource.CLOSED) reject(new Error('评估事件流已关闭')); };
    });
  }

  addRegressionCase(caseId, datasetId = 'EP01-golden') {
    return this.request(`/evaluation-datasets/${datasetId}/regression-cases`, { method: 'POST', body: JSON.stringify({ caseId }) });
  }

  createArtifact(input) {
    return this.request('/artifacts', { method: 'POST', body: JSON.stringify(input) });
  }

  listArtifacts(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value != null));
    return this.request(`/artifacts?${query}`);
  }

  activateArtifact(artifactId) {
    return this.request(`/artifacts/${artifactId}/activate`, { method: 'PATCH' });
  }

  listGateDecisions(projectId) {
    const query = new URLSearchParams(projectId ? { projectId } : {});
    return this.request(`/gate-decisions?${query}`);
  }

  listReviewTasks(filters = {}) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value != null));
    return this.request(`/review-tasks?${query}`);
  }

  claimReviewTask(taskId, actor = { id: 'reviewer-demo', role: 'reviewer' }) {
    return this.request(`/review-tasks/${taskId}/claim`, { method: 'POST', headers: { 'x-actor-id': actor.id, 'x-actor-role': actor.role }, body: '{}' });
  }

  submitReviewDecision(taskId, claimToken, input, actor = { id: 'reviewer-demo', role: 'reviewer' }) {
    return this.request(`/review-tasks/${taskId}/decision`, { method: 'POST', headers: { 'x-actor-id': actor.id, 'x-actor-role': actor.role, 'x-review-claim-token': claimToken }, body: JSON.stringify(input) });
  }

  listAuditEvents(filters = {}, actor = { id: 'admin-demo', role: 'admin' }) {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value != null));
    return this.request(`/audit-events?${query}`, { headers: { 'x-actor-id': actor.id, 'x-actor-role': actor.role } });
  }

  runDeterministicEvaluators(projectId, expectedShotIds) {
    return this.request('/evaluator-runs', { method: 'POST', body: JSON.stringify({ projectId, expectedShotIds }) });
  }
}

export const httpAgentWorkbenchApi = new HttpAgentWorkbenchApi();
