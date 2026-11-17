// Node loader hook: resolve the bare 'three' specifier to the vendored
// three.module.min.js, so headless node tests can import world.js / city.js
// (which import three) without a bundler or node_modules.
// Registered by register-three.mjs (node --import ./tests/register-three.mjs).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const threePath = join(here, '..', 'game', 'vendor', 'three', 'three.module.min.js');
const threeUrl = pathToFileURL(threePath).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') {
    return { url: threeUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
