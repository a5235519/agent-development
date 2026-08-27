import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createCanvasAdapter } from '../spikes/xyflow-canvas/src/canvas-adapter.js';
import { createCommandHistory } from '../spikes/xyflow-canvas/src/command-history.js';
import { createMemoryStorage, createProjectStore } from '../spikes/xyflow-canvas/src/project-store.js';
import { createInMemoryProjectRepository, ProjectConflictError, PROJECT_REPOSITORY_METHODS } from '../spikes/xyflow-canvas/src/project-repository.js';
import { createRunEngine } from '../spikes/xyflow-canvas/src/run-engine.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../catalog/node-definitions.json', import.meta.url), 'utf8'));
const examples = JSON.parse(fs.readFileSync(new URL('../examples/workflows.json', import.meta.url), 'utf8'));
const adapter = createCanvasAdapter({ catalog, graphCore: { compatible: (source, target) => source === target } });

test('Canvas Adapter 往返保留工作流身份、节点、连线和配置', () => {
  const source = structuredClone(examples.workflows.find((item) => item.kind === 'image-text-plugin'));
  const graph = adapter.fromWorkflow(source);
  const result = adapter.toWorkflow({ ...graph });

  assert.equal(result.id, source.id);
  assert.equal(result.title, source.title);
  assert.equal(result.kind, source.kind);
  assert.deepEqual(result.nodes, source.nodes);
  assert.deepEqual(result.edges, source.edges);
  assert.deepEqual(result.pluginDependencies, [{
    definitionId: 'plugin.storyboard-draft',
    version: '1.4.0',
    executorRef: 'plugin://storyboard-draft/generate@1.4',
  }]);
});

test('Canvas Adapter 拒绝未知节点定义', () => {
  assert.throws(() => adapter.toCanvasNode({
    id: 'unknown',
    definitionId: 'missing.definition',
    position: { x: 0, y: 0 },
  }), /Unknown NodeDefinition/);
});

test('Canvas Adapter 接受兼容端口、拒绝错误类型并在重连时忽略旧边', () => {
  const workflow = examples.workflows.find((item) => item.kind === 'image-text-plugin');
  const graph = adapter.fromWorkflow(workflow);
  const generationDefinition = catalog.definitions.find((item) => item.id === 'generate.image-to-image');
  const generationNode = {
    id: 'generation',
    type: 'multimodal',
    position: { x: 0, y: 0 },
    data: { definitionId: generationDefinition.id, definition: generationDefinition, config: {} },
  };
  const nodes = graph.nodes.concat(generationNode);

  assert.equal(adapter.compatibleConnection({
    source: 'images', sourceHandle: 'images', target: 'generation', targetHandle: 'images',
  }, nodes, graph.edges), true);
  assert.equal(adapter.compatibleConnection({
    source: 'prompt', sourceHandle: 'prompt', target: 'generation', targetHandle: 'images',
  }, nodes, graph.edges), false);
  assert.equal(adapter.compatibleConnection({
    source: 'prompt', sourceHandle: 'prompt', target: 'plugin', targetHandle: 'prompt',
  }, nodes, graph.edges), false, '单值端口已有连线时应拒绝');
  assert.equal(adapter.compatibleConnection({
    source: 'prompt', sourceHandle: 'prompt', target: 'plugin', targetHandle: 'prompt',
  }, nodes, graph.edges, 'e3'), true, '重连自身时应忽略待替换旧边');
});

test('Canvas Adapter 往返保留分组成员与节点绝对坐标', () => {
  const source = structuredClone(examples.workflows.find((item) => item.kind === 'image-text-plugin'));
  source.groups = [{ id: 'group-1', title: '素材组', memberIds: ['images', 'script'], collapsed: false }];
  const graph = adapter.fromWorkflow(source);
  const map = new Map(graph.nodes.map((node) => [node.id, node]));
  const absolutePosition = (node) => {
    const parent = node.parentId && map.get(node.parentId);
    return parent ? { x: parent.position.x + node.position.x, y: parent.position.y + node.position.y } : node.position;
  };
  const result = adapter.toWorkflow({ ...graph, absolutePosition });

  assert.deepEqual(result.nodes, source.nodes);
  assert.deepEqual(result.groups[0].memberIds, ['images', 'script']);
  assert.equal(result.groups[0].title, '素材组');
});

test('Canvas Adapter 恢复折叠分组时保留展开尺寸并隐藏成员', () => {
  const source = structuredClone(examples.workflows.find((item) => item.kind === 'image-text-plugin'));
  source.groups = [{
    id: 'group-collapsed', title: '折叠素材组', memberIds: ['images', 'script'], collapsed: true,
    position: { x: 40, y: 20 }, size: { width: 520, height: 430 },
  }];
  const graph = adapter.fromWorkflow(source);
  const group = graph.nodes.find((node) => node.id === 'group-collapsed');
  const members = graph.nodes.filter((node) => node.parentId === group.id);
  assert.equal(group.type, 'multimodalGroup');
  assert.equal(group.style.height, 58);
  assert.deepEqual(group.data.expandedSize, { width: 520, height: 430 });
  assert.ok(members.every((node) => node.hidden));
  const result = adapter.toWorkflow({ ...graph });
  assert.deepEqual(result.groups[0].size, { width: 520, height: 430 });
  assert.equal(result.groups[0].collapsed, true);
});

