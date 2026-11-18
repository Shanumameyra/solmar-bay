#!/usr/bin/env python3
"""Headless playtest for Solmar Bay: title -> walk -> steal a car ->
drive -> M1 (café, then docks pickup, then deliver) -> HUD + minimap.

Steers with the keyboard only, reading window.__GTA (x, z, heading,
inCar, mission, step, speed) for position feedback. On foot the camera
heading is fixed, so W/S/A/D span the plane and a greedy controller can
walk anywhere; driving steers by heading error with a reverse-out
recovery when stuck.

Run from the repository root:
    ~/workspace/tools/pw-venv/bin/python tests/playtest.py
"""
import math
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
NODE = Path.home() / "workspace" / "tools" / "node-v22.23.4-linux-x64" / "bin" / "node"
PORT = 8902

from playwright.sync_api import sync_playwright  # noqa: E402

failures = []


def check(cond, msg):
    print(("  ok  " if cond else " FAIL ") + msg)
    if not cond:
        failures.append(msg)


def wait_server():
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def gta(page):
    return page.evaluate("window.__GTA")


def dist(a, tx, tz):
    return math.hypot(a["x"] - tx, a["z"] - tz)


def walk_to(page, tx, tz, timeout=90):
    """Greedy on-foot navigation with W/S/A/D (camera heading fixed)."""
    keys = set()
    held = set()

    def set_keys(want):
        nonlocal held
        for k in list(held - want):
            page.keyboard.up(k)
            held.discard(k)
        for k in list(want - held):
            page.keyboard.down(k)
            held.add(k)

    start = time.time()
    last_best = dist(gta(page), tx, tz)
    last_progress = time.time()
    sidestep = None
    while time.time() - start < timeout:
        a = gta(page)
        d = dist(a, tx, tz)
        if d < 3:
            set_keys(set())
            return True
        if d < last_best - 0.5:
            last_best = d
            last_progress = time.time()
        want = set()
        if sidestep and time.time() < sidestep[1]:
            want.add(sidestep[0])
        else:
            sidestep = None
            if a["z"] - tz > 1:
                want.add("w")
            elif tz - a["z"] > 1:
                want.add("s")
            if a["x"] - tx < -1:
                want.add("a")
            elif a["x"] - tx > 1:
                want.add("d")
            if time.time() - last_progress > 3:
                # Stuck against a building: sidestep for 1.5 s.
                sidestep = ("a" if "a" not in held else "d", time.time() + 1.5)
                last_progress = time.time()
        set_keys(want)
        page.wait_for_timeout(150)
    set_keys(set())
    return False


def drive_to(page, tx, tz, timeout=90):
    """Steer by heading error, throttle on; reverse out when stuck."""
    held = set()

    def set_keys(want):
        nonlocal held
        for k in list(held - want):
            page.keyboard.up(k)
            held.discard(k)
        for k in list(want - held):
            page.keyboard.down(k)
            held.add(k)

    def wrap(a):
        while a > math.pi:
            a -= 2 * math.pi
        while a < -math.pi:
            a += 2 * math.pi
        return a

    start = time.time()
    last_best = dist(gta(page), tx, tz)
    last_progress = time.time()
    reversing_until = 0
    while time.time() - start < timeout:
        a = gta(page)
        d = dist(a, tx, tz)
        if d < 6:
            set_keys(set())
            return True
        if d < last_best - 0.5:
            last_best = d
            last_progress = time.time()
        if time.time() < reversing_until:
            set_keys({"s"})
        else:
            want = {"w"}
            err = wrap(math.atan2(tx - a["x"], tz - a["z"]) - a["heading"])
            if err > 0.15:
                want.add("d")
            elif err < -0.15:
                want.add("a")
            if time.time() - last_progress > 4:
                reversing_until = time.time() + 1.5
                last_progress = time.time()
            set_keys(want)
        page.wait_for_timeout(150)
    set_keys(set())
    return False


