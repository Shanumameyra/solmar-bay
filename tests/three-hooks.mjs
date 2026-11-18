// Node loader hook: the bare 'three' specifier resolves to the vendored
// three.module.min.js, so headless node tests can import world.js /
// city.js (which import three) with no bundler and no node_modules.
// Registered by register-three.mjs (node --import ./tests/register-three.mjs).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const threePath = join(here, '..', 'game', 'vendor', 'three', 'three.module.min.js');
const threeUrl = pathToFileURL(threePath).href;

// Fail fast with a clear message when the vendored library is missing,
// instead of a cryptic import error deep inside a test run.
if (!existsSync(threePath)) {
  throw new Error(`vendored three.js missing at ${threePath} — the game cannot run headless`);
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: threeUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
