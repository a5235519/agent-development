function clone(value) {
  return structuredClone(value);
}

function topologicalOrder(workflow) {
  const indegree = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, []]));
  for (const edge of workflow.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
    indegree.set(edge.target, indegree.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }
  const queue = workflow.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const ordered = [];
  while (queue.length) {
    const nodeId = queue.shift();
    ordered.push(nodeId);
    for (const target of outgoing.get(nodeId) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  return ordered.length === workflow.nodes.length ? ordered : workflow.nodes.map((node) => node.id);
}

function createArtifacts(node, definition, createId, now) {
  return definition.outputs.map((port, index) => ({
    id: createId('artifact'),
    nodeId: node.id,
    portId: port.id,
    type: port.type,
    createdAt: now(),
    candidateCount: port.cardinality === 'many' ? 4 : 1,
    content: port.type === 'document.script'
      ? 'S01  京都清晨街道\n柠萌背着旅行包走入画面。\n\nS02  町屋门前\n角色停下并看向镜头。'
      : port.type.startsWith('text.') ? `模拟文本产物 · ${definition.title} · ${index + 1}` : null,
  }));
}

export function createRunEngine({ catalog, graphCore, now = () => new Date().toISOString(), createId = (prefix) => `${prefix}-${Date.now().toString(36)}` }) {
  const definitions = new Map(catalog.definitions.map((item) => [item.id, item]));

  function prepareRun(workflow) {
    const issues = graphCore.validateWorkflow(catalog, workflow, { requirePluginDependencies: true });
    const order = topologicalOrder(workflow);
    const createdAt = now();
    return {
      id: createId('run'),
      status: issues.length ? 'BLOCKED' : 'PREPARED',
      createdAt,
      finishedAt: null,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      issues: clone(issues),
      events: [{ at: createdAt, type: 'WorkflowRun', message: issues.length ? 'BLOCKED · 本地预检未通过' : 'PREPARED · 输入快照已冻结' }],
      nodeRuns: order.map((nodeId) => {
        const node = workflow.nodes.find((item) => item.id === nodeId);
        const definition = definitions.get(node.definitionId);
        return {
          nodeId,
          definitionId: node.definitionId,
          title: definition.title,
          executorRef: definition.executorRef || 'local://content',
          status: issues.length ? 'blocked' : 'queued',
          startedAt: null,
          finishedAt: null,
          artifacts: [],
          error: null,
        };
      }),
      receipt: null,
    };
  }

  function advanceRun(input, { failNodeId = null } = {}) {
    const run = clone(input);
    if (run.status === 'PREPARED') {
      run.status = 'RUNNING';
      run.events.push({ at: now(), type: 'WorkflowRun', message: 'RUNNING · 模拟执行已开始' });
      return run;
    }
    if (run.status !== 'RUNNING') return run;
    const current = run.nodeRuns.find((item) => item.status === 'queued');
    if (!current) {
      run.status = 'SUCCEEDED';
      run.finishedAt = now();
      run.receipt = {
        runId: run.id,
        status: run.status,
        workflowId: run.workflowId,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
        nodeRuns: run.nodeRuns.map((item) => ({ nodeId: item.nodeId, status: item.status, artifactIds: item.artifacts.map((artifact) => artifact.id) })),
      };
      run.events.push({ at: run.finishedAt, type: 'WorkflowRun', message: 'SUCCEEDED · 模拟运行已结算' });
      return run;
    }
    current.status = 'running';
    current.startedAt = now();
    run.events.push({ at: current.startedAt, type: 'NodeRun', nodeId: current.nodeId, message: `RUNNING · ${current.executorRef}` });
    if (current.nodeId === failNodeId) {
      current.status = 'failed';
      current.error = '模拟执行器超时';
      current.finishedAt = now();
      run.nodeRuns.filter((item) => item.status === 'queued').forEach((item) => { item.status = 'blocked'; });
      run.status = 'FAILED';
      run.finishedAt = current.finishedAt;
      run.events.push({ at: current.finishedAt, type: 'NodeRun', nodeId: current.nodeId, message: 'FAILED · 模拟执行器超时' });
      return run;
    }
    const node = { id: current.nodeId, definitionId: current.definitionId };
    current.artifacts = createArtifacts(node, definitions.get(current.definitionId), createId, now);
    current.status = 'succeeded';
    current.finishedAt = now();
    run.events.push({ at: current.finishedAt, type: 'Artifact', nodeId: current.nodeId, message: `SUCCEEDED · ${current.artifacts.length} 个 Artifact` });
    return run;
  }

  function retryRun(input, nodeId) {
    const run = clone(input);
    const failed = run.nodeRuns.find((item) => item.nodeId === nodeId && item.status === 'failed');
    if (!failed) return run;
    failed.status = 'queued';
    failed.error = null;
    failed.startedAt = null;
    failed.finishedAt = null;
    failed.artifacts = [];
    run.nodeRuns.filter((item) => item.status === 'blocked').forEach((item) => { item.status = 'queued'; });
    run.status = 'RUNNING';
    run.finishedAt = null;
    run.events.push({ at: now(), type: 'Retry', nodeId, message: '重试 · 复用冻结输入快照' });
    return run;
  }

  return { prepareRun, advanceRun, retryRun };
}