test('领域命令历史支持撤销、重做和分叉后清空 redo', () => {
  const initial = { metadata: { id: 'draft' }, nodes: [], edges: [] };
  const history = createCommandHistory(initial, { limit: 10 });
  const oneNode = { ...initial, nodes: [{ id: 'n1' }] };
  const twoNodes = { ...initial, nodes: [{ id: 'n1' }, { id: 'n2' }] };

  history.record('添加节点', initial, oneNode, { nodeId: 'n1' });
  history.record('添加节点', oneNode, twoNodes, { nodeId: 'n2' });
  assert.deepEqual(history.state(), {
    canUndo: true,
    canRedo: false,
    undoCount: 2,
    redoCount: 0,
    lastCommand: '添加节点',
  });

  assert.deepEqual(history.undo().graph, oneNode);
  assert.deepEqual(history.undo().graph, initial);
  assert.deepEqual(history.redo().graph, oneNode);

  const branched = { ...initial, nodes: [{ id: 'n3' }] };
  history.record('添加节点', oneNode, branched, { nodeId: 'n3' });
  assert.equal(history.state().canRedo, false);
  assert.deepEqual(history.undo().graph, oneNode);
});

test('领域命令历史忽略无变化命令并执行容量上限', () => {
  const initial = { metadata: {}, nodes: [], edges: [] };
  const history = createCommandHistory(initial, { limit: 2 });
  assert.equal(history.record('空操作', initial, structuredClone(initial)), null);

  let before = initial;
  for (let index = 1; index <= 3; index += 1) {
    const after = { ...initial, nodes: Array.from({ length: index }, (_, id) => ({ id: String(id) })) };
    history.record(`命令${index}`, before, after);
    before = after;
  }
  assert.equal(history.state().undoCount, 2);
  assert.equal(history.undo().command.type, '命令3');
  assert.equal(history.undo().command.type, '命令2');
  assert.equal(history.undo(), null);
});

test('Project Store 支持自动保存、刷新恢复、工程切换和版本恢复', () => {
  const storage = createMemoryStorage();
  let tick = 0;
  const options = {
    storage,
    seedDraft: examples.workflows[0],
    now: () => `2026-08-12T00:00:0${tick++}.000Z`,
    createId: () => 'project-second',
  };
  const store = createProjectStore(options);
  store.load();
  const edited = structuredClone(examples.workflows[0]);
  edited.title = '已自动保存草稿';
  edited.nodes[0].position.x += 120;
  store.saveDraft(edited, { command: { id: 'cmd-1', type: '移动节点', meta: { nodeId: edited.nodes[0].id } } });

  const reloaded = createProjectStore(options);
  reloaded.load();
  assert.equal(reloaded.current().draft.title, '已自动保存草稿');
  assert.equal(reloaded.current().draftEvents.at(-1).type, '移动节点');

  const firstId = reloaded.current().id;
  reloaded.publishVersion(edited);
  const changedAfterPublish = structuredClone(edited);
  changedAfterPublish.title = '发布后的修改';
  reloaded.saveDraft(changedAfterPublish);
  const restored = reloaded.restoreVersion(reloaded.current().versions[0].id);
  assert.equal(restored.title, '已自动保存草稿');
  assert.equal(restored.id, edited.id, '版本恢复不应把 Workflow ID 替换为 Version ID');

  const second = reloaded.createProject({ title: '第二工程', draft: examples.workflows[1] });
  assert.equal(reloaded.current().id, second.id);
  reloaded.switchProject(firstId);
  assert.equal(reloaded.current().draft.title, '已自动保存草稿');
  reloaded.switchProject(second.id);
  assert.equal(reloaded.current().draft.id, examples.workflows[1].id);
});

test('Project Store 归档成功运行、同 ID 幂等更新并限制为 50 条', () => {
  const storage = createMemoryStorage();
  let tick = 0;
  const options = {
    storage,
    seedDraft: examples.workflows[0],
    now: () => `2026-08-13T03:00:${String(tick++).padStart(2, '0')}.000Z`,
  };
  const store = createProjectStore(options);
  store.load();
  store.archiveRun({ id: 'run-1', status: 'SUCCEEDED', events: [] });
  store.archiveRun({ id: 'run-1', status: 'SUCCEEDED', events: [{ type: 'WorkflowRun' }] });
  assert.equal(store.current().runs.length, 1);
  assert.equal(store.current().runs[0].events.length, 1);
  for (let index = 2; index <= 52; index += 1) store.archiveRun({ id: `run-${index}`, status: 'SUCCEEDED' });
  assert.equal(store.current().runs.length, 50);
  assert.equal(store.current().runs[0].id, 'run-52');
  assert.equal(store.current().runs.filter((item) => item.id === 'run-1').length, 0);

  const reloaded = createProjectStore(options);
  reloaded.load();
  assert.equal(reloaded.current().runs.length, 50);
  assert.equal(reloaded.current().runs[0].id, 'run-52');
});

