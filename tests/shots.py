# Solmar Bay — retake the ONE hero screenshot (fast).
# Run: ~/workspace/tools/pw-venv/bin/python tests/shots.py
# Requires the static server: node serve.ts  (serves game/ on :8080)
# The shot is 1600x900 JPEG q82 (HD); fails if a pageerror / console error
# appears, or if the shot exceeds the 256 KiB dossier cap.
import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = "http://localhost:8080/index.html"
OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots")
SHOTS = [
    ("hero", "1-hero.jpg"),
]
MAX_BYTES = 262144


async def main():
    os.makedirs(OUT, exist_ok=True)
    errs = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1600, "height": 900})
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        ok = True
        for name, fname in SHOTS:
            await page.goto(f"{BASE}?shot={name}&seed=7", wait_until="load")
            try:
                await page.wait_for_function("window.__GTA && window.__GTA.shotReady", timeout=20000)
            except Exception:
                print(f"  !! shotReady timeout for {name}")
                ok = False
                continue
            await page.wait_for_timeout(400)
            path = os.path.join(OUT, fname)
            await page.screenshot(path=path, type="jpeg", quality=82)
            size = os.path.getsize(path)
            gta = await page.evaluate("window.__GTA")
            flag = "OK" if size <= MAX_BYTES else "TOO BIG"
            if size > MAX_BYTES:
                ok = False
            print(f"{fname}: {size} bytes ({flag}), wanted={gta.get('wanted')} "
                  f"money=${gta.get('money')} mission={gta.get('mission')!r} "
                  f"policeCars={gta.get('policeCars')}")
            # Staging checks: the hero must drive on the beach (sea in
            # frame) at 3 stars, with pedestrians near it, the traffic jam
            # ahead and 5 cruisers + tank on its tail.
            if name == "hero":
                st = await page.evaluate("""() => {
                    const s = window.__GTA.state;
                    const car = s.player.car;
                    const near = (s.peds || []).filter(p => car && Math.hypot(p.x - car.x, p.z - car.z) < 40).length;
                    const police = (s.cars || []).filter(c => c.isPolice).length;
                    return { carX: car ? car.x : null, nearPeds: near, wanted: s.wanted,
                             police, heroHud: !!s.heroHud, heroCam: !!s.heroCam };
                }""")
                if st["carX"] is None or st["carX"] >= -168:
                    print(f"  !! hero car is not on the beach (x={st['carX']})"); ok = False
                if st["nearPeds"] < 2:
                    print(f"  !! hero has only {st['nearPeds']} peds near the frame"); ok = False
                if st["wanted"] != 3:
                    print(f"  !! hero wanted is {st['wanted']}, expected 3"); ok = False
                if st["police"] != 6:
                    print(f"  !! hero has {st['police']} police units, expected 6 (5 cruisers + tank)"); ok = False
                if not st["heroHud"] or not st["heroCam"]:
                    print(f"  !! hero staging flags missing (hud={st['heroHud']} cam={st['heroCam']})"); ok = False
        await browser.close()
    print("errors:", errs if errs else "none")
    if errs:
        ok = False
    print("SHOTS " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


asyncio.run(main())
