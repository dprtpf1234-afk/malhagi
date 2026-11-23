// 시험·미리보기용 서버: public/ 파일과 api/vault.js를 Vercel처럼 띄웁니다.
//   node tests/dev-server.js [포트]
//   KV_REST_API_URL이 없으면 가짜 Redis를 씁니다. NO_BACKUP=1이면 저장소 없는 상태(503)를 흉내 냅니다.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockRedis, installMockFetch, MOCK_URL, MOCK_TOKEN } from './mock-redis.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8787);

if (!process.env.KV_REST_API_URL && !process.env.NO_BACKUP) {
  process.env.KV_REST_API_URL = MOCK_URL;
  process.env.KV_REST_API_TOKEN = MOCK_TOKEN;
  installMockFetch(createMockRedis());
}
const api = await import('../api/vault.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const globalHeaders = Object.fromEntries(vercel.headers[0].headers.map((x) => [x.key, x.value]));

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/vault') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      headers.set('x-forwarded-for', req.socket.remoteAddress || '127.0.0.1');
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const fn = api[req.method];
      const out = fn ? await fn(request) : new Response('method', { status: 405 });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) throw new Error('path');
    const st = await stat(file);
    if (!st.isFile()) throw new Error('nofile');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ...globalHeaders });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
