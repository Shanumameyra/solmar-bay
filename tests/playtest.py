"""playtest.py — Solmar Bay end-to-end playtest (v5).

Drives the real game in a headless browser with the develop-web-game loop:
short input bursts, then read state, then adjust. All movement is stepped
with window.advanceTime (deterministic 1/60 s steps) and measured in GAME
time, because software GL in this VM renders far slower than a real GPU and
wall-clock timing would make every movement check flaky.

Checks (0 failures required):
  1. Enter on the title starts the game (title -> playing, M0 -> M1).
  2. WASD walks at ~5 m/s in game time (and Shift runs at ~8 m/s).
  3. Walk to a parked car, E to enter, W to drive, E to exit, E to re-enter.
  4. M1 end to end: cafe -> docks -> package collected -> deliver to the
     cafe -> M1 completes and pays $300 (mission becomes M2).
  5. HUD: cash, objective, speed, minimap and the stars row are readable
     and no HUD panel covers the centre of the screen (where the car is).
  6. Zero console errors and zero page errors in every scenario.

Run from the repo root:  python3 tests/playtest.py
Exit 0 when every check passes, else exit 1 (with the failing step named).
"""

import base64
import math
import os
import socket
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.path.expanduser(
    "~/.cache/ms-playwright/chromium_headless_shell-1255/"
    "chrome-headless-shell-linux64/chrome-headless-shell")

CHROME_ARGS = [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
]

FAILURES = []
LOG = open("/tmp/playtest.log", "w", encoding="utf-8")


def note(ok, label, detail=""):
    line = ("  PASS  " if ok else "  FAIL  ") + label \
        + (f" — {detail}" if detail and not ok else "")
    print(line, flush=True)
    LOG.write(line + "\n")
    LOG.flush()
    if not ok:
        FAILURES.append(label + (f" ({detail})" if detail else ""))


