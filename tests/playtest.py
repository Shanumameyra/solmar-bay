"""SOLMAR BAY — Playwright playtest (real Chromium, real keyboard input).

Starts serve.ts, loads the game, and plays M1 end-to-end:
  title -> Enter -> walk to cafe (M0) -> walk to parked car -> E enter ->
  drive to docks -> E exit -> walk to package -> walk back -> E enter ->
  drive back -> walk to cafe -> M1 complete +$300.
Then verifies the (c) behaviours: G.police.addWanted, busted -> precinct
(60,100), wasted -> hospital (150,-100), steering direction.

Game time is advanced with window.advanceTime (fixed 1/60 s steps, the real
game code) because headless SwiftShader renders at ~2-5 fps and the game's
own loop caps at 5 steps/frame; wall-clock driving would take 5x longer.
Inputs are real Playwright keyboard state, read by the real input handler.

Usage: python3 tests/playtest.py [--keep-server]
Exit 0 = PLAYTEST 0 FAILURE, 1 = any failure.
"""
import json
import math
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PORT = 8931
BASE = f"http://127.0.0.1:{PORT}"

FAILURES = []
LOG = []


def log(msg):
    LOG.append(msg)
    print(msg, flush=True)


def check(name, ok, detail=""):
    log(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)
    return ok


