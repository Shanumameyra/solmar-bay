# Solmar Bay — build notes (v4 finisher)

## What v4 is

A fresh rewrite of the whole entry in the v4 recorded session, after v1
and v2 were rejected by the server (`transcripts_witnessed`) and v3 failed
its own check (only 2.1% authored — the worker had read the old files
first, then rewritten them). In v4 the recording was started first, and
the workers wrote every game module fresh from `work/DESIGN.md` only,
without reading any old repo file.

## Integration fixes (finisher)

Worker B's `main.js` wrapped every Worker A factory in defensive
`tryMake`/`tryCall` helpers because the signatures were guessed. The
finisher verified each real signature and rewrote `main.js` with direct
calls — the wrappers are gone, so a wiring bug now fails loudly instead
of silently producing a broken game. Real bugs the wrappers hid:

- `createRenderer()` was called with no canvas, so the renderer drew to
  its own canvas instead of `#game`; now `createRenderer(canvas)`.
- `createPlayerMesh(player, scene, THREE)` passed the scene as the THREE
  namespace, so the player mesh never built; now
  `createPlayerMesh(player, THREE)` and the mesh is added to the scene.
- `createCar(x, z, heading, color)` is not the signature — it is
  `createCar({x, z, heading, kind, color})`; every parked car was being
  built at (0, 0) with no mesh. Now built from an options object, meshed
  with `createCarMesh(car, THREE)`, and added to the scene.
- `createTrafficMeshes(traffic, scene, THREE)` passed the scene as THREE
  and never added meshes to the scene; now
  `createTrafficMeshes(traffic, THREE)` plus an explicit `scene.add` for
  every traffic car and pedestrian mesh.
- `updateCar(S, dt)` in the loop called the car updater with the whole
  state object; driving is done inside `updatePlayer`, which calls
  `updateCar(car, ctl, dt, city)`. The stray call is removed.
- `updateCamera(S, dt)` passed state as the camera, so the camera never
  moved; now `updateCamera(camera, S, dt)`.
- Police `makeCop` used the same positional `createCar` mistake and a
  mesh-less `createCarMesh(car)`; now `createCar({... kind:'police'})`
  plus `createCopMesh(cop, S.THREE)` (light bar with flashing red/blue
  userData, as `flashLightBar` expects). `S.THREE` is set by `main.js`.
- `render.js` treated `shot` mode like the title orbit for every shot,
  so the docks shot would have shown the plaza; now only shot 2 orbits,
  shots 1/3/4 use the player-follow camera, snapped (not lerped) so the
  frame is staged on the very first frame — the shot is declared ready
  after two frames.
- `missions.js` read landmarks from `city.landmarks` (which does not
  exist) and fell back to guessed coordinates — hospital was (100, 90),
  the real one is (120, −120); gunshop (60, −40) vs real (80, 40). Now
  landmarks are read from the top-level keys `buildCity()` returns
  (cafe −20,−10; docks 160,50; beachfront −168,0; garage 0,170;
  safehouse −60,160; precinct 100,−80; hospital 120,−120; gunshop 80,40).
- `player.js` called `S.combat.punch/shoot`, which do not exist on the
  combat state object (they are exported functions); punching and
  shooting did nothing. Now it imports `punch`/`shoot` from combat.js,
  and mirrors weapon/ammo from `S.combat` (the single source of truth).
- `combat.js` skipped pedestrians as targets because traffic peds carry
  no `hp` field (`undefined > 0` is false); an absent hp now means 100.
- `S.audio.sfx/honk/door` did not exist (audio.js exports `sfx(S, name)`);
  `main.js` now attaches them as bound helpers, so the mission jingle,
  honk and door sounds actually play.

## Shot mapping (per brief, not DESIGN.md)

`?shot=1` cover, `?shot=2` title, `?shot=3` onfoot, `?shot=4` mission.
Submitted files are named 2-title / 3-onfoot / 4-mission; 1-hero.jpg is
the entrant-supplied key art resized to 1280×720 (content untouched).

## QA

- `node --import ./tests/register-three.mjs tests/selftest.mjs` — pure
  logic (config, RNG, city, car physics, player, traffic, police
  heat/decay/bust, mission state machine, combat, save/load, effects,
  shots, camera) with a THREE stub via `tests/three-hooks.mjs`.
- `tests/shots.py` — headless Chromium renders shots 2–4, waits for
  `window.__shotReady`, asserts zero console/page errors; resizes the
  hero image with PIL. All screenshots ≤ 256 KiB, 1280×720.
- `tests/playtest.py` — headless play: title → Enter → walk → steal a
  parked car → drive → M1 café → M1 docks pickup; HUD + minimap checked.
- `main.ts` determinism: two runs into fresh directories must be
  byte-identical (`diff -r`).

## Known limits

- No helicopter (scope cut in DESIGN.md — police cars only, more of them).
- Fixed golden hour (17:40); no day/night cycle, for screenshot consistency.
- `window.__GTA` also carries `x`, `z`, `heading`, `inCar`, `step` beyond
  the DESIGN.md field list, so the automated playtest can steer by them.
