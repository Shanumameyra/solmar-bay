[![gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun)
[![rank](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/rank.svg)](https://make.fun)
[![reward](https://make.fun/badge/gta6-01/Shanumameyra/solmar-bay/reward.svg)](https://make.fun)

# SOLMAR BAY — Make GTA 6

A tiny open-world crime game set in Solmar Bay, a fictional coastal city at
golden hour (17:40). You are Dario "D" Cruz, just out of the joint. Mama
Rosa, the fixer at the cafe in the Market Plaza, has work for you — if you
can stay ahead of the SBPD.

Built for the [gta6-01 "Make GTA 6"](https://make.fun) competition
($1,666 prize pool). No build step, no network requests, no audio files:
the game is static files under `game/`, Three.js is vendored, and all sound
is synthesised with WebAudio.

## Play

```sh
node serve.ts        # serves the game at http://localhost:8080
```

Open the page, press **Enter**, and go. Your progress autosaves to
localStorage (`solmar-bay-save-v1`).

## Controls

| Key | Action |
| --- | ------ |
| WASD | Move / drive |
| Shift | Run / handbrake |
| Mouse | Look (click to lock the pointer) |
| E | Enter / exit / steal a car |
| F | Punch |
| Click | Shoot (pistol) |
| R | Reload |
| 1 / 2 | Fists / pistol |
| H | Honk |
| M | Mute |
| Esc / P | Pause |
| Enter | Confirm on the title screen |

## The city

Eight by eight blocks, about 400×400 m: Beachfront to the west, Market
Plaza in the centre, Downtown to the north-east, the Port and docks to the
east, the Barrios to the south. On foot you walk at 5 m/s and run at 8 m/s;
cars top out at 38 m/s (46 for the sports car). The police rate you 0–5
stars — steal a car in front of a cop and they will chase you.

## Missions

Rosa hands them out in order from the cafe:

1. **M0 — The Call**: get to Rosa's cafe.
2. **M1 — The Pickup**: drive to the docks, collect the package, bring it
   back to the cafe within 150 s. Pays $300.
3. **M2 — Hot Wheels**: steal the yellow sports car at the beachfront and
   bring it to the garage south of the plaza. Pays $500.
4. **M3 — The Getaway**: reach the safehouse in 150 s with 3 stars on you.
   Pays $800.

Fail a timed mission (or get busted) and you retry from the mission start.
After M3 the city is yours: free roam, taxi jobs, and mission replays at
half reward.

## Screenshots

`shots.json` lists the four entry shots; `tests/shots.py` regenerates them
from the game (the hero frame is the image supplied for the entry, resized
to 1280×720 only).

## Tests

```sh
node tests/selftest.mjs     # logic self-test (Node, no browser)
python3 tests/shots.py      # regenerate the 4 screenshots
python3 tests/playtest.py   # end-to-end playtest: Enter, walk, steal,
                            # drive, M1 complete + paid, HUD, zero errors
```

The game also exposes two hooks for automated testing:
`window.render_game_to_text()` (a JSON snapshot of mode, player, money,
mission and entities) and `window.advanceTime(ms)` (deterministic 1/60 s
stepping, so tests do not depend on frame rate).

## Build

```sh
MAKEFUN_OUTPUT_DIR=/output node main.ts
```

Copies `game/` and `screenshots/` into the output directory and writes
`dossier.json` with the kit's `buildDossier`. Running it twice produces
byte-identical output.

## License

MIT — see [LICENSE](LICENSE).
