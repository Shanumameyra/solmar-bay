// Solmar Bay — entry point (Node 22, standard library only).
//
// Hands the game in: copies game/ and screenshots/ from this repository
// into the output directory and writes dossier.json there with
// buildDossier from vendor/makefun-game.ts.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Outside the grader MAKEFUN_OUTPUT_DIR stands in for /output; with
// neither set the program writes to /output. The run is deterministic:
// the same repository always produces the same bytes — the output
// directory is wiped first, entries are copied in sorted order, and the
// dossier itself is a pure function of the copied files. Two runs into
// two fresh directories are byte-identical.
//
// Guardrails (the kit gate's, enforced here before the dossier is built):
// game/index.html must exist, and screenshots/ must hold at most 4
// images — buildDossier refuses anything else, and this program fails
// fast with a plain message instead of a half-written output.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-game.ts';

const REPO = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The gate's caps, from the kit's RULES.txt: dossier text 160 KiB, at
// most 4 screenshots of at most 256 KiB each, game/ at most 993 entries
// and 48 MiB, paths at most 1000 UTF-8 bytes.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Copy a tree of plain files and directories, entries in sorted order so
// the walk is deterministic. A symlink or anything that is not a plain
// file or directory is refused: the gate only accepts plain files.
function copyTree(from: string, to: string): { files: number; bytes: number } {
  const st = lstatSync(from);
  if (!st.isDirectory()) throw new Error(`not a directory: ${from}`);
  mkdirSync(to, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    const dst = join(to, name);
    const ent = lstatSync(src);
    if (ent.isDirectory()) {
      const sub = copyTree(src, dst);
      files += sub.files;
      bytes += sub.bytes;
    } else if (ent.isFile()) {
      copyFileSync(src, dst);
      files += 1;
      bytes += ent.size;
    } else {
      throw new Error(`refusing non-file entry: ${src}`);
    }
  }
  return { files, bytes };
}

function countShots(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort();
}

const gameDir = join(REPO, 'game');
const shotsDir = join(REPO, 'screenshots');

if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('game/ is missing from the repository');
}
if (!statSync(join(gameDir, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
  throw new Error('game/index.html is missing — the game has no entry page');
}
if (!statSync(shotsDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error('screenshots/ is missing from the repository');
}
const shots = countShots(shotsDir);
if (shots.length > CAPS.screenshots.max) {
  throw new Error(
    `screenshots/ holds ${shots.length} images, more than the ${CAPS.screenshots.max} the gate allows`,
  );
}

// Fresh output every run: stale files from an earlier run would leak into
// the dossier and break determinism.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const game = copyTree(gameDir, join(OUT, 'game'));
const shotCopy = copyTree(shotsDir, join(OUT, 'screenshots'));

const dossier = buildDossier(OUT, CAPS);
writeFileSync(join(OUT, 'dossier.json'), dossier);

console.log(
  `wrote ${OUT}: game/ ${game.files} files, ${game.bytes} bytes; ` +
    `screenshots/ ${shotCopy.files} files (${shots.join(', ')}); ` +
    `dossier.json ${dossier.length} bytes`,
);
