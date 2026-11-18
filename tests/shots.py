#!/usr/bin/env python3
"""Render the Solmar Bay screenshots headlessly and check them.

- 1-hero.jpg: the entrant-supplied key art, resized to 1280x720 only.
- 2-title / 3-onfoot / 4-mission: rendered from the game in headless
  Chromium (shots.json queries), waiting for window.__shotReady.
- Every screenshot must be 1280x720 and <= 256 KiB, with zero console
  errors and zero page errors while rendering.

Run from the repository root:
    ~/workspace/tools/pw-venv/bin/python tests/shots.py
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHOTS = REPO / "screenshots"
HERO_SRC = Path.home() / "workspace" / "user" / "media_library" / "image" / "image.png"
NODE = Path.home() / "workspace" / "tools" / "node-v22.23.4-linux-x64" / "bin" / "node"
PORT = 8901
MAX_BYTES = 262144

from PIL import Image  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

failures = []


def check(cond, msg):
    print(("  ok  " if cond else " FAIL ") + msg)
    if not cond:
        failures.append(msg)


def verify_image(path):
    with Image.open(path) as im:
        w, h = im.size
    size = path.stat().st_size
    check((w, h) == (1280, 720), f"{path.name}: is 1280x720 (got {w}x{h})")
    check(size <= MAX_BYTES, f"{path.name}: <= 256 KiB (got {size} bytes)")
    return size


def render_hero():
    print("hero: resizing supplied key art to 1280x720 (content untouched)")
    with Image.open(HERO_SRC) as im:
        im = im.convert("RGB")
        im = im.resize((1280, 720), Image.LANCZOS)
        quality = 88
        while True:
            im.save(SHOTS / "1-hero.jpg", "JPEG", quality=quality)
            if (SHOTS / "1-hero.jpg").stat().st_size <= MAX_BYTES or quality <= 40:
                break
            quality -= 8
    print(f"  hero saved at JPEG quality {quality}")
    return verify_image(SHOTS / "1-hero.jpg")


def wait_server():
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    SHOTS.mkdir(exist_ok=True)
    with open(REPO / "shots.json") as f:
        shots = json.load(f)

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
        render_hero()

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--no-sandbox"]
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            for shot in shots:
                if not shot.get("query"):
                    continue
                name = shot["name"]
                print(f"rendering {name} ({shot['query']})")
                page.goto(f"http://127.0.0.1:{PORT}/{shot['query']}", wait_until="load")
                try:
                    page.wait_for_function("window.__GTA && window.__GTA.shotReady", timeout=30000)
                except Exception:
                    check(False, f"{name}: __shotReady never became true")
                    continue
                page.wait_for_timeout(400)
                page.screenshot(path=str(SHOTS / name), animations="disabled", timeout=60000)
                gta = page.evaluate("window.__GTA")
                print(f"  __GTA: {gta}")
                check(gta.get("shotReady") is True, f"{name}: shotReady true")
                verify_image(SHOTS / name)
            browser.close()
        check(not errors, f"zero console/page errors during renders ({len(errors)})")
        for e in errors[:10]:
            print("  error: " + e)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()

    if failures:
        print(f"\nshots: {len(failures)} FAILURES")
        return 1
    print("\nshots: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
