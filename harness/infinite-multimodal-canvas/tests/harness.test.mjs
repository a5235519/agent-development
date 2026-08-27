import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { readHarness, validateHarness, validateWorkflowGraph } from '../bin/validate.mjs';

test('五类基础工作流和节点目录通过验证', () => {
  const { catalog, examples } = readHarness();
  assert.equal(examples.workflows.length, 5);
  assert.deepEqual(validateHarness(catalog, examples), []);
});

test('Web 原型使用的目录与 Harness 契约保持一致', () => {
  const { catalog, examples } = readHarness();
  const webCatalog = JSON.parse(fs.readFileSync(new URL('../prototype/data/node-definitions.json', import.meta.url), 'utf8'));
  const webExamples = JSON.parse(fs.readFileSync(new URL('../prototype/data/workflows.json', import.meta.url), 'utf8'));
  assert.deepEqual(webCatalog, catalog);
  assert.deepEqual(webExamples, examples);
});

test('本地文件入口的内嵌数据无需 fetch 即可载入', () => {
  const context = { globalThis: {} };
  const source = fs.readFileSync(new URL('../prototype/data/embedded-data.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, context);
  assert.equal(context.globalThis.__HARNESS_DATA__.catalog.catalogVersion, '0.2.0');
  assert.equal(context.globalThis.__HARNESS_DATA__.catalog.definitions.length, 26);
  assert.equal(context.globalThis.__HARNESS_DATA__.examples.workflows.length, 5);
});

test('V0.4 画布基础交互入口完整', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  for (const marker of ['id="groups"', 'id="minimap-nodes"', 'id="shortcut-modal"', 'id="asset-modal"']) {
    assert.ok(html.includes(marker), `缺少界面入口 ${marker}`);
  }
  for (const action of ['createGroupFromSelection', 'toggleSelectedDisabled', 'openCompatiblePalette', 'beginReconnect', 'assetRoles']) {
    assert.ok(source.includes(action), `缺少交互实现 ${action}`);
  }
});

test('V0.5 插件管理与 Skill 转换入口完整', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  for (const marker of ['id="plugin-modal"', 'id="plugin-list"', 'data-plugin-tab="ports"', 'data-plugin-tab="skill"', 'data-plugin-tab="test"']) {
    assert.ok(html.includes(marker), `缺少插件管理入口 ${marker}`);
  }
  for (const action of ['analyzeSkillSource', 'renderPluginPorts', 'runPluginTest', 'publishPlugin', 'syncPublishedPlugins']) {
    assert.ok(source.includes(action), `缺少插件管理实现 ${action}`);
  }
});

test('V0.6 运行调试与 Artifact 查看入口完整', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  for (const marker of ['data-run-tab="nodes"', 'data-run-tab="events"', 'data-run-tab="io"', 'data-run-tab="receipts"', 'id="artifact-modal"']) {
    assert.ok(html.includes(marker), `缺少运行调试入口 ${marker}`);
  }
  for (const action of ['resolveRunNodeIds', 'executePreparedRun', 'retryNodeRun', 'renderRunIO', 'openArtifactViewer']) {
    assert.ok(source.includes(action), `缺少运行调试实现 ${action}`);
  }
});

test('V0.7 工程、版本与运行历史入口完整', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  for (const marker of ['id="workspace-modal"', 'data-workspace-tab="versions"', 'data-workspace-tab="runs"', 'data-workspace-tab="dependencies"', 'data-workspace-tab="transfer"']) {
    assert.ok(html.includes(marker), `缺少工程管理入口 ${marker}`);
  }
  for (const action of ['publishWorkflowVersion', 'restoreWorkflowSnapshot', 'collectPluginDependencies', 'renderWorkspaceRuns', 'renderWorkspaceTransfer']) {
    assert.ok(source.includes(action), `缺少工程管理实现 ${action}`);
  }
});

