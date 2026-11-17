// Registers the three-hooks resolver for this process.
// Loaded via: node --import ./tests/register-three.mjs <script>
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(here, 'three-hooks.mjs')).href);
