import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncWebData } from './sync-web-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'prototype');
const target = path.join(root, 'dist');

syncWebData(root);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

const required = [
  'index.html',
  'main.js',
  'graph-core.js',
  'styles.css',
  'interactions.css',
  'data/node-definitions.json',
  'data/workflows.json',
  'data/embedded-data.js',
];

for (const relative of required) {
  if (!fs.existsSync(path.join(target, relative))) throw new Error(`构建缺少文件：${relative}`);
}

console.log(`静态 Web 构建完成：${target}`);