test('V0.8 工程是画布草稿的唯一持久化状态源', () => {
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  assert.ok(source.includes("const projectKey='multimodal-canvas-projects-v08'"));
  assert.ok(source.includes("const activeProjectKey='multimodal-canvas-active-project-v08'"));
  assert.ok(source.includes('function persistCurrentDraft()'));
  assert.ok(source.includes('createPerformanceFixture(benchmarkNodes):currentProject().draft'));
  assert.ok(!source.includes("const stateKey="), '不应继续维护独立于工程的全局画布状态');
  assert.ok(!source.includes('localStorage.setItem(stateKey'), '自动保存必须写回当前工程草稿');
});

test('V0.8 浏览器、发布、导入和 CLI 共用 graph-core', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  const cli = fs.readFileSync(new URL('../bin/validate.mjs', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="./graph-core.js"></script>'));
  assert.ok(source.includes('GraphCore.validateWorkflow(catalog,validationWorkflow(),options)'));
  assert.ok(source.includes('GraphCore.validateWorkflow(catalog,imported,{requirePluginDependencies:true})'));
  assert.ok(cli.includes("import '../prototype/graph-core.js'"));
});

test('V0.8 无限画布移除固定世界并使用拖动增量更新', () => {
  const html = fs.readFileSync(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../prototype/interactions.css', import.meta.url), 'utf8');
  const source = fs.readFileSync(new URL('../prototype/main.js', import.meta.url), 'utf8');
  assert.ok(!html.includes('width="5000"'));
  assert.ok(!html.includes('height="3200"'));
  assert.ok(css.includes('.world {\n  width: 1px;\n  height: 1px;\n  overflow: visible;'));
  assert.ok(source.includes('function updateNodeElements(ids)'));
  assert.ok(source.includes('function updateConnectedEdges(ids)'));
  assert.ok(source.includes('portEl.getBoundingClientRect()'));
  const nodeDrag = source.slice(source.indexOf('function startNodeDrag'), source.indexOf('function startGroupDrag'));
  assert.ok(nodeDrag.includes('updateNodeElements(ids)'));
  assert.ok(nodeDrag.includes('updateConnectedEdges(ids)'));
  assert.ok(!nodeDrag.includes('renderNodes()'), '节点拖动期间不应全量重建节点 DOM');
  assert.ok(!nodeDrag.includes('renderEdges()'), '节点拖动期间不应全量重建连线 DOM');
});

test('P0-3 XYFlow Spike 通过 Canvas Adapter 复用领域契约', () => {
  const source = fs.readFileSync(new URL('../spikes/xyflow-canvas/src/main.jsx', import.meta.url), 'utf8');
  const adapter = fs.readFileSync(new URL('../spikes/xyflow-canvas/src/canvas-adapter.js', import.meta.url), 'utf8');
  assert.ok(source.includes('onlyRenderVisibleElements'));
  assert.ok(source.includes('onPaneContextMenu'));
  assert.ok(source.includes('onReconnect'));
  assert.ok(source.includes('createGroup'));
  assert.ok(source.includes('createCommandHistory'));
  assert.ok(source.includes('deleteKeyCode={null}'));
  assert.ok(source.includes('selectionMode'));
  assert.ok(source.includes('onNodeClick={onNodeClick}'));
  assert.ok(source.includes('createProjectStore'));
  assert.ok(source.includes('restoreLatestVersion'));
  assert.ok(source.includes('toggleGroup'));
  assert.ok(source.includes('ungroup'));
  assert.ok(source.includes('暂不支持嵌套分组'));
  assert.ok(source.includes('createRunEngine'));
  assert.ok(source.includes('Artifact Viewer'));
  assert.ok(source.includes('retrySimulation'));
  assert.ok(adapter.includes('graphCore.compatible'));
  assert.ok(adapter.includes('pluginDependencies'));
  assert.ok(adapter.includes('sourceHandle'));
  assert.ok(adapter.includes('targetHandle'));
});

test('graph-core 返回稳定错误码并校验插件依赖锁', () => {
  const { catalog, examples } = readHarness();
  const workflow = structuredClone(examples.workflows.find((item) => item.kind === 'image-text-plugin'));
  workflow.pluginDependencies = [{ definitionId: 'plugin.storyboard-draft', version: '0.0.1', executorRef: 'plugin://wrong' }];
  const issues = validateWorkflowGraph(catalog, workflow, { requirePluginDependencies: true });
  assert.ok(issues.some((item) => item.code === 'GRAPH_PLUGIN_DEPENDENCY_MISMATCH'));
  assert.ok(issues.every((item) => item.severity === 'error' && item.message && item.path));
});

test('graph-core 同时拒绝单值端口重复连接和未声明环路', () => {
  const { catalog, examples } = readHarness();
  const workflow = structuredClone(examples.workflows[0]);
  workflow.edges.push(
    { id: 'duplicate-input', source: 'prompt', sourcePort: 'prompt', target: 'generate', targetPort: 'prompt' },
    { id: 'cycle-a', source: 'generate', sourcePort: 'images', target: 'validator', targetPort: 'images' },
    { id: 'cycle-b', source: 'validator', sourcePort: 'report', target: 'gate', targetPort: 'report' }
  );
  workflow.nodes.push({ id: 'loopMerge', definitionId: 'transform.merge-images', position: { x: 500, y: 500 }, config: {} });
  workflow.edges.push(
    { id: 'cycle-c', source: 'generate', sourcePort: 'images', target: 'loopMerge', targetPort: 'images' },
    { id: 'cycle-d', source: 'loopMerge', sourcePort: 'images', target: 'generate', targetPort: 'prompt' }
  );
  const codes = new Set(validateWorkflowGraph(catalog, workflow).map((item) => item.code));
  assert.ok(codes.has('GRAPH_SINGLE_INPUT_MULTIPLE_EDGES'));
  assert.ok(codes.has('GRAPH_CYCLE_DETECTED'));
});

test('拒绝不兼容的图片到文本连线', () => {
  const { catalog, examples } = readHarness();
  const workflow = structuredClone(examples.workflows[0]);
  workflow.edges[0] = { id: 'bad', source: 'prompt', sourcePort: 'prompt', target: 'validator', targetPort: 'images' };
  const errors = validateHarness(catalog, { workflows: [
    workflow,
    ...examples.workflows.slice(1)
  ] });
  assert.ok(errors.some((error) => error.includes('类型不兼容 text.prompt → image.collection')));
});

test('拒绝悬空的必填端口', () => {
  const { catalog, examples } = readHarness();
  const workflows = structuredClone(examples);
  const target = workflows.workflows.find((workflow) => workflow.kind === 'image-to-video');
  target.edges = target.edges.filter((edge) => edge.targetPort !== 'firstFrame');
  const errors = validateHarness(catalog, workflows);
  assert.ok(errors.some((error) => error.includes('必填输入未连接 generate.firstFrame')));
});

test('拒绝未声明环路', () => {
  const { catalog, examples } = readHarness();
  const workflows = structuredClone(examples);
  const target = workflows.workflows[0];
  target.nodes.push(
    { id: 'loopMerge', definitionId: 'transform.merge-images', position: { x: 500, y: 500 }, config: {} },
    { id: 'loopSelect', definitionId: 'transform.select-image', position: { x: 800, y: 500 }, config: {} }
  );
  target.edges.push(
    { id: 'loop1', source: 'loopMerge', sourcePort: 'images', target: 'loopSelect', targetPort: 'images' },
    { id: 'loop2', source: 'loopSelect', sourcePort: 'image', target: 'loopMerge', targetPort: 'image' }
  );
  const errors = validateHarness(catalog, workflows);
  assert.ok(errors.some((error) => error.includes('检测到未声明环路')));
});
