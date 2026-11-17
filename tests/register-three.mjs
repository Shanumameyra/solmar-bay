// Registers the three-hooks resolver for this process.
// Loaded via: node --import ./tests/register-three.mjs <script>
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Idempotent: importing this twice (e.g. via --import and a direct import)
// must not register the hooks twice.
if (!globalThis.__solmarBayThreeRegistered) {
  globalThis.__solmarBayThreeRegistered = true;
  register(pathToFileURL(join(here, 'three-hooks.mjs')).href);
}
