// serve.ts — static file server for SOLMAR BAY (local play / QA).
// Node 22, standard library only. Serves game/ and nothing else.
//
//   node serve.ts [port] [game-dir]
//   PORT env also works. Default port 8080, default dir ./game.
//
// The finalist review serves game/ with a static server and opens index.html
// in desktop Chrome; this is the same shape: no directory listing, no path
// traversal (every resolved path must stay under the game dir), correct MIME
// types, index.html at /.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const here = fileURLToPath(new URL('.', import.meta.url));
const gameDir = resolve(process.argv[3] || process.env.GAME_DIR || join(here, 'game'));
const port = Number(process.argv[2] || process.env.PORT || 8080);

if (!existsSync(gameDir) || !statSync(gameDir).isDirectory()) {
  console.error(`serve.ts: no game directory at ${gameDir}`);
  process.exit(1);
}
if (!existsSync(join(gameDir, 'index.html'))) {
  console.error(`serve.ts: ${gameDir} holds no index.html`);
  process.exit(1);
}

const server = createServer((req, res) => {
  const raw = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
  const rel = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
  const file = resolve(join(gameDir, rel));
  if (file !== gameDir && !file.startsWith(gameDir + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden\n');
    return;
  }
  let path = file;
  try {
    if (statSync(path).isDirectory()) path = join(path, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  let st;
  try {
    st = statSync(path);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`SOLMAR BAY served at http://127.0.0.1:${port}/  (game dir: ${gameDir})`);
});
