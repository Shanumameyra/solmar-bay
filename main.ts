// main.ts — hands SOLMAR BAY in for make.fun gta6-01.
// Node 22, standard library only, erasable TypeScript: runs as-is under
// `node main.ts`, no flags, no build, no install.
//
// Copies game/ and screenshots/ from this repository to /output (or
// $MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json
// with buildDossier from vendor/makefun-game.ts, using the bounty gate caps.
// Two runs write identical bytes.
//
//   node main.ts
//   MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts   # test run

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The gate's caps (competition.yaml / reference/gate.json, best-game-01's):
// game/ at most 993 files and directories together and 48 MiB in all, each
// path at most 1,000 UTF-8 bytes, game/index.html at most 1 MiB, 3 to 4
// screenshots of at most 256 KiB, the dossier at most 1.5 MiB and its text
// at most 163,840 bytes (160 KiB).
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const repo = dirname(fileURLToPath(import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR || '/output';

// Start from a clean output directory so a stale file can never leak into
// the entry; the grader runs this in a fresh container either way.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(repo, 'game'), join(out, 'game'), { recursive: true });
cpSync(join(repo, 'screenshots'), join(out, 'screenshots'), { recursive: true });

const dossier = buildDossier(out, CAPS);
writeFileSync(join(out, 'dossier.json'), dossier);

console.log(`SOLMAR BAY entry written to ${out} (dossier.json ${dossier.length} bytes)`);
