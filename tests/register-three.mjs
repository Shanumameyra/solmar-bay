// Registers tests/three-hooks.mjs so `import ... from 'three'` in the game
// sources resolves to the in-memory stub during the Node selftest.
// Usage: node --import ./tests/register-three.mjs tests/selftest.mjs
import { register } from 'node:module';

register('./three-hooks.mjs', import.meta.url);
