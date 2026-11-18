# SOLMAR BAY — build notes (v6)

Entry for make.fun `gta6-01` ("Make GTA 6"). Original open-world crime game,
desktop Chrome, static files, no network, no build step. All art, names,
story, sound and music are original; nothing from Rockstar Games.

## What v6 is

A fresh rebuild from `work/DESIGN.md` in one recorded session, three roles:

- **Worker A** — `game/index.html`, `game/package.json`, `game/src/config.js`,
  `random.js`, `world.js`, `city.js`, `render.js`, `player.js`, `input.js`.
- **Worker B** — `game/src/vehicle.js`, `traffic.js`, `police.js`,
  `missions.js`, `combat.js`, `hud.js`, `minimap.js`, `audio.js`,
  `effects.js`, `save.js`, `shots.js`, `main.js`.
- **Finisher** — this file, `LICENSE`, `README.md`, `main.ts`, `serve.ts`,
  `package.json`, `shots.json`, `tests/*`, plus integration fixes in
  `game/src/main.js` and the screenshots.

## Integration fixes made by the finisher (all in `game/src/main.js`)

1. **Renderer canvas was invisible.** `main.js` created its own WebGL canvas
   and appended it to `<body>` after the full-viewport `#game-canvas`, so the
   render landed below the fold (`top: 720`, clipped by `overflow: hidden`)
   and the visible canvas stayed empty. Fixed: the renderer now uses the
   existing `#game-canvas` element.
2. **On-foot movement was dead.** Worker A's `player.js` exports
   `createPlayer(G)` + `updatePlayer(G, dt)`, but `main.js` only ever called
   `G.player.update(...)`, which the player object does not have — walking
   measured 0.00 m in 2 s in a real browser. Fixed: `main.js` wires
   `player.update = (G, dt) => updatePlayer(G, dt)` from the dynamically
   imported module, and the local input object gained `isDown(code)`, which
   `updatePlayer` calls.
3. **No pedestrians existed.** Nothing ever populated `world.peds`, so the
   city had no people and the shot staging had nobody to place. Fixed: a
   small pedestrian system in `main.js` — 16 stylised peds wandering the
   sidewalks (seeded RNG), fleeing when the player gets close after a punch
   or a shot, in the shape combat/shots expect (`{pos, mesh, flee}`).
4. **Console warning.** `THREE.PCFSoftShadowMap` was removed in the vendored
   three.js build; the renderer now uses `THREE.PCFShadowMap`.

Verified after the fixes (real Chromium, Playwright): real Worker A modules
load (54 box colliders + 57 circle colliders, 97 scene children, 8 parked
cars, player is not the fallback), `window.render_game_to_text()` works,
0 console errors, 0 page errors.

## Key design decisions (from DESIGN.md)

- **M1 never requires driving into the container yard.** The drive stage
  completes at a generous staging radius (30 m) around the open-road point
  (172, 25); the package at (182, 24) is collected **on foot**. The docks
  corridor (x 166–194, z 10–40) and the approach route (street x=175 from
  z=-77, street z=-75 from x=98) are protection zones: no building, prop,
  palm, container, crane leg or parked car inside them. Containers live only
  east of x=193; crane legs only at (195, -20) and (195, 60).
- **Fixed golden hour 17:40** for screenshot consistency; no day cycle.
- **Deterministic shots.** `?shot=1..4&seed=7` stages each scene from a
  fresh world, paints twice, then sets `window.__shotReady`.
- **Debug handles.** `window.__GTA` (mode/money/wanted/mission/speed/player),
  `window.render_game_to_text()`, `window.advanceTime(ms)` (fixed 1/60 s
  steps), `window.__GTA_BOOT` (the whole `G` object).

## Missions

- M0 — Rosa calls: walk to the café (0, 0). Spawn is (0, 60), a straight
  walk north.
- M1 "The Pickup" — drive to the docks staging point, walk in, collect the
  package (182, 24), deliver back to the café within 150 s. Reward $300.
- M2 "Hot Wheels" — steal the yellow sports car at the beachfront
  (-150, -60), bring it to the garage (-40, 150). Reward $500. Stealing it
  is 2 stars immediately.
- M3 "The Getaway" — reach the safehouse (-100, 150) in 150 s with 3 stars
  and 3 cruisers chasing. Reward $800.
- After M3: free roam + repeatable taxi jobs. Fail (timer / busted) retries
  from the mission start, cash kept.

## Places (world coordinates, metres)

| Place | x, z |
| --- | --- |
| Spawn | 0, 60 |
| Café — Mama Rosa | 0, 0 |
| Docks staging / package | 172, 25 / 182, 24 |
| Garage | -40, 150 |
| Safehouse (barrios) | -100, 150 |
| Sports car (beachfront) | -150, -60 |
| Precinct (busted respawn) | 60, 100 |
| Hospital (wasted respawn) | 150, -100 |

## Screenshots

| File | What |
| --- | --- |
| `screenshots/1-hero.jpg` | Cover: rear view of the silver hero car (photo, resized to 1280×720 only) |
| `screenshots/2-title.jpg` | Game render, `?shot=2&seed=7` — Dario on foot in the plaza |
| `screenshots/3-onfoot.jpg` | Game render, `?shot=3&seed=7` — 3-star chase, SBPD behind |
| `screenshots/4-mission.jpg` | Game render, `?shot=4&seed=7` — M1 package marker at the docks |

All four are 1280×720 JPEG, each ≤ 256 KiB. Captured with
`tests/shots.py` (Playwright, waits for `window.__shotReady`).

## Run / test

```sh
node serve.ts                    # http://127.0.0.1:8080, serves game/
node tests/selftest.mjs          # static checks
python3 tests/playtest.py        # Playwright: Enter, walk speed, E, M1 end-to-end
python3 tests/shots.py           # Playwright: recapture screenshots 2–4
MAKEFUN_OUTPUT_DIR=/tmp/out node main.ts   # build the entry dossier (test run)
```

## Hand-in

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to `/output` (or `$MAKEFUN_OUTPUT_DIR`) and writes `/output/dossier.json`
with `buildDossier` from `vendor/makefun-game.ts`, using the bounty gate caps:
text 163,840 bytes; screenshots max 4 × 256 KiB; game max 993 entries and
48 MiB; paths max 1,000 bytes. Two runs write identical bytes.
