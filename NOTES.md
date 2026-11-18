# NOTES.md — Solmar Bay v5 build notes (18 Nov 2026)

Entry `gta6-01` "Make GTA 6" — SOLMAR BAY, rebuilt fresh for v5.
Recording v5: 01a1ed52 (started ~13:22 WIB). This file is the v5 build log.

## What v5 is

A fresh rebuild from `work/DESIGN.md` + the kit docs. Worker A wrote the
9 core modules (`config`, `random`, `city`, `player`, `vehicle`, `traffic`,
`world`, `input`, `render`); Worker B wrote the 11 system modules
(`main`, `hud`, `save`, `audio`, `effects`, `police`, `missions`, `combat`,
`minimap`, `shots`, plus the boot wiring). The finisher integrated them,
wrote the infra (`main.ts`, `serve.ts`, `LICENSE`, `README.md`,
`shots.json`, `tests/`), and ran the QA below.

## Integration fixes (finisher, this session)

- **A + B never met.** Worker A's modules are pure functions
  (`createWorld(7)`, `updateWorld`, `createGameRenderer`); Worker B's
  `main.js` expected duck-typed factories that did not exist, so its
  fallbacks ran and the player was frozen. Rewired the boot to the real
  world shape, the real renderer, and the real input module; the game loop
  now calls `updateWorld` + police/missions/combat/effects per frame.
- **Spawn moved to (0, 26)** (plaza, 4 m from Rosa's cafe) — the old spawn
  sat nose-against a building and walking north moved 0.5 m in 2 s.
- **Walk-sticking, root cause found:** a plaza palm sits exactly on the
  spawn point in the old layout, and the browser-side stall was a test-env
  artefact — SwiftShader renders the follow-camera view at ~0.5 FPS, and
  the 0.05 s dt clamp turns that into ~1 m/s wall-clock. The game itself
  walks exactly 5 m/s (Node sim: 10.00 m / 2 s; run 16.00 m / 2 s).
  Tests therefore measure in **game time** (`world.time`) and drive the
  simulation with deterministic stepping (see below).
- **Test hooks added to `main.js`:** `window.render_game_to_text()` (JSON
  snapshot: mode, player pos/speed, money, wanted, mission + timer,
  entities, state flags) and `window.advanceTime(ms, render)` (fixed
  1/60 s steps; `render=false` skips WebGL so logic tests run fast).
  The rAF loop can be paused with `window.__setRafPaused(true)`; the
  simulation is then driven purely by `advanceTime`. The loop was split
  so `tick()` simulates only and `frame()` renders once afterwards.
- **Re-entering your own car:** `updateWorld` only looked for parked cars,
  so stepping out stranded the player on foot. Added
  `nearestEnterableCar` (parked, or the player's own stolen car) and made
  `carsStolen` count only real thefts (`wasParked`).
- **Golden-hour sky was inverted:** the warm gradient stops sat below the
  horizon, so the sky read as plain daylight blue. Moved the orange band
  to the horizon (stops 0.45–0.55).
- **Neon signs mirrored:** sign planes faced +z, into their building, so
  the street side read the text backwards (`ROSA'S` → `S'ASOR`). They now
  face north (`rotation.y = π`).
- **Docks were an empty lot:** one container near the marker, no crane.
  Added a fixed 4-container cluster by the M1 package yard plus a gantry
  crane (legs at (190, 27/33), jib + cable + hook), with colliders; the
  marker approach from the west stays open.
- **Shot 2 framing:** cameras south of the plaza look straight through
  the (10, 41) block. The camera now sits on the z=25 street
  (40, 5, 25) with a clear sightline to the cafe; the player stands at
  (18, 28), the staged car at (14, 24), and the ROSA'S sign reads
  correctly.
- **Shot money** ($1,250 cover / $430 on-foot / $150 docks) is deliberate
  staging in `shots.js`, verified static over time — not a bug.
- **Dead code left in `main.js`** (fallback builders, `loadFactory`,
  unused `updateCamera`/`buildCashPickups`, ~25 KB) — intentionally NOT
  removed in v5; removing it after QA would change the dossier text
  budget and risk the seal. A later pass can drop it.

## QA results (18 Nov 2026)

- **selftest** (`node tests/selftest.mjs`): **50/50 PASS** — config,
  world build (10 traffic / 9 parked / 26 peds / 6 pickups), walk 10.00 m
  and run 16.00 m in 2 s, building collision, steal + drive (30.2 m/s,
  46.3 m in 3 s) + exit + re-enter, pickup, M0→M1→paid $300 (money
  150→450), police heat 0→5, save round-trip, shot params, main.js pure
  logic, LICENSE SPDX first line, shots.json, import map, no absolute
  http(s) imports.
- **shots** (`python3 tests/shots.py`): **PASS** — 4 files, all 1280×720
  JPEG ≤256 KiB, 0 console/page errors: 1-hero.jpg 125,515 B (Romi's
  image, resized only), 2-title.jpg 73,827 B (cover, beachfront drive),
  3-onfoot.jpg 90,054 B (plaza, ROSA'S sign, parked car, marker),
  4-mission.jpg 75,868 B (docks, containers + crane, package marker).
  All four visually verified: golden-hour sky, HUD + minimap + objective
  readable, no HUD panel covering the car.
- **playtest** (`python3 tests/playtest.py`): **FAIL — 5 failures, one root
  cause.** Enter starts the game (title→playing, M0→M1); walk 4.87 m/s
  and run 7.70 m/s in game time; walk to the nearest parked car via street
  waypoints; E enter, W drive, E exit, E re-enter — all PASS; drive legs
  to (100, −75), (175, −75), (175, 25) — all PASS; walk into the package
  marker and **package collected (delivery step started)** — PASS; HUD
  (cash, objective, speed, 5 stars, minimap) readable and clear of the
  centre — PASS; **0 console + page errors** — PASS. **Root failure: drive
  to the docks (182, 24) timed out 22.5 m away** (180 s budget, car stuck
  and never closed the last 22.5 m), so the player could not re-enter the
  car at the docks and **M1 did NOT complete — mission stayed M1, money
  stayed $150 (no $300)**. The 4 other failures are cascades of that one
  (re-enter car, drive back, M1 completes, M1 pays). Previous runs failed
  earlier (walk controller drove a straight line through the (10, −41)
  block — fixed with street waypoints + stuck recovery); this run is the
  first to reach the docks leg, and the docks approach is the remaining
  blocker. NOT fixed in v5 — needs a follow-up (drive-controller tuning
  or docks-approach investigation) before the seal.
- **Placeholder scan:** no TODO / lorem / FIXME in game sources,
  `index.html`, README, `main.ts`, `serve.ts`.
- **main.ts:** two runs into separate dirs are byte-identical
  (`dossier.json` 656,409 bytes, `game/` + `screenshots/` copied).

## How to run

```sh
node serve.ts                  # game at http://localhost:8080
node tests/selftest.mjs        # logic self-test
python3 tests/shots.py         # regenerate the 4 screenshots
python3 tests/playtest.py      # end-to-end playtest (M1 + HUD + errors)
MAKEFUN_OUTPUT_DIR=/output node main.ts   # build the entry bundle
```

Screenshots are taken with raw CDP `Page.captureScreenshot` — Playwright's
`page.screenshot()` hangs at 1280×720 under SwiftShader in this VM.
