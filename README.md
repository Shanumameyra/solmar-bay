# Solmar Bay — a GTA-style open-world game for make.fun `gta6-01`

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/reward.svg)](https://make.fun/bounty/gta6-01)

An original open-world crime game in a sun-soaked coastal city: steal cars,
dodge the cops, run jobs for a fixer, and make it out rich. GTA in spirit,
100% original content — no Rockstar names, logos, characters, maps or assets.

- **Game:** SOLMAR BAY. **City:** Solmar Bay — beachfront, pier, market
  plaza, port/docks, downtown towers, barrios.
- **Protagonist:** Dario "D" Cruz, 28, a getaway driver who owes money to the
  wrong people. **Fixer:** Mama Rosa, who runs a café in the market plaza.
- **Pressure:** the Solmar Bay Police Department (SBPD) — wanted stars,
  patrol cars, roadblocks, busted.

## Play it

Serve `game/` and open it in a desktop browser (keyboard + mouse, no
network request, everything offline, three.js vendored under `game/`):

```sh
node serve.ts
# open http://localhost:8080
```

Or open `game/index.html` directly from any static file server.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive (W accel, S brake/reverse, A/D steer) |
| Shift | Run / handbrake |
| Mouse | Look (click canvas for pointer lock) |
| E | Enter / exit car, steal a parked car |
| F | Punch |
| Left click | Shoot pistol (when armed) |
| R | Reload |
| 1 / 2 | Fists / pistol |
| B | Buy ammo ($50, at the gun shop) |
| H | Honk |
| M | Mute |
| Esc / P | Pause |
| Enter | Confirm on the title screen |

## The game

- **City:** 8×8 blocks, ~400×400 m — beachfront avenue and pier, market
  plaza with stalls and Rosa's café, downtown towers with neon signs,
  port/docks with containers and cranes, colourful barrios.
- **Driving:** arcade physics (accel, top speed, braking, reverse,
  handbrake drift, damage and smoke), 10 traffic cars that follow street
  loops and stop at red lights, 8 stealable parked cars, 24 pedestrians.
- **Wanted + police:** 0–5 stars. Stealing, hitting peds, shooting and
  speeding raise heat; 15 s out of sight starts a cooldown. Police chase,
  ram, and set roadblocks at 3+ stars. Get busted and you lose $200 and
  wake up at the precinct.
- **Missions (Mama Rosa):** M0 intro at the café → M1 "The Pickup"
  (docks, 150 s, $300) → M2 "Hot Wheels" (steal the yellow sports car at
  the beachfront, $500) → M3 "The Getaway" (reach the safehouse with
  3 stars on you, $800) → free roam with repeatable taxi jobs and mission
  replays at half reward.
- **Combat:** fists (15 dmg) and a 12-round pistol (25 dmg, falloff past
  30 m), ammo at the gun shop, medkits at the café and hospital.
- **HUD + minimap:** cash, wanted stars, health, weapon/ammo, objective
  + distance, speed, the 17:40 golden-hour clock, a message feed, and a
  160×160 north-up minimap (streets, beach, player arrow, traffic,
  police blips, mission marker).
- **Audio:** all WebAudio synth, no files — engine hum, two-tone siren,
  chord pad (Am–F–C–G), gunshot/punch/pickup/jingle/busted/honk SFX.
- **Save:** `localStorage` key `solmar-bay-save-v1` (with `.bak` fallback):
  money, mission progress, stats, mute. Continue on the title screen.

## Screenshots

Deterministic staged shots, `?shot=1..4&seed=7` — the game exposes
`window.__GTA` (`shotReady`, `screen`, `wanted`, `money`, `mission`,
`step`, `speed`, `x`, `z`, `heading`, `inCar`) and sets
`window.__shotReady` after staging each shot.

| File | Shot |
| --- | --- |
| `screenshots/1-hero.jpg` | Key art supplied by the entrant, resized to 1280×720 |
| `screenshots/2-title.jpg` | `?shot=2` — title screen over the city |
| `screenshots/3-onfoot.jpg` | `?shot=3` — Dario on foot in the market plaza |
| `screenshots/4-mission.jpg` | `?shot=4` — M1 at the docks |

## Layout

```text
game/                 the playable game (static files, offline)
  index.html          page, HUD, title/pause/busted/wasted screens
  src/                one module per system
    config.js random.js city.js render.js vehicle.js player.js
    traffic.js input.js police.js missions.js combat.js hud.js
    minimap.js audio.js save.js effects.js shots.js main.js
  vendor/three/       vendored three.js (module + core builds)
screenshots/          4 JPEGs, each ≤ 256 KiB, 1280×720
tests/                node selftest + headless-browser shots/playtest
main.ts               entry program: copies game/ + screenshots/ to
                      /output and writes /output/dossier.json
serve.ts              static server for game/ on localhost:8080
shots.json            the 4 screenshot definitions
```

## Tests

```sh
node --import ./tests/register-three.mjs tests/selftest.mjs   # pure-logic, no browser
python3 tests/shots.py    # headless render of shots 2-4 + hero resize, 0 console errors
python3 tests/playtest.py # headless play: title -> walk -> steal car -> drive -> M1
```

## Handing in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # writes out/dossier.json
```

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Shanumameyra.