def norm(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


class Game:
    def __init__(self, page):
        self.pg = page
        self.held = set()
        self.game_ms = 0
        self.errors = []
        self.page_errors = []

    def state(self):
        return json.loads(self.pg.evaluate("() => window.render_game_to_text()"))

    def gta(self):
        return self.pg.evaluate("() => window.__GTA")

    def boot(self):
        return self.pg.evaluate("() => window.__GTA_BOOT")

    def advance(self, ms):
        self.pg.evaluate(f"() => window.advanceTime({int(ms)})")
        self.game_ms += ms

    def set_keys(self, want):
        want = set(want)
        for k in sorted(self.held - want):
            self.pg.keyboard.up(k)
        for k in sorted(want - self.held):
            self.pg.keyboard.down(k)
        self.held = want

    def release_all(self):
        self.set_keys(set())

    def press(self, key):
        self.pg.keyboard.press(key)

    def vehicles(self):
        return self.pg.evaluate(
            "() => window.__GTA_BOOT.vehicles.map(c => "
            "({x: c.pos.x, z: c.pos.z, parked: !!c.parked, driver: c._driver || null}))"
        )

    def nearest_car(self, x, z):
        best, bestd = None, 1e9
        for c in self.vehicles():
            d = math.hypot(c["x"] - x, c["z"] - z)
            if d < bestd:
                best, bestd = c, d
        return best, bestd


def walk_to(g, tx, tz, radius=3.0, budget_ms=90000, label="walk"):
    """On-foot autopilot: W + A/D steering toward the target. Returns (ok, secs)."""
    start = g.game_ms
    last = None
    stuck_since = None
    sidestep_until = 0
    while g.game_ms - start < budget_ms:
        s = g.state()
        p = s["player"]
        d = math.hypot(tx - p["x"], tz - p["z"])
        if d <= radius:
            g.release_all()
            return True, (g.game_ms - start) / 1000.0
        bearing = math.atan2(tx - p["x"], tz - p["z"])
        diff = norm(bearing - p["heading"])
        keys = {"w"}
        if g.game_ms < sidestep_until:
            keys = {"d"}
        elif diff > 0.15:
            keys.add("a")
        elif diff < -0.15:
            keys.add("d")
        g.set_keys(keys)
        g.advance(250)
        now = (p["x"], p["z"])
        if last and math.hypot(now[0] - last[0], now[1] - last[1]) < 0.05:
            if stuck_since is None:
                stuck_since = g.game_ms
            elif g.game_ms - stuck_since > 5000:
                log(f"  [{label}] stuck at ({p['x']:.1f},{p['z']:.1f}), sidestepping")
                sidestep_until = g.game_ms + 800
                stuck_since = None
        else:
            stuck_since = None
        last = now
    g.release_all()
    s = g.state()
    log(f"  [{label}] TIMEOUT at ({s['player']['x']:.1f},{s['player']['z']:.1f}), "
        f"target ({tx},{tz}), stage={s['mission']['stage']}")
    return False, (g.game_ms - start) / 1000.0


def stop_car(g, budget_ms=8000):
    """Brake (then coast) until the car is (nearly) stationary."""
    start = g.game_ms
    while g.game_ms - start < budget_ms:
        s = g.state()
        if abs(s["player"]["speed"]) < 0.5:
            g.release_all()
            return True
        if abs(s["player"]["speed"]) < 2.0:
            g.release_all()  # coast to a stop on drag; holding S would reverse
        else:
            g.set_keys({"s"})
        g.advance(100)
    g.release_all()
    return abs(g.state()["player"]["speed"]) < 1.0


def drive_to(g, waypoints, budget_ms=150000, label="drive"):
    """Driving autopilot along street waypoints. Returns (ok, secs)."""
    start = g.game_ms
    wi = 0
    last_pos = None
    stuck_since = None
    reverse_until = 0
    last_wp_dist = None
    last_wp_progress = g.game_ms
    while g.game_ms - start < budget_ms:
        s = g.state()
        p = s["player"]
        if not p["inCar"]:
            g.release_all()
            log(f"  [{label}] no longer in car at ({p['x']:.1f},{p['z']:.1f})")
            return False, (g.game_ms - start) / 1000.0
        tx, tz = waypoints[wi]
        d = math.hypot(tx - p["x"], tz - p["z"])
        if d < 8:
            wi += 1
            if wi >= len(waypoints):
                g.release_all()
                return True, (g.game_ms - start) / 1000.0
            last_wp_dist = None
            last_wp_progress = g.game_ms
            continue
        # Progress watchdog: the distance to the waypoint must shrink over
        # time; a car circling or wedged makes no progress even while moving.
        if last_wp_dist is None or d < last_wp_dist - 1.0:
            last_wp_dist = d
            last_wp_progress = g.game_ms
        elif g.game_ms - last_wp_progress > 8000:
            log(f"  [{label}] no progress toward waypoint {wi} ({d:.0f} m away), reversing out")
            reverse_until = g.game_ms + 1200
            last_wp_progress = g.game_ms
            last_wp_dist = d
        bearing = math.atan2(tx - p["x"], tz - p["z"])
        diff = norm(bearing - p["heading"])
        speed = abs(p["speed"])
        keys = set()
        if g.game_ms < reverse_until:
            keys = {"s", "a" if diff > 0 else "d"}
        else:
            # Slow down for big turns: a fast car cannot hit a close waypoint
            # and ends up oscillating past it. Brake first, then turn.
            if abs(diff) > 2.0 and speed > 3:
                keys.add("s")
            elif abs(diff) > 1.0 and speed > 8:
                keys.add("s")
            else:
                keys.add("w")
            if diff > 0.12:
                keys.add("a")
            elif diff < -0.12:
                keys.add("d")
        g.set_keys(keys)
        g.advance(250)
        now = (p["x"], p["z"])
        if last_pos and math.hypot(now[0] - last_pos[0], now[1] - last_pos[1]) < 0.05:
            if stuck_since is None:
                stuck_since = g.game_ms
            elif g.game_ms - stuck_since > 4000:
                log(f"  [{label}] stuck at ({p['x']:.1f},{p['z']:.1f}), reversing out")
                reverse_until = g.game_ms + 1200
                stuck_since = None
        else:
            stuck_since = None
        last_pos = now
    g.release_all()
    s = g.state()
    log(f"  [{label}] TIMEOUT at ({s['player']['x']:.1f},{s['player']['z']:.1f}), "
        f"waypoint {wi}/{len(waypoints)}, stage={s['mission']['stage']}")
    return False, (g.game_ms - start) / 1000.0


def enter_car(g, label="enter"):
    """Press E and wait for the 0.4 s door animation. Returns inCar."""
    for _ in range(12):
        g.press("e")
        g.advance(200)
        if g.state()["player"]["inCar"]:
            return True
    return g.state()["player"]["inCar"]


def exit_car(g, label="exit"):
    for _ in range(12):
        g.press("e")
        g.advance(200)
        if not g.state()["player"]["inCar"]:
            return True
    return not g.state()["player"]["inCar"]


def main():
    server = subprocess.Popen(
        ["node", "serve.ts", str(PORT)], cwd=REPO,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "/index.html", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        else:
            print("FAIL  serve.ts did not answer")
            return 1

        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
            page = browser.new_page(viewport={"width": 640, "height": 360})
            g = Game(page)
            page.on("console", lambda m: g.errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: g.page_errors.append(str(e)))
            page.add_init_script("localStorage.clear()")
            page.goto(BASE + "/index.html")
            page.wait_for_timeout(3500)
            page.wait_for_function("() => !!window.__GTA_BOOT", timeout=15000)

            # --- integration state: real modules, not fallbacks ----------------
            info = page.evaluate("""() => {
              const G = window.__GTA_BOOT;
              let meshes = 0, instanced = 0;
              G.scene.traverse(o => { if (o.isInstancedMesh) instanced++; else if (o.isMesh) meshes++; });
              return {
                fallbackPlayer: !!G.player._isFallback,
                hasUpdate: typeof G.player.update === 'function',
                colliders: G.world.colliders.length,
                circleColliders: (G.world.circleColliders || []).length,
                hasIsBlocked: typeof G.world.isBlocked === 'function',
                meshes, instanced,
                peds: (G.world.peds || []).length,
                parked: (G.traffic && G.traffic.parked.length) || 0,
                traffic: (G.traffic && G.traffic.cars.length) || 0,
                textHook: typeof window.render_game_to_text === 'function',
                advanceHook: typeof window.advanceTime === 'function',
                addWanted: typeof (G.police && G.police.addWanted) === 'function',
              };
            }""")
            log(f"boot: {json.dumps(info)}")
            check("real player (not fallback)", not info["fallbackPlayer"])
            check("player.update wired (Worker A updatePlayer)", info["hasUpdate"])
            check("real world: colliders present", info["colliders"] > 20, f"{info['colliders']} box + {info['circleColliders']} circle")
            check("world.isBlocked present (real world.js)", info["hasIsBlocked"])
            check("city rendered: meshes present", info["meshes"] > 30 and info["instanced"] >= 3,
                  f"{info['meshes']} meshes, {info['instanced']} instanced")
            check("pedestrians exist", info["peds"] >= 10, f"{info['peds']} peds")
            check("traffic + parked cars", info["traffic"] == 10 and info["parked"] == 8)
            check("render_game_to_text + advanceTime exposed", info["textHook"] and info["advanceHook"])
            check("G.police.addWanted exists", info["addWanted"])

            # --- 1. title -> Enter --------------------------------------------
            s = g.state()
            check("starts on title screen", s["mode"] == "title", s["mode"])
            title_visible = page.evaluate(
                "() => getComputedStyle(document.getElementById('title-screen')).display !== 'none'")
            check("title screen visible", title_visible)
            page.screenshot(path="/tmp/playtest-1-title.png")
            g.press("Enter")
            g.advance(400)
            s = g.state()
            check("Enter starts the game", s["mode"] == "playing", s["mode"])
            title_hidden = page.evaluate(
                "() => getComputedStyle(document.getElementById('title-screen')).display === 'none'")
            check("title screen hides after Enter", title_hidden)

            # --- 2. walking speed (game time) ----------------------------------
            p0 = g.state()["player"]
            g.set_keys({"w"})
            g.advance(2000)
            g.release_all()
            p1 = g.state()["player"]
            dist = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
            check("WASD walk >= ~5 m/s", dist >= 9.0, f"{dist:.2f} m in 2.0 game-s = {dist/2:.2f} m/s")

            # --- 3. M0: walk to the cafe ---------------------------------------
            ok, secs = walk_to(g, 0, 0, radius=3.5, budget_ms=60000, label="M0 walk to cafe")
            s = g.state()
            check("M0: reach Rosa's cafe", ok and s["mission"]["stage"] == "drive-docks",
                  f"{secs:.1f} game-s, stage={s['mission']['stage']}, mission={s['mission']['index']}")
            page.screenshot(path="/tmp/playtest-2-cafe.png")

            # --- 4. walk to parked car, E to enter ------------------------------
            car, d = g.nearest_car(s["player"]["x"], s["player"]["z"])
            log(f"nearest parked car at ({car['x']:.1f},{car['z']:.1f}), {d:.1f} m away")
            ok, secs = walk_to(g, car["x"], car["z"], radius=3.0, budget_ms=60000, label="walk to car")
            check("walk to parked car", ok, f"{secs:.1f} game-s")
            in_car = enter_car(g)
            s = g.state()
            check("E enters the car", in_car, f"inCar={s['player']['inCar']}")
            log(f"  wanted after steal: {s['wanted']} star(s) (witnessed steal is +1 by design)")
            page.screenshot(path="/tmp/playtest-3-incar.png")

            # --- 5. steering direction: A = left, D = right --------------------
            g.set_keys({"w"})
            g.advance(1500)
            h0 = g.state()["player"]["heading"]
            g.set_keys({"w", "a"})
            g.advance(1000)
            h1 = g.state()["player"]["heading"]
            g.set_keys({"w", "d"})
            g.advance(1000)
            h2 = g.state()["player"]["heading"]
            g.release_all()
            d_left = norm(h1 - h0)
            d_right = norm(h2 - h1)
            check("steer A turns left (heading increases)", d_left > 0.08, f"Δheading {d_left:+.2f} rad")
            check("steer D turns right (heading decreases)", d_right < -0.08, f"Δheading {d_right:+.2f} rad")
            # Stop before the drive: a fast car heading the wrong way cannot
            # hit a close waypoint and ends up oscillating past it.
            stopped = stop_car(g)
            check("car stops after steering test", stopped,
                  f"speed={g.state()['player']['speed']:.1f} m/s")

            # --- 6. M1 drive: car -> docks staging ------------------------------
            m1_ok = False
            ok, secs = drive_to(g, [(25, 25), (175, 25)], budget_ms=150000, label="M1 drive to docks")
            s = g.state()
            m1_ok = ok and s["mission"]["stage"] == "pickup"
            check("M1: drive reaches docks staging", m1_ok,
                  f"{secs:.1f} game-s, stage={s['mission']['stage']}, pos=({s['player']['x']:.1f},{s['player']['z']:.1f})")
            page.screenshot(path="/tmp/playtest-4-docks.png")

            if m1_ok:
                # --- 7. exit, walk to the package on foot ---------------------------
                out = exit_car(g)
                check("E exits the car at the docks", out)
                ok, secs = walk_to(g, 182, 24, radius=3.0, budget_ms=60000, label="walk to package")
                s = g.state()
                timer = page.evaluate("() => window.__GTA_BOOT.missions.timer")
                m1_ok = ok and s["mission"]["stage"] == "deliver"
                check("M1: package collected on foot", m1_ok,
                      f"{secs:.1f} game-s, stage={s['mission']['stage']}, timer={timer:.0f}s / 150s")

            if m1_ok:
                # --- 8. walk back, re-enter, drive back ------------------------------
                p = s["player"]
                car, d = g.nearest_car(p["x"], p["z"])
                log(f"car is {d:.1f} m away at ({car['x']:.1f},{car['z']:.1f})")
                ok, secs = walk_to(g, car["x"], car["z"], radius=3.0, budget_ms=60000, label="walk back to car")
                m1_ok = ok
                check("walk back to the car", ok, f"{secs:.1f} game-s")
            if m1_ok:
                in_car = enter_car(g)
                m1_ok = in_car
                check("E re-enters the car", in_car)
            if m1_ok:
                ok, secs = drive_to(g, [(25, 25), (25, 5)], budget_ms=150000, label="M1 drive back")
                s = g.state()
                m1_ok = ok
                check("M1: drive back near the cafe", ok, f"{secs:.1f} game-s, pos=({s['player']['x']:.1f},{s['player']['z']:.1f})")
                page.screenshot(path="/tmp/playtest-5-return.png")

            if m1_ok:
                # --- 9. exit, walk to cafe -> M1 complete ----------------------------
                out = exit_car(g)
                check("E exits the car near the cafe", out)
                money_before = g.state()["money"]
                ok, secs = walk_to(g, 0, 0, radius=4.0, budget_ms=60000, label="walk to cafe (deliver)")
                g.advance(800)  # let the toast + save land
                s = g.state()
                check("M1 COMPLETE: mission advances to M2", ok and s["mission"]["index"] == 2,
                      f"{secs:.1f} game-s, mission={s['mission']['index']}, stage={s['mission']['stage']}")
                check("M1 pays +$300", s["money"] == money_before + 300,
                      f"${money_before} -> ${s['money']}")
                page.screenshot(path="/tmp/playtest-6-m1done.png")
            else:
                check("M1 COMPLETE: mission advances to M2", False, "M1 chain failed earlier — see above")
                check("M1 pays +$300", False, "M1 chain failed earlier — see above")
            log(f"M1 total game time: {g.game_ms/1000:.1f} s (advanceTime ms; rAF loop adds more)")

            # The (c) checks need the player on foot.
            if g.state()["player"]["inCar"]:
                exit_car(g)

            # --- 10. (c) addWanted ----------------------------------------------
            stars = page.evaluate(
                "() => { const G = window.__GTA_BOOT; G.police.addWanted(G, 1); return G.police.stars; }")
            check("G.police.addWanted raises stars", stars == 1, f"stars={stars}")
            page.evaluate("() => { const G = window.__GTA_BOOT; G.police.stars = 0; G.state.wanted = 0; }")
            g.advance(500)

            # --- 11. (c) busted -> precinct (60,100), real chase path ------------
            page.evaluate("""() => {
              const G = window.__GTA_BOOT;
              G.police.stars = 2; G.state.wanted = 2;
            }""")
            g.advance(3000)  # let cruisers spawn
            page.evaluate("""() => {
              const G = window.__GTA_BOOT;
              const c = G.police.cars[0];
              if (c) { c.pos.set(G.player.pos.x + 1, 0, G.player.pos.z); c.speed = 0; }
            }""")
            g.advance(3500)
            s = g.state()
            busted = s["mode"] == "busted" or (abs(s["player"]["x"] - 60) < 2 and abs(s["player"]["z"] - 100) < 2)
            check("busted by SBPD on foot -> precinct (60,100)", busted,
                  f"mode={s['mode']}, pos=({s['player']['x']:.1f},{s['player']['z']:.1f})")
            g.advance(2500)  # busted screen countdown
            s = g.state()
            check("play resumes after busted", s["mode"] == "playing", s["mode"])

            # --- 12. (c) wasted -> hospital (150,-100), real damagePlayer --------
            res = page.evaluate("""async () => {
              const G = window.__GTA_BOOT;
              const m = await import('./src/combat.js');
              const before = G.state.money;
              m.damagePlayer(G, 200);
              return { mode: G.state.mode, x: G.player.pos.x, z: G.player.pos.z,
                       money: G.state.money, lost: before - G.state.money };
            }""")
            check("wasted (HP 0) -> hospital (150,-100)", res["mode"] == "wasted"
                  and abs(res["x"] - 150) < 2 and abs(res["z"] + 100) < 2,
                  f"mode={res['mode']}, pos=({res['x']:.1f},{res['z']:.1f}), -${res['lost']}")
            g.advance(2500)
            s = g.state()
            check("play resumes after wasted", s["mode"] == "playing", s["mode"])

            # --- 13. console / page errors ---------------------------------------
            check("0 console errors in all scenarios", len(g.errors) == 0, json.dumps(g.errors[:5]))
            check("0 page errors in all scenarios", len(g.page_errors) == 0, json.dumps(g.page_errors[:5]))
            browser.close()
    finally:
        server.terminate()
        try:
            out, _ = server.communicate(timeout=5)
            if out:
                log("--- serve.ts output ---")
                log(out[-2000:])
        except Exception:
            server.kill()

    log(f"\nPLAYTEST: {'0 FAILURE — M1 end-to-end passed' if not FAILURES else f'{len(FAILURES)} FAILURE(S): ' + ', '.join(FAILURES)}")
    return 0 if not FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
