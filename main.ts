// Solmar Bay — the gta6-01 entry build (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files a desktop
// browser loads offline (game/index.html and its ES modules, three.js vendored
// under game/vendor/three/, no network request), and this program hands it in.
// It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. Put 1-4 JPEG screenshots in screenshots/ (the first by name
// is the cover) and run it.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Run it twice and diff the two outputs: the build is deterministic.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// A screenshot-less entry is refused by the scorer and is a weak entry for the
// judge anyway, so fail loudly instead of handing in an empty folder.
const shotsDir = join(here, 'screenshots');
const shotFiles = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f) && !/^collage\./i.test(f))
  : [];
if (shotFiles.length === 0) {
  throw new Error('screenshots/ is missing or has no PNG/JPEG files — run tests/shots.py first');
}
// The scorer refuses more than 4 screenshots; fail here with a clear
// message instead of handing in an entry it would reject.
if (shotFiles.length > 4) {
  throw new Error(`screenshots/ has ${shotFiles.length} images (max 4) — remove the extras, the first 4 by name are the dossier`);
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
// The entry is useless without its entry point: refuse a broken copy
// instead of handing in a game folder the judge cannot open.
if (!existsSync(join(out, 'game', 'index.html'))) {
  throw new Error('game/index.html missing after copy — the game folder is incomplete');
}
mkdirSync(join(out, 'screenshots'), { recursive: true });
// The collage (collage.jpg) is a repo-only presentation image for the
// author, not a dossier screenshot — keep it out of the submitted
// output so the dossier holds exactly the staged screenshots.
cpSync(shotsDir, join(out, 'screenshots'), {
  recursive: true,
  filter: (src) => !/^collage\./i.test(src.split('/').pop() ?? ''),
});

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
