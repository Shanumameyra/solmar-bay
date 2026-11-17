# Solmar Bay — retake the 4 staged screenshots (fast).
# Run: ~/workspace/tools/pw-venv/bin/python tests/shots.py
# Requires the static server: node serve.ts  (serves game/ on :8080)
# Each shot is 1280x720 JPEG q82; fails if a pageerror / console error
# appears, or if any shot exceeds the 256 KiB dossier cap.
import asyncio
import os
import sys

from playwright.async_api import async_playwright

BASE = "http://localhost:8080/index.html"
OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots")
SHOTS = [
    ("cover", "1-cover.jpg"),
    ("onfoot", "2-onfoot.jpg"),
    ("chase", "3-chase.jpg"),
    ("mission", "4-mission.jpg"),
]
MAX_BYTES = 262144


async def main():
    os.makedirs(OUT, exist_ok=True)
    errs = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
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
            # Staging checks: the cover must drive on the beach (sea in
            # frame) with pedestrians near it, and the onfoot shot must
            # have pedestrians in front of the player.
            if name == "cover":
                st = await page.evaluate("""() => {
                    const s = window.__GTA.state;
                    const car = s.player.car;
                    const near = (s.peds || []).filter(p => car && Math.hypot(p.x - car.x, p.z - car.z) < 40).length;
                    return { carX: car ? car.x : null, nearPeds: near, wanted: s.wanted };
                }""")
                if st["carX"] is None or st["carX"] >= -168:
                    print(f"  !! cover car is not on the beach (x={st['carX']})"); ok = False
                if st["nearPeds"] < 2:
                    print(f"  !! cover has only {st['nearPeds']} peds near the frame"); ok = False
                if st["wanted"] != 0:
                    print(f"  !! cover gained heat (wanted={st['wanted']})"); ok = False
            if name == "onfoot":
                st = await page.evaluate("""() => {
                    const s = window.__GTA.state;
                    const p = s.player;
                    const ahead = (s.peds || []).filter(ped => {
                        const dz = ped.z - p.z, dx = ped.x - p.x;
                        return dz < -2 && dz > -40 && Math.abs(dx) < 15;
                    }).length;
                    return { ahead };
                }""")
                if st["ahead"] < 2:
                    print(f"  !! onfoot has only {st['ahead']} peds in front"); ok = False
        await browser.close()
    print("errors:", errs if errs else "none")
    if errs:
        ok = False
    print("SHOTS " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


asyncio.run(main())