test('Project Repository 使用 revision 防止静默覆盖并支持版本恢复', async () => {
  let tick = 0;
  const repository = createInMemoryProjectRepository({ now: () => `2026-08-13T00:00:0${tick++}.000Z` });
  assert.deepEqual(Object.keys(repository).sort(), [...PROJECT_REPOSITORY_METHODS].sort());
  const created = await repository.createProject({ id: 'project-1', title: 'EP01', draft: examples.workflows[0] });
  const edited = structuredClone(created.draft);
  edited.title = '第一次保存';
  const saved = await repository.saveDraft(created.id, edited, { expectedRevision: created.revision });
  assert.equal(saved.revision, 2);
  await assert.rejects(
    repository.saveDraft(created.id, examples.workflows[1], { expectedRevision: 1 }),
    (error) => error instanceof ProjectConflictError && error.code === 'PROJECT_REVISION_CONFLICT' && error.actualRevision === 2,
  );
  const published = await repository.publishVersion(created.id, saved.draft, { expectedRevision: saved.revision });
  const changed = structuredClone(saved.draft);
  changed.title = '发布后修改';
  const changedProject = await repository.saveDraft(created.id, changed, { expectedRevision: published.project.revision });
  const restored = await repository.restoreVersion(created.id, published.version.id, { expectedRevision: changedProject.revision });
  assert.equal(restored.draft.title, '第一次保存');
  assert.equal(restored.revision, 5);
});

test('模拟 Run Engine 按拓扑执行插件并生成 Artifact 与收据', () => {
  let sequence = 0;
  const graphCore = { validateWorkflow: () => [] };
  const engine = createRunEngine({
    catalog,
    graphCore,
    now: () => `2026-08-13T01:00:${String(sequence++).padStart(2, '0')}.000Z`,
    createId: (prefix) => `${prefix}-${sequence++}`,
  });
  const workflow = examples.workflows.find((item) => item.kind === 'image-text-plugin');
  let run = engine.prepareRun(workflow);
  assert.equal(run.status, 'PREPARED');
  while (['PREPARED', 'RUNNING'].includes(run.status)) run = engine.advanceRun(run);
  assert.equal(run.status, 'SUCCEEDED');
  assert.ok(run.nodeRuns.every((item) => item.status === 'succeeded'));
  const pluginRun = run.nodeRuns.find((item) => item.definitionId === 'plugin.storyboard-draft');
  assert.equal(pluginRun.executorRef, 'plugin://storyboard-draft/generate@1.4');
  assert.equal(pluginRun.artifacts[0].type, 'image.collection');
  assert.equal(pluginRun.artifacts[0].candidateCount, 4);
  assert.equal(run.receipt.nodeRuns.length, workflow.nodes.length);
});

test('模拟 Run Engine 支持失败、阻塞下游和从失败节点重试', () => {
  let sequence = 0;
  const engine = createRunEngine({
    catalog,
    graphCore: { validateWorkflow: () => [] },
    now: () => `2026-08-13T02:00:${String(sequence++).padStart(2, '0')}.000Z`,
    createId: (prefix) => `${prefix}-${sequence++}`,
  });
  const workflow = examples.workflows.find((item) => item.kind === 'image-text-plugin');
  let run = engine.advanceRun(engine.prepareRun(workflow));
  while (run.status === 'RUNNING') run = engine.advanceRun(run, { failNodeId: 'plugin' });
  assert.equal(run.status, 'FAILED');
  assert.equal(run.nodeRuns.find((item) => item.nodeId === 'plugin').status, 'failed');
  assert.ok(run.nodeRuns.some((item) => item.status === 'blocked'));
  run = engine.retryRun(run, 'plugin');
  while (run.status === 'RUNNING') run = engine.advanceRun(run);
  assert.equal(run.status, 'SUCCEEDED');
  assert.ok(run.events.some((event) => event.type === 'Retry'));
});

test('模拟 Run Engine 在 GraphCore 预检失败时保持 BLOCKED', () => {
  const engine = createRunEngine({
    catalog,
    graphCore: { validateWorkflow: () => [{ code: 'GRAPH_REQUIRED_INPUT_MISSING', message: '缺少输入', severity: 'error', path: 'nodes[0]' }] },
  });
  const run = engine.prepareRun(examples.workflows[0]);
  assert.equal(run.status, 'BLOCKED');
  assert.ok(run.nodeRuns.every((item) => item.status === 'blocked'));
  assert.equal(engine.advanceRun(run).status, 'BLOCKED');
});
