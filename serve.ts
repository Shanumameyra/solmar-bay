// serve.ts — Solmar Bay: a tiny static file server for local playtesting.
// Node 22 standard library only, no dependencies. Serves the game/ folder
// at the web root, so game/index.html opens at http://localhost:8080/ and
// every relative file under game/ resolves exactly as the gate serves it.
//
//   node serve.ts            serves on port 8080
//   node serve.ts 8931       serves on port 8931
//   PORT=8931 node serve.ts  same, via the environment
//
// Nothing here is part of the entry itself (main.ts is the entrypoint);
// this file exists so a human or a test script can open the game locally.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'game');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  try {
    const raw = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    let target = resolve(join(ROOT, raw));
    // Never serve anything outside game/ (no climbing out with ..).
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden\n');
      return;
    }
    if (existsSync(target) && statSync(target).isDirectory()) {
      target = join(target, 'index.html');
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    const type = TYPES[extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(readFileSync(target));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`error: ${err && err.message ? err.message : err}\n`);
  }
});

server.listen(PORT, () => {
  console.log(`Solmar Bay serving game/ at http://localhost:${PORT}/`);
});
