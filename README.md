# Solmar Bay — Make GTA 6

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the browser, built for the make.fun **gta6-01 "Make GTA 6"** bounty. You are Dario "D" Cruz, a driver for hire in Solmar Bay — a 400×400 m coastal city at golden hour, 17:40. Run jobs for Mama Rosa, steal cars, dodge the SBPD, and build your cash.

**Original work.** Every line of this game was written for this bounty: the city, the driving and on-foot controls, the police, the missions, the combat, the HUD, the minimap, the audio and the art are all original. No assets, code or levels were copied from any GTA game or any other game. Three.js is vendored as a library only (`game/vendor/three/`).

## How to play

- **Start:** press Enter (or click Start) on the title screen.
- **Move:** WASD to walk (Shift to run), mouse to look. W/S drive a car once you're in one; A/D steer, Shift is the handbrake.
- **Enter / steal a car:** walk up to one and press E. Stealing in front of a pedestrian or a police car raises your wanted level.
- **Missions:** go to Rosa's café (follow the yellow marker) to start a job. Three story missions — *The Pickup* ($300), *Hot Wheels* ($500), *The Getaway* ($800) — plus repeatable taxi fares ($45) and cash pickups ($25).
- **Wanted:** the SBPD chases you with cars (1–5 stars) and on-foot cops (3+ stars). Lose them by staying out of sight for 15 s, then the heat cools one star per 10 s. Get caught and you're Busted (−$200, respawn at the precinct). Die and you're Wasted (−$100, respawn at the hospital).
- **Fight:** F punches, click shoots the pistol (buy ammo at the gun shop, $50 for 12 rounds), R reloads, 1/2 switch weapons. The café and the hospital heal you.
- **Save:** the game autosaves every 30 s and on pause; your cash, mission progress and best cash survive a reload. M mutes, Esc / P pauses.

## Controls

| Key | Action |
| --- | --- |
| WASD | Walk / drive |
| Shift | Run on foot / handbrake while driving |
| Mouse | Look (click to lock the pointer) |
| E | Enter / exit a car |
| F | Punch |
| Click | Shoot (pistol) |
| R | Reload |
| 1 / 2 | Fists / pistol |
| H | Honk (scares pedestrians) |
| M | Mute |
| Esc / P | Pause |

## Run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open http://localhost:8080 and press Enter. No build step, no network — the game is plain static files and the vendored Three.js library.

## Screenshots

Four dossier images, all 1280×720 and under the 256 KiB cap:

1. **1-hero.jpg** — the cover: the silver car, rear view, on the road at golden hour (the maker's image, resized to 1280×720 only).
2. **2-title.jpg** — the title screen over the living city (`?shot=title&seed=7`).
3. **3-onfoot.jpg** — Dario on foot in the market plaza, peds around, the café sign in frame (`?shot=onfoot&seed=7`).
4. **4-mission.jpg** — M1 at the docks: package marker glowing, Rosa's line on the HUD (`?shot=mission&seed=7`).

The in-game shots are staged deterministically (`game/src/shots.js`) from a fresh world with a scripted autopilot, so they reproduce exactly. The 3-star chase (`?shot=chase&seed=7` — yellow sports car, three SBPD cruisers closing in at 86 km/h) is staged the same way and covered by the self-test, even though it is not one of the four dossier files.

## Tech

- Three.js (vendored `three.module.min.js`) for the 3D city: instanced buildings with lit windows, a painted ground texture (asphalt, sidewalks, lane dashes, sand, plaza), the sea, the pier and streetlights; bright golden-hour light (sun 4.2, hemisphere 1.0, exposure 1.32).
- Fixed 1/60 s simulation: player, arcade car physics, traffic loops, pedestrian A* fleeing, police A* pursuit + roadblocks + busts, a 3-mission story chain, taxi jobs, cash pickups, combat, save/load, WebAudio synth (engine hum, sirens, SFX, music pad) and a particle / camera-shake effects layer.
- `main.ts` (Node 22, stdlib only) hands the entry in: it copies `game/` + `screenshots/` to the output directory and writes `dossier.json` with `buildDossier` from `vendor/makefun-game.ts`, deterministically — two runs are byte-identical.

## Tests

```sh
node --import ./tests/register-three.mjs tests/selftest.mjs   # headless: RNG, A*, missions, police, combat, save, shots, dossier caps, main.ts, serve.ts
~/workspace/tools/pw-venv/bin/python tests/shots.py           # retake 2-title / 3-onfoot / 4-mission (needs node serve.ts; 1-hero.jpg is never overwritten)
~/workspace/tools/pw-venv/bin/python tests/playtest.py        # browser playtest: boot, walk, drive, wanted, mission, HUD
```

## License

MIT — see `LICENSE`.
