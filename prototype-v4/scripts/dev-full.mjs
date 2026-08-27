import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: { ...process.env, VITE_AGENT_API: 'http' } }),
];

const stop = () => { for (const child of children) child.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { if (code && code !== 0) { stop(); process.exitCode = code; } });