def main():
    server = subprocess.Popen(
        [str(NODE), "serve.ts", "--port", str(PORT)],
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        if not wait_server():
            print("FAIL: game server did not come up")
            return 1
        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox"]
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="load")
            page.wait_for_function("window.__GTA", timeout=20000)
            page.wait_for_timeout(1000)

            a = gta(page)
            check(a["screen"] == "title", f"title screen shows (screen={a['screen']})")
            check(page.is_visible("#title"), "title overlay is visible")
            check(page.inner_text("#cash").startswith("$"), "HUD cash shows on title")

            page.keyboard.press("Enter")
            page.wait_for_timeout(500)
            a = gta(page)
            check(a["screen"] == "play", f"Enter starts the game (screen={a['screen']})")
            check(a["mission"] == 0, "mission starts at M0")
            start = (a["x"], a["z"])

            # Walk: hold W for 2 s, must move.
            page.keyboard.down("w")
            page.wait_for_timeout(2000)
            page.keyboard.up("w")
            a = gta(page)
            moved = math.hypot(a["x"] - start[0], a["z"] - start[1])
            check(moved > 5, f"walking moves the player ({moved:.1f} m in 2 s)")

            # Walk to the parked car at (12, -75) and steal it.
            check(walk_to(page, 12, -75), "walked to the parked car at (12, -75)")
            page.keyboard.press("e")
            page.wait_for_timeout(500)
            a = gta(page)
            check(a["inCar"], "E enters / steals the parked car")

            # Drive: hold W for 3 s.
            page.keyboard.down("w")
            page.wait_for_timeout(3000)
            page.keyboard.up("w")
            a = gta(page)
            check(a["speed"] > 0, f"driving builds speed ({a['speed']} km/h)")
            check(dist(a, 12, -75) > 10, "driving moves the car away from the parking spot")

            # M1: drive to Rosa's café (-20, -10).
            check(drive_to(page, -20, -10), "drove to Rosa's café")
            page.wait_for_timeout(800)
            a = gta(page)
            check(a["mission"] == 1, f"M1 starts at the café (mission={a['mission']})")

            # M1: drive to the docks (160, 50), get out, walk to the marker.
            check(drive_to(page, 160, 50), "drove to the docks")
            a = gta(page)
            car_pos = (a["x"], a["z"])
            page.keyboard.press("e")
            page.wait_for_timeout(500)
            a = gta(page)
            check(not a["inCar"], "E exits the car at the docks")
            check(walk_to(page, 160, 50), "walked to the docks package marker")
            page.wait_for_timeout(500)
            a = gta(page)
            check(a["step"] == "deliver", f"M1 package collected (step={a['step']})")

            # M1: get back in the car and drive to the café to deliver.
            check(walk_to(page, car_pos[0], car_pos[1]), "walked back to the car")
            page.keyboard.press("e")
            page.wait_for_timeout(500)
            a = gta(page)
            check(a["inCar"], "E re-enters the car at the docks")
            check(drive_to(page, -20, -10, timeout=120), "drove back to the café to deliver")
            page.wait_for_timeout(800)
            a = gta(page)
            check(a["mission"] == 2, f"M1 delivered, M2 starts (mission={a['mission']}, money=${a['money']})")
            check(a["money"] >= 450, f"M1 paid $300 (money=${a['money']})")

            # HUD + minimap still live.
            check(page.inner_text("#cash").startswith("$"), "HUD cash updates")
            check(len(page.inner_text("#objective")) > 3, "HUD objective shows")
            check(page.inner_text("#speed").endswith("km/h"), "HUD speed shows")
            mm = page.evaluate(
                "() => { const c = document.getElementById('minimap');"
                " const x = c.getContext('2d').getImageData(0,0,160,160).data;"
                " let s = 0, m = 0; for (let i=0;i<x.length;i+=4){ s += x[i]; }"
                " m = s / (x.length/4); let v = 0;"
                " for (let i=0;i<x.length;i+=4){ v += (x[i]-m)*(x[i]-m); }"
                " return Math.sqrt(v/(x.length/4)); }"
            )
            check(mm > 5, f"minimap is drawn, not blank (pixel stddev {mm:.1f})")
            check(not errors, f"zero console/page errors during play ({len(errors)})")
            for e in errors[:10]:
                print("  error: " + e)
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    if failures:
        print(f"\nplaytest: {len(failures)} FAILURES")
        return 1
    print("\nplaytest: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
