import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function syncWebData(root = defaultRoot) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog/node-definitions.json'), 'utf8'));
  const examples = JSON.parse(fs.readFileSync(path.join(root, 'examples/workflows.json'), 'utf8'));
  const dataDir = path.join(root, 'prototype/data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'node-definitions.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'workflows.json'), `${JSON.stringify(examples, null, 2)}\n`);
  fs.writeFileSync(path.join(dataDir, 'embedded-data.js'), `globalThis.__HARNESS_DATA__=${JSON.stringify({ catalog, examples })};\n`);
  return { catalog, examples };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { catalog, examples } = syncWebData();
  console.log(`Web 数据已同步：${catalog.definitions.length} 个节点，${examples.workflows.length} 个模板。`);
}
