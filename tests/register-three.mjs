// Registers the three-hooks resolver for this process.
// Loaded via: node --import ./tests/register-three.mjs <script>
// (the --import flag makes node run this file before the test script, so
// the bare 'three' import inside the game resolves to the vendored
// build before any game module is loaded).
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Guard against a double registration (e.g. --import plus a direct
// import of this file): registering the same hooks twice is an error.
if (!globalThis.__solmarBayThreeRegistered) {
  globalThis.__solmarBayThreeRegistered = true;
  register(pathToFileURL(join(here, 'three-hooks.mjs')).href);
}
