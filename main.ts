// main.ts — Solmar Bay entry builder (make.fun competition gta6-01).
//
// Copies the game and its screenshots into the output directory and writes
// dossier.json with the kit's buildDossier, byte-identical on every run.
// Node 22 standard library only, no build step, no network.
//
//   MAKEFUN_OUTPUT_DIR=/output node main.ts
//
// The output directory defaults to /output. Only the game/, screenshots/
// and dossier.json entries inside it are touched.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-game.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// The caps the bounty scorer passes to buildDossier (from its gate.json).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function copyEntry(name: string): void {
  const src = join(REPO_ROOT, name);
  const dst = join(OUT_DIR, name);
  if (!existsSync(src)) {
    throw new Error(`missing ${name}/ in ${REPO_ROOT}`);
  }
  // cpSync refuses to copy a symlink target by default; dereference is
  // off, so a symlink inside the tree fails loudly instead of smuggling
  // an outside file into the bundle.
  cpSync(src, dst, { recursive: true, dereference: false });
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(join(OUT_DIR, 'game'), { recursive: true, force: true });
  rmSync(join(OUT_DIR, 'screenshots'), { recursive: true, force: true });
  rmSync(join(OUT_DIR, 'dossier.json'), { force: true });

  copyEntry('game');
  copyEntry('screenshots');

  const dossier = buildDossier(OUT_DIR, CAPS);
  writeFileSync(join(OUT_DIR, 'dossier.json'), dossier);

  console.log(`wrote ${join(OUT_DIR, 'dossier.json')} (${dossier.length} bytes)`);
  console.log(`game/ + screenshots/ copied to ${OUT_DIR}`);
}

main();
