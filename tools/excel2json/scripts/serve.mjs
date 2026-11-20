/**
 * 极简静态服务器：给 web/ 目录用，重点是给出正确的 MIME（pdf.js 的 module worker 必须是 JS MIME）。
 *
 *   node scripts/serve.mjs [端口]
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.argv[2] ?? 8899);
const ROOT = fileURLToPath(new URL('../web/', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      // pdf.js 的 worker 是 module worker，同源即可；这里顺带放宽一下
      'access-control-allow-origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
  console.log(`serving web/ at http://0.0.0.0:${PORT}`);
  for (const ip of ips) console.log(`  局域网: http://${ip}:${PORT}/`);
  console.log(`  本机:   http://127.0.0.1:${PORT}/`);
});
