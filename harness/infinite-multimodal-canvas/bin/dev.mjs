import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prototype');
const host = process.env.HARNESS_HOST || '127.0.0.1';
const port = Number(process.env.HARNESS_PORT || 5173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png' };

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`) && filename !== path.join(root, 'index.html')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404).end('Not Found');
    return;
  }
  response.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(filename).pipe(response);
});

server.listen(port, host, () => console.log(`Harness Web: http://${host}:${port}/`));