def wrap_angle(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Driver:
    """One browser tab on the game, plus a held-key set."""

    def __init__(self, page):
        self.page = page
        self.held = set()
        self.errors = []
        page.on("console",
                lambda m: self.errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))

    def state(self):
        return self.page.evaluate("() => window.render_game_to_text()")

    def dbg(self):
        return self.page.evaluate("() => window.__GTA ? window.__GTA.dbg : null")

    def advance(self, ms, render=False):
        # render=False: pure logic steps, no WebGL render — fast even under
        # software GL. Render only when a screenshot or a visual read needs
        # a fresh frame.
        return self.page.evaluate(
            f"() => window.advanceTime({int(ms)}, {str(render).lower()})")

    def pause_raf(self, paused):
        self.page.evaluate(
            f"() => window.__setRafPaused({str(paused).lower()})")

    def press(self, key):
        self.page.keyboard.press(key)
        self.page.wait_for_timeout(200)

    def set_keys(self, want):
        for key in sorted(self.held - want):
            self.page.keyboard.up(key)
        for key in sorted(want - self.held):
            self.page.keyboard.down(key)
        self.held = set(want)

    def release_keys(self):
        self.set_keys(set())

    def wait_state(self, mode, timeout_s=20):
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if self.state()["mode"] == mode:
                return True
            time.sleep(0.3)
        return False

    def walk_to(self, tx, tz, arrive=2.5, budget_s=150, run=True):
        """Walk (Shift = run) to a point, steering with W + A/D strafes.
        Recovers when stuck against a wall: back up, sidestep, re-approach
        (a straight line across the city crosses buildings; callers should
        still route via streets — see walk_route)."""
        t0 = time.time()
        last = None
        best = None
        best_time = time.time()
        side = 1
        while time.time() - t0 < budget_s:
            s = self.state()
            p = s["player"]
            dx, dz = tx - p["x"], tz - p["z"]
            dist = math.hypot(dx, dz)
            if dist <= arrive:
                self.release_keys()
                return True, dist
            last = (dist, p["x"], p["z"])
            if best is None or dist < best - 0.5:
                best = dist
                best_time = time.time()
            if time.time() - best_time > 6:
                # Stuck (probably a building face): back up, sidestep.
                self.set_keys({"s"})
                self.advance(800, False)
                self.set_keys({"w", "d" if side > 0 else "a"})
                self.advance(800, False)
                side = -side
                best = None
                best_time = time.time()
                continue
            diff = wrap_angle(math.atan2(dx, dz) - p["heading"])
            want = {"w"}
            if run:
                want.add("Shift")
            if diff > 0.25:
                want.add("d")
            elif diff < -0.25:
                want.add("a")
            self.set_keys(want)
            self.advance(400, False)
        self.release_keys()
        return False, (last[0] if last else -1)

    def walk_route(self, points, arrive=2.5, budget_s=150, run=True):
        """Walk a street route: a list of (x, z) waypoints in order."""
        for wx, wz in points:
            ok, detail = self.walk_to(wx, wz, arrive=arrive,
                                     budget_s=budget_s, run=run)
            if not ok:
                return False, f"waypoint ({wx}, {wz}): {detail} m away"
        return True, "route done"

    def drive_to(self, tx, tz, arrive=5.5, budget_s=180):
        """Drive to a point. Coasts (no throttle) into sharp turns so the
        car can actually make them, and reverses out when stuck."""
        t0 = time.time()
        last_progress = time.time()
        best = None
        while time.time() - t0 < budget_s:
            s = self.state()
            p = s["player"]
            if not p["inCar"]:
                self.release_keys()
                return False, "left the car"
            dx, dz = tx - p["x"], tz - p["z"]
            dist = math.hypot(dx, dz)
            if dist <= arrive:
                self.release_keys()
                return True, dist
            if best is None or dist < best - 0.5:
                best = dist
                last_progress = time.time()
            diff = wrap_angle(math.atan2(dx, dz) - p["heading"])
            if time.time() - last_progress > 10:
                # Stuck against something: reverse out, steering away.
                self.set_keys({"s", "a" if diff > 0 else "d"})
                self.advance(1200, False)
                self.release_keys()
                last_progress = time.time()
                best = None
                continue
            want = set()
            speed = p["speed"]
            if abs(diff) > 1.2 and speed > 8:
                pass  # coast: no throttle, tighter turn
            else:
                want.add("w")
            if diff > 0.12:
                want.add("d")
            elif diff < -0.12:
                want.add("a")
            self.set_keys(want)
            self.advance(400, False)
        self.release_keys()
        return False, f"timeout {best and round(best, 1)} m away"


