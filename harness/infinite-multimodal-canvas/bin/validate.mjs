import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../prototype/graph-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readHarness(rootDir = root) {
  const catalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'catalog/node-definitions.json'), 'utf8'));
  const examples = JSON.parse(fs.readFileSync(path.join(rootDir, 'examples/workflows.json'), 'utf8'));
  return { catalog, examples };
}

function uniqueBy(items, key, context, errors) {
  const seen = new Set();
  for (const item of items) {
    const value = item[key];
    if (!value) errors.push(`${context}: 缺少 ${key}`);
    else if (seen.has(value)) errors.push(`${context}: ${key} 重复 ${value}`);
    else seen.add(value);
  }
}

export function validateWorkflowGraph(catalog, workflow, options = {}) {
  return globalThis.GraphCore.validateWorkflow(catalog, workflow, options);
}

export function validateHarness(catalog, examples) {
  const errors = [];
  const allowedTypes = new Set(catalog.types || []);
  const definitions = catalog.definitions || [];
  uniqueBy(definitions, 'id', 'node definitions', errors);
  const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));

  for (const definition of definitions) {
    uniqueBy(definition.inputs || [], 'id', `${definition.id} inputs`, errors);
    uniqueBy(definition.outputs || [], 'id', `${definition.id} outputs`, errors);
    for (const port of [...(definition.inputs || []), ...(definition.outputs || [])]) {
      if (!allowedTypes.has(port.type)) errors.push(`${definition.id}.${port.id}: 未声明端口类型 ${port.type}`);
      if (!['one', 'many'].includes(port.cardinality)) errors.push(`${definition.id}.${port.id}: 非法基数 ${port.cardinality}`);
    }
  }

  const workflows = examples.workflows || [];
  uniqueBy(workflows, 'id', 'workflows', errors);
  const expectedKinds = new Set(['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'image-text-plugin']);

  for (const workflow of workflows) {
    const context = `workflow ${workflow.id}`;
    if (!expectedKinds.has(workflow.kind)) errors.push(`${context}: 未支持 kind ${workflow.kind}`);
    for (const graphIssue of validateWorkflowGraph(catalog, workflow)) errors.push(`${context}: ${graphIssue.message}`);
  }

  for (const kind of expectedKinds) if (!workflows.some((workflow) => workflow.kind === kind)) errors.push(`缺少基础模板 ${kind}`);
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { catalog, examples } = readHarness();
  const errors = validateHarness(catalog, examples);
  if (errors.length) {
    console.error(`Harness 验证失败（${errors.length} 项）`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Harness 验证通过：${catalog.definitions.length} 个节点定义，${examples.workflows.length} 个工作流模板。`);
  }
}
