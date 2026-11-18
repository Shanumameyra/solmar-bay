# SOLMAR BAY

[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/competitions/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/rank.svg)](https://make.fun/competitions/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/reward.svg)](https://make.fun/competitions/gta6-01)

An original open-world crime game in a sun-soaked coastal city, in the spirit
of GTA 6 — built entirely from scratch, with nothing borrowed from Rockstar
Games or any other commercial game.

You are **Dario "D" Cruz**, 28, a getaway driver who owes money to the wrong
people. **Mama Rosa**, who runs a café in the market plaza, has one last job
for you. Steal the car. Grab the package. Outrun the SBPD. Get free.

## The city

**Solmar Bay** is a fictional coastal city, ~400×400 m, 8×8 blocks: a
beachfront with a pier and palms to the west, the market plaza and Rosa's café
at the centre, downtown towers with neon to the north-east, the port and
container docks to the east, and the colourful barrios to the south. Fixed
golden hour (17:40) — warm light, long shadows.

## What you can do

- **Explore on foot or by car** — walk (5 m/s), run (8 m/s), drive arcade
  physics cars (top speed 38 m/s, sports 46 m/s) with handbrake drift.
- **Steal any parked car** (E) — stealing in view of police or pedestrians
  raises your wanted level.
- **Outrun the SBPD** — wanted stars 0–5, patrol cars that chase, ram and
  roadblock, busted respawns at the precinct, decay when you break line of
  sight.
- **Run missions for Mama Rosa** — M0 intro call, M1 "The Pickup" (docks
  package, $300), M2 "Hot Wheels" (steal the yellow sports car, $500), M3
  "The Getaway" (3-star escape to the safehouse, $800), then free roam with
  repeatable taxi fares.
- **Fight** — fists (F) and a 12-round pistol (click, R reload), police and
  pedestrians react, medkits at the café and the hospital.
- **Live city** — 10 traffic cars following street loops and stopping at red
  lights, pedestrians on the sidewalks, cash pickups, a HUD with cash,
  wanted stars, health, weapon, speed, clock, objective and a live minimap.
- **Sound, all synthesized** (WebAudio, no files) — engine, sirens, gunshots,
  jingles, and a slow chord pad. M mutes.
- **Save** — progress (money, mission, stats) in `localStorage`, autosaved
  every 30 s and on mission complete, bust or pause.

## Controls (desktop Chrome, keyboard + mouse)

| Key | Action |
| --- | --- |
| WASD | Move / drive (W accel, S brake/reverse, A/D steer) |
| Shift | Run / handbrake |
| Mouse | Look (click canvas to lock) |
| E | Enter / exit car, steal car |
| F | Punch |
| Left click | Shoot pistol (when armed) |
| R | Reload |
| 1 / 2 | Fists / pistol |
| H | Honk |
| M | Mute |
| Esc / P | Pause |
| Enter | Confirm on title screen |

## Play it

No build step, no network: the game is static files under `game/`.

```sh
node serve.ts            # serves game/ on http://127.0.0.1:8080
```

Then open <http://127.0.0.1:8080/> in desktop Chrome and press Enter.

## Tests

```sh
node tests/selftest.mjs   # static checks: syntax, files, LICENSE, screenshots
python3 tests/playtest.py # Playwright: Enter, walking speed, car enter/exit, M1 end-to-end
python3 tests/shots.py    # Playwright: captures screenshots 2-4 from the game
```

## Layout

```
game/
  index.html            page + HUD + title/pause/busted/wasted screens
  src/
    config.js           tuning + key places (spawn, café, docks, garage…)
    random.js           deterministic RNG (seed 7)
    world.js            ground, sky, fog, lights, colliders, protected routes
    city.js             buildings, neon, palms, stalls, containers, crane
    render.js           renderer + chase camera helpers
    player.js           Dario on foot (walk/run, collision slide)
    input.js            keyboard + mouse input
    vehicle.js          arcade car physics + car factory
    traffic.js          10 traffic cars + 8 stealable parked cars
    police.js           wanted stars, chase, ram, busted, decay
    missions.js         M0–M3 story + taxi jobs
    combat.js           fists, pistol, damage, medkits, wasted
    hud.js              cash, stars, health, objective, feed, screens
    minimap.js          live 160×160 minimap
    audio.js            WebAudio synth: engine, siren, SFX, music
    effects.js          smoke, sparks, muzzle flash
    save.js             localStorage save / load
    shots.js            deterministic ?shot=1..4 staging for screenshots
    main.js             boot + fixed-step loop + debug handles
  vendor/three/         three.js (vendored, minified)
screenshots/             1-hero.jpg (cover) + 2-title, 3-onfoot, 4-mission
main.ts                 hands the entry in: copies game/ + screenshots/ to
                        /output and writes /output/dossier.json
serve.ts                static server for local play / QA
```

## License

MIT — see [LICENSE](LICENSE). All names, characters, art, story, sound and
music are original. No Rockstar Games content.
