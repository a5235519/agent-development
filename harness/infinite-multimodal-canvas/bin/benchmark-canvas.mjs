import { performance } from 'node:perf_hooks';
import { readHarness, validateWorkflowGraph } from './validate.mjs';

const { catalog } = readHarness();
const pairCount = 500;
const nodes = [];
const edges = [];

for (let index = 0; index < pairCount; index += 1) {
  const promptId = `prompt-${index}`;
  const generateId = `generate-${index}`;
  nodes.push(
    { id: promptId, definitionId: 'content.prompt', position: { x: index * 340, y: 0 }, config: {} },
    { id: generateId, definitionId: 'generate.text-to-image', position: { x: index * 340, y: 260 }, config: {} }
  );
  edges.push({ id: `edge-${index}`, source: promptId, sourcePort: 'prompt', target: generateId, targetPort: 'prompt' });
}

const workflow = { id: 'benchmark-1000', title: '1000-node baseline', kind: 'text-to-image', nodes, edges };
const validationStarted = performance.now();
const issues = validateWorkflowGraph(catalog, workflow);
const validationMs = performance.now() - validationStarted;
if (issues.length) throw new Error(`性能夹具不合法：${issues[0].code} ${issues[0].message}`);

const moved = new Set(['prompt-250']);
const updateStarted = performance.now();
const touchedEdges = edges.filter((edge) => moved.has(edge.source) || moved.has(edge.target));
for (const edge of touchedEdges) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  `${source.position.x},${source.position.y}->${target.position.x},${target.position.y}`;
}
const incrementalUpdateMs = performance.now() - updateStarted;

const result = {
  fixture: { nodes: nodes.length, edges: edges.length },
  validationMs: Number(validationMs.toFixed(3)),
  incrementalUpdateMs: Number(incrementalUpdateMs.toFixed(3)),
  touchedEdges: touchedEdges.length,
  budgets: { validationMs: 1500, incrementalUpdateMs: 50, touchedEdges: 1 }
};

if (validationMs > result.budgets.validationMs) throw new Error(`图校验超出预算：${validationMs.toFixed(1)}ms`);
if (incrementalUpdateMs > result.budgets.incrementalUpdateMs) throw new Error(`增量更新计算超出预算：${incrementalUpdateMs.toFixed(1)}ms`);
if (touchedEdges.length !== result.budgets.touchedEdges) throw new Error(`增量更新范围错误：${touchedEdges.length}`);

console.log(JSON.stringify(result, null, 2));