def main():
    from playwright.sync_api import sync_playwright

    port = free_port()
    server = subprocess.Popen(
        ["node", "serve.ts", str(port)], cwd=REPO,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.time() + 15
        import urllib.request
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"http://localhost:{port}/", timeout=2)
                break
            except Exception:
                time.sleep(0.3)

        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=CHROME, args=CHROME_ARGS)
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                d = Driver(page)
                page.goto(f"http://localhost:{port}/", timeout=30000)
                page.wait_for_timeout(2500)

                # -- 1. Enter starts the game -------------------------
                s = d.state()
                note(s["mode"] == "title", "1. title screen shows on load",
                     f"mode={s['mode']}")
                d.press("Enter")
                d.advance(600, False)
                # Freeze the rAF loop from here on: the simulation is driven
                # by advanceTime only, so the slow software renderer cannot
                # starve or flake the logic checks.
                d.pause_raf(True)
                s = d.state()
                note(s["mode"] == "playing", "1. Enter starts the game",
                     f"mode={s['mode']}")
                note(s["mission"] and s["mission"]["id"] == "M1",
                     "1. M0 completes at the cafe, M1 starts",
                     f"mission={s['mission'] and s['mission']['id']}")
                money_m1_start = s["money"]

                # -- 2. walk speed in game time -----------------------
                s0 = d.state()
                d.page.keyboard.down("w")
                s1 = d.advance(2000, False)
                d.page.keyboard.up("w")
                dist = math.hypot(s1["player"]["x"] - s0["player"]["x"],
                                  s1["player"]["z"] - s0["player"]["z"])
                gt = max(0.01, s1["time"] - s0["time"])
                note(dist / gt >= 4.5, "2. walk speed ~5 m/s in game time",
                     f"{dist:.1f} m in {gt:.2f} s = {dist / gt:.2f} m/s")
                s0 = d.state()
                d.page.keyboard.down("Shift")
                d.page.keyboard.down("w")
                s1 = d.advance(2000, False)
                d.page.keyboard.up("w")
                d.page.keyboard.up("Shift")
                dist = math.hypot(s1["player"]["x"] - s0["player"]["x"],
                                  s1["player"]["z"] - s0["player"]["z"])
                gt = max(0.01, s1["time"] - s0["time"])
                note(dist / gt >= 7.0, "2. run speed ~8 m/s in game time",
                     f"{dist:.1f} m in {gt:.2f} s = {dist / gt:.2f} m/s")

                # -- 3. walk to a parked car, steal it, drive, exit ----
                s = d.state()
                parked = d.dbg()["parked"]
                px, pz = s["player"]["x"], s["player"]["z"]
                car = min(parked, key=lambda c: math.hypot(c["x"] - px, c["z"] - pz))
                # Route via streets: the direct line crosses the plaza
                # blocks. (0, -25) and (25, -72) are street centrelines.
                ok, detail = d.walk_route(
                    [(0, -25), (25, -25), (25, -72), (car["x"], car["z"])],
                    arrive=2.5, budget_s=90)
                note(ok, "3. walk to the nearest parked car",
                     f"car at ({car['x']:.0f}, {car['z']:.0f}), {detail}")
                d.press("e")
                d.advance(900, False)
                s = d.state()
                note(s["player"]["inCar"], "3. E enters the parked car",
                     f"inCar={s['player']['inCar']}")
                d.page.keyboard.down("w")
                s1 = d.advance(2000, False)
                d.page.keyboard.up("w")
                note(s1["player"]["speed"] > 10, "3. W drives the car",
                     f"speed={s1['player']['speed']:.1f} m/s")
                d.press("e")
                d.advance(900, False)
                s = d.state()
                note(not s["player"]["inCar"], "3. E exits the car",
                     f"inCar={s['player']['inCar']}")
                d.press("e")
                d.advance(900, False)
                s = d.state()
                note(s["player"]["inCar"], "3. E re-enters the same car",
                     f"inCar={s['player']['inCar']}")

                # -- 4. M1 end to end: docks, package, deliver --------
                for wx, wz in [(100, -75), (175, -75), (175, 25)]:
                    ok, detail = d.drive_to(wx, wz, arrive=6)
                    note(ok, f"4. drive to ({wx}, {wz})", str(detail))
                    if not ok:
                        break
                else:
                    ok, detail = d.drive_to(182, 24, arrive=6)
                    note(ok, "4. drive to the docks (182, 24)", str(detail))
                s = d.state()
                if s["player"]["inCar"]:
                    d.press("e")
                    d.advance(900, False)
                ok, detail = d.walk_to(182, 24, arrive=3.0, run=False)
                note(ok, "4. walk into the package marker", f"{detail} m away")
                d.advance(600, False)
                s = d.state()
                note(s["mission"] and s["mission"]["id"] == "M1"
                     and s["mission"]["step"] == 1,
                     "4. package collected, delivery step starts",
                     f"mission={s['mission']}")
                d.press("e")
                d.advance(900, False)
                s = d.state()
                note(s["player"]["inCar"], "4. re-enter the car at the docks",
                     f"inCar={s['player']['inCar']}")
                for wx, wz in [(175, 25), (25, 25)]:
                    ok, detail = d.drive_to(wx, wz, arrive=6)
                    note(ok, f"4. drive back to ({wx}, {wz})", str(detail))
                    if not ok:
                        break
                else:
                    ok, detail = d.drive_to(0, 22, arrive=5.5, budget_s=180)
                    note(ok, "4. drive to Rosa's cafe (0, 22)", str(detail))
                d.advance(800, False)
                s = d.state()
                note(s["mission"] and s["mission"]["id"] == "M2",
                     "4. M1 completes, M2 starts",
                     f"mission={s['mission'] and s['mission']['id']}")
                note(s["money"] >= money_m1_start + 300,
                     "4. M1 pays $300",
                     f"money {money_m1_start} -> {s['money']}")
                note(s["mode"] == "playing" and s["player"]["health"] == 100,
                     "4. never busted / wasted during M1",
                     f"mode={s['mode']} hp={s['player']['health']}")

                # -- 5. HUD -------------------------------------------
                # Resume rendering so the final frame and the HUD are live.
                d.pause_raf(False)
                d.advance(800)
                page.wait_for_timeout(2500)
                hud = page.evaluate("""() => {
                  const t = (id) => { const el = document.getElementById(id);
                    return el ? el.textContent.trim() : null; };
                  const r = (id) => { const el = document.getElementById(id);
                    if (!el) return null; const b = el.getBoundingClientRect();
                    return {x: b.x, y: b.y, w: b.width, h: b.height}; };
                  const mm = document.getElementById('minimap-canvas');
                  return {
                    cash: t('hud-cash'), stars: t('hud-stars'),
                    objective: t('hud-objective'), speed: t('hud-speed'),
                    clock: t('hud-clock'),
                    rects: { tl: r('hud-topleft'), bl: r('hud-bottomleft'),
                             bc: r('hud-bottomcenter'), br: r('hud-bottomright'),
                             mm: r('minimap-wrap') },
                    minimapData: mm ? mm.toDataURL().length : 0,
                  }; }""")
                note(bool(hud["cash"]) and hud["cash"].startswith("$"),
                     "5. HUD cash reads", str(hud["cash"]))
                note(bool(hud["objective"]),
                     "5. HUD objective reads", str(hud["objective"]))
                note(bool(hud["speed"]) and "km/h" in hud["speed"],
                     "5. HUD speed reads", str(hud["speed"]))
                note(bool(hud["stars"]) and len(hud["stars"]) == 5,
                     "5. HUD stars row shows 5 stars", str(hud["stars"]))
                note(hud["minimapData"] > 5000,
                     "5. minimap canvas is drawn (not blank)",
                     f"dataURL {hud['minimapData']} chars")
                centre = {"x": 440, "y": 210, "w": 400, "h": 300}
                clash = []
                for name, rc in hud["rects"].items():
                    if not rc:
                        continue
                    overlap = not (rc["x"] + rc["w"] < centre["x"]
                                   or rc["x"] > centre["x"] + centre["w"]
                                   or rc["y"] + rc["h"] < centre["y"]
                                   or rc["y"] > centre["y"] + centre["h"])
                    if overlap:
                        clash.append(name)
                note(not clash, "5. no HUD panel covers the centre (the car)",
                     f"clash: {clash}")

                # Final frame for the visual check.
                cdp = page.context.new_cdp_session(page)
                res = cdp.send("Page.captureScreenshot",
                               {"format": "jpeg", "quality": 82, "fromSurface": True})
                with open("/tmp/playtest-end.jpg", "wb") as f:
                    f.write(base64.b64decode(res["data"]))
                print("  (final frame saved to /tmp/playtest-end.jpg)")

                # -- 6. zero console / page errors ---------------------
                note(not d.errors, "6. zero console + page errors",
                     "; ".join(d.errors[:3]))
            finally:
                browser.close()
    finally:
        server.terminate()
        try:
            server.communicate(timeout=5)
        except Exception:
            server.kill()

    if FAILURES:
        print(f"\nplaytest: FAIL — {len(FAILURES)} failure(s):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("\nplaytest: PASS — 0 failures")
    return 0


if __name__ == "__main__":
    sys.exit(main())
