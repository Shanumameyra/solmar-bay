"""SOLMAR BAY — screenshot capture (real Chromium, Playwright).

  python3 tests/shots.py

- 1-hero.jpg: the silver hero car photo (~/workspace/user/media_library/
  image/image.png), resized to 1280x720 only, content unchanged.
- 2-title.jpg / 3-onfoot.jpg / 4-mission.jpg: real renders of the game via
  ?shot=2..4&seed=7, waiting for window.__shotReady, 1280x720 JPEG.

Each file must be <= 256 KiB (quality is lowered until it fits). Verifies the
camera override was honoured and no fallback modules were used, and reports
console/page errors per shot. Exit 0 when all four shots are written.
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PORT = 8932
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = REPO / "screenshots"
HERO_SRC = Path.home() / "workspace" / "user" / "media_library" / "image" / "image.png"
MAX_BYTES = 262144
FAILURES = []


def log(msg):
    print(msg, flush=True)


def check(name, ok, detail=""):
    log(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)
    return ok


def save_jpeg_fit(path, image, quality=88):
    """Save JPEG at the highest quality that fits in 256 KiB."""
    q = quality
    while q >= 40:
        image.save(path, "JPEG", quality=q, optimize=True)
        if path.stat().st_size <= MAX_BYTES:
            return q
        q -= 8
    image.save(path, "JPEG", quality=40, optimize=True)
    return 40


def main():
    shots_json = json.loads((REPO / "shots.json").read_text())
    by_file = {s["file"]: s for s in shots_json["shots"]}

    # --- 1-hero.jpg: photo, resize only -------------------------------------
    hero = Image.open(HERO_SRC).convert("RGB")
    log(f"hero source: {HERO_SRC} {hero.size[0]}x{hero.size[1]}")
    hero = hero.resize((1280, 720), Image.LANCZOS)
    q = save_jpeg_fit(SHOTS / "1-hero.jpg", hero)
    size = (SHOTS / "1-hero.jpg").stat().st_size
    check("1-hero.jpg 1280x720 <= 256 KiB", size <= MAX_BYTES, f"{size} bytes, quality {q}")

    # --- game renders 2-4 ----------------------------------------------------
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
            for shot_no, fname in ((2, "2-title.jpg"), (3, "3-onfoot.jpg"), (4, "4-mission.jpg")):
                meta = by_file[fname]
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                errors, page_errors = [], []
                page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
                page.on("pageerror", lambda e: page_errors.append(str(e)))
                page.add_init_script("localStorage.clear()")
                page.goto(BASE + f"/index.html?shot={shot_no}&seed=7")
                try:
                    page.wait_for_function("() => window.__shotReady === true", timeout=30000)
                except Exception:
                    check(f"{fname}: __shotReady", False, "timed out after 30 s")
                    page.close()
                    continue
                page.wait_for_timeout(600)
                info = page.evaluate("""() => {
                  const G = window.__GTA_BOOT;
                  return {
                    gta: window.__GTA,
                    fallbackPlayer: !!G.player._isFallback,
                    peds: (G.world.peds || []).length,
                    colliders: G.world.colliders.length,
                    camera: { x: +G.camera.position.x.toFixed(1), y: +G.camera.position.y.toFixed(1), z: +G.camera.position.z.toFixed(1) },
                    override: G.cameraOverride,
                    staged: (G.shots && G.shots.staged) || 0,
                  };
                }""")
                log(f"shot {shot_no} ({fname}): {json.dumps(info)}")
                check(f"{fname}: shot staged as {shot_no}", info["staged"] == shot_no)
                check(f"{fname}: real player (not fallback)", not info["fallbackPlayer"])
                if info["override"]:
                    cam = info["camera"]
                    ov = info["override"]["pos"]
                    dist = ((cam["x"] - ov["x"]) ** 2 + (cam["y"] - ov["y"]) ** 2 + (cam["z"] - ov["z"]) ** 2) ** 0.5
                    check(f"{fname}: cameraOverride honoured", dist < 3.0,
                          f"camera=({cam['x']},{cam['y']},{cam['z']}) override=({ov['x']},{ov['y']},{ov['z']})")
                out = SHOTS / fname
                page.screenshot(path=str(out), type="jpeg", quality=88)
                if out.stat().st_size > MAX_BYTES:
                    img = Image.open(out)
                    q = save_jpeg_fit(out, img, quality=80)
                    log(f"  {fname} recompressed to quality {q}")
                size = out.stat().st_size
                check(f"{fname} 1280x720 <= 256 KiB", size <= MAX_BYTES, f"{size} bytes")
                check(f"{fname}: 0 console errors", len(errors) == 0, json.dumps(errors[:3]))
                check(f"{fname}: 0 page errors", len(page_errors) == 0, json.dumps(page_errors[:3]))
                page.close()
            browser.close()
    finally:
        server.terminate()
        try:
            server.communicate(timeout=5)
        except Exception:
            server.kill()

    log(f"\nSHOTS: {'ALL 4 WRITTEN' if not FAILURES else str(len(FAILURES)) + ' FAILURE(S): ' + ', '.join(FAILURES)}")
    return 0 if not FAILURES else 1


if __name__ == "__main__":
    sys.exit(main())
