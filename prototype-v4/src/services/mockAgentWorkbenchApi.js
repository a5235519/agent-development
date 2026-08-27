import { completedEvaluationResult, evaluationSuite } from '../data/evaluationSuite.js';
import { createEvaluationRun, decideGate, EvaluationRunStatus } from '../domain/evaluation.js';
import { evaluateArtifactProvenance, evaluateShotCoverage } from '../domain/artifacts.js';
import { createNodeRun, createNodeRunReceipt, NodeRunStatus, storyboardDraftContract } from '../domain/nodeRun.js';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class MockAgentWorkbenchApi {
  #runs = new Map();
  #regressionCases = new Set(['CASE-006', 'CASE-011', 'CASE-013']);
  #artifacts = new Map();
  #gateDecisions = new Map();
  #reviewTasks = new Map();
  #reviewClaims = new Map();
  #nodeRuns = new Map();
  #nodeRunReceipts = new Map();

  async getPluginContract() { return structuredClone(storyboardDraftContract); }

  async createNodeRun({ mode = 'full', shotId, inputArtifactIds = [] } = {}) {
    const run = createNodeRun({ projectId: 'EP01', pluginId: storyboardDraftContract.id, pluginVersion: storyboardDraftContract.version, operation: storyboardDraftContract.operation, mode, shotId, inputArtifactIds }, `node_run_mock_${this.#nodeRuns.size + 1}`);
    this.#nodeRuns.set(run.id, run); return structuredClone(run);
  }

  async getNodeRun(runId) { const run=this.#nodeRuns.get(runId); return run?structuredClone(run):null; }

  async listNodeRuns(filters={}) { const items=[...this.#nodeRuns.values()].filter(run=>Object.entries(filters).every(([key,value])=>value==null||run[key]===value));return {items:structuredClone(items),total:items.length}; }

  async cancelNodeRun(runId) { const run=this.#nodeRuns.get(runId);if(!run)throw new Error('NodeRun 不存在');const updated={...run,cancelRequestedAt:new Date().toISOString()};this.#nodeRuns.set(runId,updated);return structuredClone(updated); }

  async retryNodeRun(runId) { const run=this.#nodeRuns.get(runId);if(!run||![NodeRunStatus.failed,NodeRunStatus.cancelled].includes(run.status))throw new Error('只有失败或已取消的 NodeRun 可以重试');const retried=createNodeRun({...run,attempt:run.attempt+1,parentRunId:run.id},`node_run_mock_${this.#nodeRuns.size+1}`);this.#nodeRuns.set(retried.id,retried);return structuredClone(retried); }

  async getNodeRunReceipt(runId) { const receipt=this.#nodeRunReceipts.get(`receipt_${runId}`);if(!receipt)throw new Error('NodeRun Receipt 尚未生成');return structuredClone(receipt); }

  async listRunners() { return {items:[{id:'runner-local-01',name:'Local Contract Runner',adapter:'contract-dry-run',status:'ONLINE',capabilities:[storyboardDraftContract.id],concurrency:1,lastHeartbeatAt:new Date().toISOString()}],total:1}; }

  async waitForNodeRunEvents(runId,onEvent,duration=900) {
    let run=this.#nodeRuns.get(runId);if(!run)throw new Error('NodeRun 不存在');onEvent?.({type:'NODE_RUN_QUEUED',runId,occurredAt:run.createdAt,payload:{mode:run.mode}});await wait(duration/6);
    run={...run,status:NodeRunStatus.running,runnerId:'runner-local-01',executionAdapter:'contract-dry-run',startedAt:new Date().toISOString(),progress:{current:1,total:6,step:'冻结输入快照'}};this.#nodeRuns.set(runId,run);onEvent?.({type:'NODE_RUN_STARTED',runId,occurredAt:run.startedAt,payload:{progress:run.progress}});
    for(let index=2;index<=6;index+=1){await wait(duration/6);run=this.#nodeRuns.get(runId);if(run.cancelRequestedAt){run={...run,status:NodeRunStatus.cancelled,cancelledAt:new Date().toISOString(),completedAt:new Date().toISOString(),progress:{current:index-1,total:6,step:'已取消'}};this.#nodeRuns.set(runId,run);onEvent?.({type:'NODE_RUN_CANCELLED',runId,occurredAt:run.completedAt,payload:{progress:run.progress}});return structuredClone(run)}run={...run,progress:{current:index,total:6,step:['','冻结输入快照','解析 Plugin Contract','解析实际 Skill 路由','执行受控生成适配器','运行输出 Validator','写入 NodeRun Receipt'][index]}};this.#nodeRuns.set(runId,run);onEvent?.({type:'NODE_RUN_PROGRESS',runId,occurredAt:new Date().toISOString(),payload:{progress:run.progress}})}
    run={...run,status:NodeRunStatus.completed,completedAt:new Date().toISOString(),output:{outputArtifactIds:[],validatorResults:[{id:'artifact-adapter',verdict:'NEEDS_CODEX_ADAPTER',detail:'控制面执行完成；尚未接入真实 Codex 产物适配器。'}]}};this.#nodeRuns.set(runId,run);const receipt=createNodeRunReceipt(run,run.output);this.#nodeRunReceipts.set(receipt.id,receipt);onEvent?.({type:'NODE_RUN_COMPLETED',runId,occurredAt:run.completedAt,payload:{receiptId:receipt.id,progress:run.progress}});return structuredClone(run);
  }

  #invalidateDescendants(rootArtifactIds, excludedIds = new Set()) {
    const queue = [...rootArtifactIds]; const visited = new Set(queue); const invalidatedArtifactIds = [];
    while (queue.length) {
      const sourceId = queue.shift();
      for (const [id,artifact] of this.#artifacts) {
        if (visited.has(id) || excludedIds.has(id) || !artifact.sourceArtifactIds?.includes(sourceId)) continue;
        visited.add(id); queue.push(id);
        if (artifact.isActive !== false) { this.#artifacts.set(id,{...artifact,stale:true,staleReason:'UPSTREAM_VERSION_CHANGED',invalidatedByArtifactId:sourceId,invalidatedAt:new Date().toISOString()}); invalidatedArtifactIds.push(id); }
      }
    }
    return invalidatedArtifactIds;
  }

  async getEvaluationSuite() {
    return structuredClone(evaluationSuite);
  }

  async createEvaluationRun() {
    const run = createEvaluationRun(evaluationSuite);
    run.status = EvaluationRunStatus.running;
    this.#runs.set(run.id, run);
    return structuredClone(run);
  }

  async waitForEvaluation(runId, duration = 2200) {
    const run = this.#runs.get(runId);
    if (!run) throw new Error(`EvaluationRun 不存在: ${runId}`);
    await wait(duration);
    const projectArtifacts = [...this.#artifacts.values()].filter((item)=>item.projectId===run.projectId);
    const expectedShotIds = Array.from({ length: 19 }, (_, index) => `S${String(index + 1).padStart(2, '0')}`);
    const coverage = evaluateShotCoverage(projectArtifacts, expectedShotIds); const provenance = evaluateArtifactProvenance(projectArtifacts);
    const metrics = { ...structuredClone(completedEvaluationResult.metrics), coverage: { score: coverage.score, threshold: coverage.threshold }, provenance: { score: provenance.score, threshold: provenance.threshold } };
    const failedCount = new Set([...completedEvaluationResult.failedCaseIds,...coverage.missingShotIds,...provenance.invalidArtifactIds]).size;
    const result = { ...structuredClone(completedEvaluationResult), metrics, summary: { ...structuredClone(completedEvaluationResult.summary), score: Math.round(Object.values(metrics).reduce((sum,metric)=>sum+metric.score,0)/Object.keys(metrics).length), passed: Math.max(0,completedEvaluationResult.summary.total-failedCount) }, deterministicResults: [coverage,provenance] };
    const gate = decideGate(result, evaluationSuite.gatePolicy);
    const gateDecision = { id: `gate_mock_${this.#gateDecisions.size+1}`, projectId: run.projectId, stageId: 'storyboard-finalization', runId, policyVersion: evaluationSuite.gatePolicy.version, score: result.summary.score, passed: result.summary.passed, total: result.summary.total, ...gate, decidedAt: new Date().toISOString() };
    this.#gateDecisions.set(gateDecision.id,gateDecision);
    for (const [caseId,shotId] of [['CASE-013','S13'],['CASE-017','S17']]) {
      const id=`review_mock_${caseId}`;
      if (!this.#reviewTasks.has(id)) this.#reviewTasks.set(id,{id,projectId:run.projectId,runId,caseId,shotId,title:`${caseId} · ${shotId} 人工复核`,evidenceArtifactIds:projectArtifacts.filter(item=>item.shotId===shotId).map(item=>item.id),status:'OPEN',requiredRole:'reviewer',assigneeId:null,createdAt:new Date().toISOString()});
    }
    const completed = {
      ...run,
      status: EvaluationRunStatus.completed,
      completedAt: new Date().toISOString(),
      result: { ...result, gate, gateDecision },
    };
    this.#runs.set(runId, completed);
    return structuredClone(completed);
  }

  async getEvaluationRun(runId) {
    const run = this.#runs.get(runId);
    return run ? structuredClone(run) : null;
  }

  async listEvaluationRuns(filters = {}) {
    const items = [...this.#runs.values()].filter((run)=>Object.entries(filters).every(([key,value])=>value==null||run[key]===value)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    return { items: structuredClone(items), total: items.length };
  }

  async listGateDecisions(projectId) {
    const items = [...this.#gateDecisions.values()].filter((decision)=>!projectId||decision.projectId===projectId).sort((a,b)=>new Date(b.decidedAt)-new Date(a.decidedAt));
    return { items: structuredClone(items), total: items.length };
  }

  async listReviewTasks(filters = {}) {
    const items=[...this.#reviewTasks.values()].filter((task)=>Object.entries(filters).every(([key,value])=>value==null||task[key]===value));
    return {items:structuredClone(items),total:items.length};
  }

  async claimReviewTask(taskId,actor={id:'reviewer-demo',role:'reviewer'}) {
    const task=this.#reviewTasks.get(taskId);if(!task)throw new Error('ReviewTask 不存在');if(task.status==='SUBMITTED')throw new Error('ReviewTask 已提交');
    const claimToken=crypto.randomUUID();const claimed={...task,status:'CLAIMED',assigneeId:actor.id,claimedAt:new Date().toISOString(),claimExpiresAt:new Date(Date.now()+900000).toISOString()};
    this.#reviewTasks.set(taskId,claimed);this.#reviewClaims.set(taskId,claimToken);return {task:structuredClone(claimed),claimToken};
  }

  async submitReviewDecision(taskId,claimToken,input,actor={id:'reviewer-demo',role:'reviewer'}) {
    const task=this.#reviewTasks.get(taskId);if(!task||this.#reviewClaims.get(taskId)!==claimToken||task.assigneeId!==actor.id)throw new Error('复核领取凭证无效或已过期');if(!input.comment?.trim())throw new Error('提交复核必须填写审核意见');
    const submitted={...task,status:'SUBMITTED',verdict:input.verdict,comment:input.comment.trim(),evidenceArtifactIds:[...new Set([...(task.evidenceArtifactIds||[]),...(input.evidenceArtifactIds||[])])],submittedAt:new Date().toISOString()};this.#reviewTasks.set(taskId,submitted);this.#reviewClaims.delete(taskId);
    const pendingReviews=[...this.#reviewTasks.values()].filter(item=>item.runId===task.runId&&item.status!=='SUBMITTED').length;const run=this.#runs.get(task.runId);const result={...run.result,pendingReviews};const gate=decideGate(result,evaluationSuite.gatePolicy);const gateDecision={...run.result.gateDecision,id:`gate_mock_${this.#gateDecisions.size+1}`,...gate,supersedesDecisionId:run.result.gateDecision.id,decidedAt:new Date().toISOString()};this.#gateDecisions.set(gateDecision.id,gateDecision);this.#runs.set(run.id,{...run,result:{...result,gate,gateDecision}});
    return {task:structuredClone(submitted),pendingReviews,gateDecision:structuredClone(gateDecision)};
  }

  async addRegressionCase(caseId) {
    this.#regressionCases.add(caseId);
    return { caseId, added: true, regressionCount: this.#regressionCases.size };
  }

  async createArtifact(input) {
    const id = `artifact_mock_${this.#artifacts.size + 1}`;
    const versionGroupId = input.versionGroupId || id;
    const previousActive = input.versionGroupId ? [...this.#artifacts.values()].find((current)=>(current.versionGroupId||current.id)===versionGroupId&&current.isActive!==false) : null;
    if (input.versionGroupId) for (const [artifactId,current] of this.#artifacts) if ((current.versionGroupId || current.id) === versionGroupId) this.#artifacts.set(artifactId,{...current,isActive:false});
    const artifact = { ...input, contentBase64: undefined, id, sha256: `mock-${this.#artifacts.size + 1}`, uri: `data:${input.mediaType};base64,${input.contentBase64}`, byteSize: Math.floor((input.contentBase64?.length || 0) * 0.75), sourceArtifactIds: input.sourceArtifactIds || [], versionGroupId, isActive: true, createdAt: new Date().toISOString() };
    this.#artifacts.set(artifact.id, artifact);
    const groupIds = new Set([...this.#artifacts.values()].filter((item)=>(item.versionGroupId||item.id)===versionGroupId).map((item)=>item.id));
    const invalidatedArtifactIds = previousActive ? this.#invalidateDescendants([previousActive.id],groupIds) : [];
    return structuredClone({...artifact,invalidatedArtifactIds});
  }

  async listArtifacts(filters = {}) {
    const items = [...this.#artifacts.values()].filter((item) => Object.entries(filters).every(([key, value]) => value == null || item[key] === value));
    return { items: structuredClone(items), total: items.length };
  }

  async activateArtifact(artifactId) {
    const artifact = this.#artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact 不存在: ${artifactId}`);
    const versionGroupId = artifact.versionGroupId || artifact.id;
    const previousActive = [...this.#artifacts.values()].find((current)=>(current.versionGroupId||current.id)===versionGroupId&&current.isActive!==false);
    for (const [id,current] of this.#artifacts) if ((current.versionGroupId || current.id) === versionGroupId) this.#artifacts.set(id,{...current,isActive:id===artifactId,activatedAt:id===artifactId?new Date().toISOString():current.activatedAt});
    const groupIds = new Set([...this.#artifacts.values()].filter((item)=>(item.versionGroupId||item.id)===versionGroupId).map((item)=>item.id));
    const invalidatedArtifactIds = previousActive&&previousActive.id!==artifactId?this.#invalidateDescendants([previousActive.id],groupIds):[];
    return structuredClone({...this.#artifacts.get(artifactId),invalidatedArtifactIds});
  }

  async waitForEvaluationEvents(runId, onEvent, duration = 2200) {
    onEvent?.({ type: 'EVALUATION_STARTED', runId, occurredAt: new Date().toISOString(), payload: { totalCases: 24 } });
    onEvent?.({ type: 'HEARTBEAT', runId, occurredAt: new Date().toISOString(), payload: { status: 'RUNNING' } });
    const completed = await this.waitForEvaluation(runId, duration);
    onEvent?.({ type: 'EVALUATION_COMPLETED', runId, occurredAt: completed.completedAt, payload: { summary: completed.result.summary, gate: completed.result.gate } });
    return completed;
  }

  async runDeterministicEvaluators(projectId, expectedShotIds) {
    const artifacts = [...this.#artifacts.values()].filter((item) => item.projectId === projectId);
    const results = [evaluateShotCoverage(artifacts, expectedShotIds), evaluateArtifactProvenance(artifacts)];
    return { status: 'COMPLETED', results, verdict: results.some((result) => result.verdict === 'FAIL') ? 'BLOCKED' : 'PASS' };
  }
}

export const mockAgentWorkbenchApi = new MockAgentWorkbenchApi();
