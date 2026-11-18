// selftest.mjs — static checks for SOLMAR BAY (no browser needed).
//   node tests/selftest.mjs
// Exits 0 when every check passes, 1 otherwise. Checks:
//   1. every game/src/*.js, main.ts and serve.ts parse (node --check)
//   2. LICENSE starts with the SPDX line
//   3. README carries the three live make.fun badges
//   4. game/index.html exists and loads ./src/main.js as a module
//   5. every relative static/dynamic import in reachable game code names a
//      file that exists under game/
//   6. no http(s) URL in game/index.html or game/src/*.js (offline game)
//   7. shots.json lists the 4 screenshots, each a 1280x720 JPEG <= 256 KiB
//   8. buildDossier runs on the repo and yields a valid dossier
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const gameDir = join(repo, 'game');
const shotsDir = join(repo, 'screenshots');
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- 1. syntax -------------------------------------------------------------
const jsFiles = readdirSync(join(gameDir, 'src'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(gameDir, 'src', f));
for (const f of [...jsFiles, join(repo, 'main.ts'), join(repo, 'serve.ts')]) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    check(`syntax ${f.replace(repo + '/', '')}`, true);
  } catch (e) {
    check(`syntax ${f.replace(repo + '/', '')}`, false, String(e.stderr || e.message).split('\n')[0]);
  }
}

// --- 2. LICENSE ------------------------------------------------------------
const license = readFileSync(join(repo, 'LICENSE'), 'utf8');
check('LICENSE first line is the SPDX identifier', license.split('\n')[0].trim() === 'SPDX-License-Identifier: MIT');
check('LICENSE names the MIT license', license.includes('MIT License'));

// --- 3. README badges ------------------------------------------------------
const readme = readFileSync(join(repo, 'README.md'), 'utf8');
for (const badge of [
  'https://make.fun/badge/gta6-01.svg',
  'https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/rank.svg',
  'https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/reward.svg',
]) {
  check(`README badge ${badge}`, readme.includes(`![`) && readme.includes(`](${badge})`));
}

// --- 4. index.html ---------------------------------------------------------
const indexPath = join(gameDir, 'index.html');
check('game/index.html exists', existsSync(indexPath));
const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
check('index.html loads ./src/main.js as a module', indexHtml.includes('src="./src/main.js"') && indexHtml.includes('type="module"'));
check('index.html has the game canvas', indexHtml.includes('id="game-canvas"'));

// --- 5. imports resolve ----------------------------------------------------
const importRe = /(?:import\s+(?:[^'"]*\s+from\s+)?|export\s+(?:[^'"]*\s+from\s+)?|await\s+import\()\s*['"]([^'"]+)['"]/g;
const resolveRel = (spec, fromFile) => {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // bare/data: not a file ref
  const parts = dirname(fromFile).split('/');
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
};
const reachable = [indexPath, ...jsFiles];
for (const f of reachable) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(importRe)) {
    const target = resolveRel(m[1], f);
    if (target === null) continue;
    check(`import ${m[1]} from ${f.replace(repo + '/', '')} resolves`, existsSync(target), target);
  }
}

// --- 6. offline: no http(s) in page or game source -------------------------
for (const f of [indexPath, ...jsFiles]) {
  const text = readFileSync(f, 'utf8');
  const hit = /https?:\/\//.exec(text);
  check(`no http(s) URL in ${f.replace(repo + '/', '')}`, !hit, hit ? hit[0] : '');
}

// --- 7. screenshots --------------------------------------------------------
function jpegSize(bytes) {
  // Walk JPEG markers to SOF0/SOF2 for width/height.
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  return null;
}
let shotsJson;
try {
  shotsJson = JSON.parse(readFileSync(join(repo, 'shots.json'), 'utf8'));
} catch (e) {
  shotsJson = null;
  check('shots.json parses', false, String(e.message));
}
if (shotsJson) {
  check('shots.json lists 4 shots', Array.isArray(shotsJson.shots) && shotsJson.shots.length === 4);
  for (const shot of shotsJson.shots || []) {
    const p = join(shotsDir, shot.file);
    const ok = existsSync(p);
    check(`screenshot ${shot.file} exists`, ok);
    if (!ok) continue;
    const bytes = readFileSync(p);
    const st = statSync(p);
    check(`${shot.file} <= 256 KiB`, st.size <= 262144, `${st.size} bytes`);
    check(`${shot.file} is JPEG`, bytes[0] === 0xff && bytes[1] === 0xd8);
    const size = jpegSize(bytes);
    check(`${shot.file} is 1280x720`, !!size && size.width === 1280 && size.height === 720, size ? `${size.width}x${size.height}` : 'no SOF');
  }
}

// --- 8. dossier builds -----------------------------------------------------
try {
  const { buildDossier } = await import('../vendor/makefun-game.ts');
  const dossierBytes = buildDossier(repo, CAPS);
  check('buildDossier runs on the repo', true, `${dossierBytes.length} bytes`);
  check('dossier <= 1.5 MiB', dossierBytes.length <= 1572864);
  const dossier = JSON.parse(new TextDecoder().decode(dossierBytes));
  check('dossier schema is makefun/dossier/v1', dossier.schema === 'makefun/dossier/v1');
  check('dossier holds 4 images', Array.isArray(dossier.images) && dossier.images.length === 4);
  check('dossier text <= 163,840 bytes', Buffer.byteLength(dossier.text, 'utf8') <= 163840, `${Buffer.byteLength(dossier.text, 'utf8')} bytes`);
} catch (e) {
  check('buildDossier runs on the repo', false, String(e.message).split('\n')[0]);
}

console.log(failures === 0 ? `\nSELFTEST: ALL PASS` : `\nSELFTEST: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
