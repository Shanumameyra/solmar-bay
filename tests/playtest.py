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
        # Wait for the transition (not a fixed sleep): in headless
        # SwiftShader the frame rate can be ~8 fps, so a 500 ms wait is
        # only ~4 frames and the title -> play transition may not have
        # landed yet. The game is correct; the test must wait for it.
        try:
            await page.wait_for_function(
                "() => window.__GTA.screen === 'play'", timeout=10000)
        except Exception:
            pass
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
        # Hold E (a quick press can fall between two slow frames; in
        # headless SwiftShader the key edge can take >1 s to be consumed,
        # so hold long and retry once — timing only, the assertion that
        # E must enter the car is unchanged).
        async def press_e(ms=1500):
            await page.keyboard.down("KeyE")
            await page.wait_for_timeout(ms)
            await page.keyboard.up("KeyE")
            await page.wait_for_timeout(500)
        await press_e()
        state = await gta(page)
        if not state["inCar"]:
            print("  (first E missed; retrying once)")
            await press_e()
            state = await gta(page)
        print(f"  inCar={state['inCar']} speed={state['speed']:.1f}")
        if not state["inCar"]:
            print("  FAIL: E did not enter the car"); ok = False

        print("== drive (beachfront street, hold W until distanceDriven > 10 m) ==")
        # The nearest parked car may face a building; move the player's
        # current car to the clear beachfront street (x=-144, south) first.
        # If the enter step failed there is no car to drive — skip (the
        # enter FAIL above already records it) instead of walking for 30 s.
        if not state["inCar"]:
            print("  (skipped: not in a car)")
        else:
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

        print("== exit the car (E) ==")
        # No car (enter/drive failed) — nothing to exit; the earlier FAIL
        # already records it. Skip instead of crashing on player.car null.
        if not state["inCar"]:
            print("  (skipped: not in a car)")
        else:
            # Let the car roll to a near-stop first, so the exit position is
            # measured against where the car actually is.
            try:
                await page.wait_for_function(
                    "() => Math.abs(window.__GTA.state.player.speed) < 2", timeout=20000)
            except Exception:
                print("  (car did not slow down; continuing anyway)")
            car_pos = await page.evaluate("({x: window.__GTA.state.player.car.x, z: window.__GTA.state.player.car.z})")
            await page.keyboard.down("KeyE")
            await page.wait_for_timeout(1500)
            await page.keyboard.up("KeyE")
            await page.wait_for_timeout(500)
            exit_state = await page.evaluate("""(carPos) => {
                const p = window.__GTA.state.player;
                return {
                    inCar: p.inCar,
                    onFoot: p.onFoot,
                    dist: Math.hypot(p.x - carPos.x, p.z - carPos.z),
                };
            }""", arg=car_pos)
            print(f"  inCar={exit_state['inCar']} onFoot={exit_state['onFoot']} distToCar={exit_state['dist']:.1f} m")
            if exit_state["inCar"] or not exit_state["onFoot"]:
                print("  FAIL: E did not exit the car"); ok = False
            if exit_state["dist"] > 5:
                print("  FAIL: player ended up far from the car after exiting"); ok = False

        print("== wanted heat (debug addHeat) ==")
        await page.evaluate("window.__GTA.debug.addHeat(2)")
        await page.wait_for_timeout(1500)
        state = await gta(page)
        print(f"  wanted={state['wanted']} policeCars={state['policeCars']}")
        if state["wanted"] < 2:
            print("  FAIL: wanted did not rise"); ok = False

        print("== mission start (debug startMission 1) ==")
        await page.evaluate("window.__GTA.debug.startMission(1)")
        # The world step that applies the mission can take >500 ms at
        # SwiftShader fps (~4): poll until the objective changes, up to 5 s.
        mission = ""
        for _ in range(20):
            await page.wait_for_timeout(250)
            mission = (await gta(page))["mission"]
            if "docks" in mission.lower() or "pickup" in mission.lower():
                break
        print(f"  mission={mission!r}")
        if "docks" not in mission.lower() and "pickup" not in mission.lower():
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
