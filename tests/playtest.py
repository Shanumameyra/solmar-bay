# Solmar Bay — browser playtest (python playwright, venv).
# Run: ~/workspace/tools/pw-venv/bin/python tests/playtest.py
# Requires the static server: node serve.ts  (serves game/ on :8080)
# Boot smoke (title -> play), walk, enter a car, drive, wanted heat,
# mission start, HUD/minimap update, FPS. Fails on any pageerror or
# console error, or if a step's assertion does not hold.
import asyncio
import sys

from playwright.async_api import async_playwright

BASE = "http://localhost:8080/index.html"

ERRORS = []


async def gta(page):
    return await page.evaluate("window.__GTA")


async def main():
    ok = True
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("console", lambda m: ERRORS.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))

        print("== boot smoke (title screen) ==")
        await page.goto(f"{BASE}?seed=7", wait_until="load")
        await page.wait_for_function("window.__GTA", timeout=15000)
        await page.wait_for_timeout(1500)
        state = await gta(page)
        print(f"  screen={state['screen']} fps={state.get('fps')} money=${state['money']} "
              f"mission={state['mission']!r}")
        if state["screen"] != "title":
            print("  FAIL: expected title screen"); ok = False

        print("== start the game (Enter) ==")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(500)
        state = await gta(page)
        print(f"  screen={state['screen']}")
        if state["screen"] != "play":
            print("  FAIL: expected play after Enter"); ok = False

        print("== walk (hold W until moved > 3 m) ==")
        before = await page.evaluate("({x: window.__GTA.state.player.x, z: window.__GTA.state.player.z})")
        await page.keyboard.down("KeyW")
        try:
            await page.wait_for_function(
                """(before) => {
                    const p = window.__GTA.state.player;
                    return Math.hypot(p.x - before.x, p.z - before.z) > 3;
                }""",
                arg=before, timeout=30000)
            walked = True
        except Exception:
            walked = False
        await page.keyboard.up("KeyW")
        after = await page.evaluate("({x: window.__GTA.state.player.x, z: window.__GTA.state.player.z})")
        moved = ((after["x"] - before["x"]) ** 2 + (after["z"] - before["z"]) ** 2) ** 0.5
        print(f"  moved {moved:.1f} m (from {before['x']:.1f},{before['z']:.1f} to {after['x']:.1f},{after['z']:.1f})")
        if not walked or moved < 3:
            print("  FAIL: player barely moved"); ok = False

        print("== enter a parked car (debug teleport + E) ==")
        # Wait for the player to stop walking (else they drift out of the
        # 3.2 m enter range between the teleport and the next game step).
        try:
            await page.wait_for_function("() => Math.abs(window.__GTA.state.player.speed) < 0.5", timeout=15000)
        except Exception:
            print("  (player did not stop; continuing anyway)")
        await page.evaluate("""() => {
            const car = window.__GTA.state.cars.find(c => c.isParked);
            window.__GTA.debug.teleport(car.x + 2, car.z, Math.PI, null);
            window.__parkedCar = car;
        }""")
        # Hold E (a quick press can fall between two slow frames).
        await page.keyboard.down("KeyE")
        await page.wait_for_timeout(600)
        await page.keyboard.up("KeyE")
        await page.wait_for_timeout(500)
        state = await gta(page)
        print(f"  inCar={state['inCar']} speed={state['speed']:.1f}")
        if not state["inCar"]:
            print("  FAIL: E did not enter the car"); ok = False

        print("== drive (beachfront street, hold W until distanceDriven > 10 m) ==")
        # The nearest parked car may face a building; move the player's
        # current car to the clear beachfront street (x=-144, south) first.
        await page.evaluate("""() => {
            const car = window.__GTA.state.player.car;
            window.__GTA.debug.teleport(-144, -60, 0, car);
        }""")
        await page.wait_for_timeout(500)
        await page.keyboard.down("KeyW")
        try:
            await page.wait_for_function(
                "() => window.__GTA.state.stats.distanceDriven > 10",
                timeout=30000)
            drove = True
        except Exception:
            drove = False
        await page.keyboard.up("KeyW")
        state = await gta(page)
        driven = await page.evaluate("window.__GTA.state.stats.distanceDriven")
        print(f"  speed={state['speed']:.1f} m/s distanceDriven={driven:.1f} m")
        if not drove or driven < 10:
            print("  FAIL: car barely drove"); ok = False

        print("== wanted heat (debug addHeat) ==")
        await page.evaluate("window.__GTA.debug.addHeat(2)")
        await page.wait_for_timeout(1500)
        state = await gta(page)
        print(f"  wanted={state['wanted']} policeCars={state['policeCars']}")
        if state["wanted"] < 2:
            print("  FAIL: wanted did not rise"); ok = False

        print("== mission start (debug startMission 1) ==")
        await page.evaluate("window.__GTA.debug.startMission(1)")
        await page.wait_for_timeout(500)
        state = await gta(page)
        print(f"  mission={state['mission']!r}")
        if "docks" not in state["mission"].lower() and "pickup" not in state["mission"].lower():
            print("  FAIL: mission objective did not change"); ok = False

        print("== HUD / minimap ==")
        hud = await page.evaluate("""() => ({
            cash: document.getElementById('cash')?.textContent,
            objective: document.getElementById('objective')?.textContent,
            stars: document.getElementById('stars')?.textContent,
            minimap: !!document.getElementById('minimap'),
        })""")
        print(f"  cash={hud['cash']!r} objective={hud['objective']!r} stars={hud['stars']!r} minimap={hud['minimap']}")
        if not hud["cash"] or not hud["objective"]:
            print("  FAIL: HUD text missing"); ok = False

        print("== FPS ==")
        state = await gta(page)
        print(f"  fps={state.get('fps')} errors={len(ERRORS)}")
        await browser.close()

    print("== errors ==")
    if ERRORS:
        for e in ERRORS[:20]:
            print("  " + e)
        ok = False
    else:
        print("  none")
    print("PLAYTEST " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


asyncio.run(main())
