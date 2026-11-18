# Solmar Bay — retake the supporting screenshots (v2).
# Run: ~/workspace/tools/pw-venv/bin/python tests/shots.py
# Requires the static server: node serve.ts  (serves game/ on :8080)
# Captures 2-title.jpg, 3-onfoot.jpg, 4-mission.jpg at 1280x720 JPEG q82
# (the kit gate: long side at most 1280, short side at least 480, each
# file at most 256 KiB); fails if a pageerror / console error appears,
# if a shot exceeds the size cap, or if a staged scene is wrong
# (title screen, on foot, M1 at the docks).
# NOTE: 1-hero.jpg is NOT captured here — it is Romi's approved image and
# must never be overwritten by this script.
import asyncio
import os
import struct
import sys

from playwright.async_api import async_playwright

BASE = "http://localhost:8080/index.html"
OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots")
SHOTS = [
    ("title", "2-title.jpg"),
    ("onfoot", "3-onfoot.jpg"),
    ("mission", "4-mission.jpg"),
]
MAX_BYTES = 262144


def jpeg_size(path):
    """Width/height of a JPEG from its SOF marker (stdlib only)."""
    with open(path, "rb") as f:
        data = f.read(2)
        if data != b"\xff\xd8":
            return None
        while True:
            marker = f.read(2)
            if len(marker) < 2 or marker[0] != 0xFF:
                return None
            code = marker[1]
            if code in (0xC0, 0xC1, 0xC2):
                f.read(3)
                h, w = struct.unpack(">HH", f.read(4))
                return (w, h)
            length = struct.unpack(">H", f.read(2))[0]
            f.read(length - 2)


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
            dims = jpeg_size(path)
            gta = await page.evaluate("window.__GTA")
            flag = "OK" if size <= MAX_BYTES else "TOO BIG"
            if size > MAX_BYTES:
                ok = False
            if dims != (1280, 720):
                print(f"  !! {fname} is {dims}, expected 1280x720")
                ok = False
            print(f"{fname}: {size} bytes ({flag}), {dims[0]}x{dims[1]}, screen={gta.get('screen')} "
                  f"wanted={gta.get('wanted')} money=${gta.get('money')} mission={gta.get('mission')} "
                  f"objective={gta.get('objective')!r} speed={gta.get('speed')} km/h "
                  f"inCar={gta.get('inCar')} policeCars={gta.get('policeCars')}")
            if name == "title":
                if gta.get('screen') != 'title':
                    print(f"  !! title shot screen is {gta.get('screen')!r}, expected 'title'"); ok = False
            if name == "onfoot":
                if gta.get('inCar'):
                    print("  !! onfoot shot is in a car, expected on foot"); ok = False
            if name == "mission":
                if gta.get('mission') != 1 or 'docks' not in (gta.get('objective') or '').lower():
                    print(f"  !! mission shot is M{gta.get('mission')} {gta.get('objective')!r}, expected M1 at the docks"); ok = False
        await browser.close()
    print("errors:", errs if errs else "none")
    if errs:
        ok = False
    print("SHOTS " + ("PASS" if ok else "FAIL"))
    sys.exit(0 if ok else 1)


asyncio.run(main())
