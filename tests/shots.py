"""shots.py — Solmar Bay screenshot generator (v5).

Regenerates the 4 entry screenshots from shots.json:
  1-hero.jpg    the hero frame Romi supplied — resized to 1280x720 only
                (PIL LANCZOS, JPEG quality 82), never edited.
  2-title.jpg   ?shot=1 — cover: driving the beachfront avenue, golden hour.
  3-onfoot.jpg  ?shot=2 — on foot in the Market Plaza, ROSA'S sign.
  4-mission.jpg ?shot=4 — at the docks, M1 package marker + Rosa's line.

Game shots are real renders of the game's own code in a headless browser
(Playwright + the vendored chrome-headless-shell, software GL). Playwright's
page.screenshot hangs at 1280x720 under SwiftShader, so captures go through
raw CDP Page.captureScreenshot instead.

Run from the repo root:  python3 tests/shots.py
Exit 0 when all 4 files exist at 1280x720 and <= 256 KiB each, else exit 1.
"""

import base64
import json
import os
import socket
import subprocess
import sys
import time

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKSPACE = os.path.dirname(os.path.dirname(os.path.dirname(REPO)))
SHOTS_DIR = os.path.join(REPO, "screenshots")
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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def load_config():
    with open(os.path.join(REPO, "shots.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    assert cfg["width"] == 1280 and cfg["height"] == 720, "shots.json must be 1280x720"
    assert len(cfg["shots"]) == 4, "shots.json must name 4 shots"
    return cfg


def make_hero(cfg, shot):
    """Resize Romi's hero image to 1280x720. Content untouched."""
    src = os.path.join(WORKSPACE, shot["source"])
    assert os.path.exists(src), f"hero source missing: {src}"
    out = os.path.join(SHOTS_DIR, shot["file"])
    img = Image.open(src).convert("RGB")
    img = img.resize((cfg["width"], cfg["height"]), Image.LANCZOS)
    img.save(out, "JPEG", quality=cfg.get("quality", 82))
    return out


def cdp_shot(cdp, path, quality):
    res = cdp.send("Page.captureScreenshot",
                   {"format": "jpeg", "quality": quality, "fromSurface": True})
    with open(path, "wb") as f:
        f.write(base64.b64decode(res["data"]))
    return path


def wait_shot_ready(page, shot_no, timeout_s=90):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            state = page.evaluate(
                "() => ({ ready: !!window.__shotReady, "
                "screen: window.__GTA ? window.__GTA.screen : 0 })")
        except Exception:
            state = {"ready": False, "screen": 0}
        if state["ready"] and state["screen"] == shot_no:
            return True
        time.sleep(0.5)
    return False


def make_game_shot(pw, port, cfg, shot, errors):
    """Stage ?shot=N in a fresh browser context and capture it."""
    browser = pw.chromium.launch(executable_path=CHROME, args=CHROME_ARGS)
    try:
        ctx = browser.new_context(
            viewport={"width": cfg["width"], "height": cfg["height"]})
        page = ctx.new_page()
        page.on("console",
                lambda m: errors.append(f"[{shot['file']}] console.{m.type}: {m.text}")
                if m.type == "error" else None)
        page.on("pageerror",
                lambda e: errors.append(f"[{shot['file']}] pageerror: {e}"))
        page.goto(
            f"http://localhost:{port}/?shot={shot['shot']}&seed={cfg.get('seed', 7)}",
            timeout=30000)
        if not wait_shot_ready(page, shot["shot"]):
            errors.append(f"[{shot['file']}] __shotReady never fired for shot {shot['shot']}")
            return None
        # Let the autopilot drive a moment and the HUD settle.
        page.wait_for_timeout(1200)
        gta = page.evaluate("() => window.__GTA ? {...window.__GTA} : null")
        if not gta or gta.get("screen") != shot["shot"]:
            errors.append(f"[{shot['file']}] __GTA.screen is {gta and gta.get('screen')}, "
                          f"expected {shot['shot']}")
            return None
        cdp = ctx.new_cdp_session(page)
        out = os.path.join(SHOTS_DIR, shot["file"])
        cdp_shot(cdp, out, cfg.get("quality", 82))
        return out
    finally:
        browser.close()


def verify(path, cfg):
    """A finished screenshot: JPEG, 1280x720, <= 256 KiB."""
    problems = []
    if not os.path.exists(path):
        return ["missing file"]
    size = os.path.getsize(path)
    if size > 256 * 1024:
        problems.append(f"{size} bytes > 256 KiB")
    try:
        with Image.open(path) as img:
            if img.format != "JPEG":
                problems.append(f"format {img.format}, not JPEG")
            if img.size != (cfg["width"], cfg["height"]):
                problems.append(f"size {img.size}, not 1280x720")
    except Exception as exc:
        problems.append(f"unreadable image: {exc}")
    return problems


def main():
    from playwright.sync_api import sync_playwright

    cfg = load_config()
    os.makedirs(SHOTS_DIR, exist_ok=True)
    errors = []
    produced = []

    port = free_port()
    server = subprocess.Popen(
        ["node", "serve.ts", str(port)], cwd=REPO,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        # Wait for the server to answer.
        deadline = time.time() + 15
        import urllib.request
        while time.time() < deadline:
            try:
                urllib.request.urlopen(f"http://localhost:{port}/", timeout=2)
                break
            except Exception:
                time.sleep(0.3)
        else:
            print("FAIL: serve.ts did not answer")
            return 1

        with sync_playwright() as pw:
            for shot in cfg["shots"]:
                if shot["kind"] == "hero":
                    out = make_hero(cfg, shot)
                    print(f"hero   -> {shot['file']}")
                else:
                    out = make_game_shot(pw, port, cfg, shot, errors)
                    print(f"shot {shot['shot']} -> {shot['file']}")
                if out:
                    produced.append(out)
    finally:
        server.terminate()
        try:
            server.communicate(timeout=5)
        except Exception:
            server.kill()

    ok = True
    for path in produced:
        problems = verify(path, cfg)
        size = os.path.getsize(path) if os.path.exists(path) else 0
        status = "OK  " if not problems else "BAD "
        print(f"{status} {os.path.basename(path)}  {size} bytes"
              + (f"  ({'; '.join(problems)})" if problems else ""))
        if problems:
            ok = False
    for shot in cfg["shots"]:
        if os.path.join(SHOTS_DIR, shot["file"]) not in produced:
            print(f"BAD  {shot['file']}  (not produced)")
            ok = False
    if errors:
        ok = False
        print("page/console errors:")
        for e in errors:
            print(f"  {e}")
    print("shots.py: " + ("PASS — 4 screenshots" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
