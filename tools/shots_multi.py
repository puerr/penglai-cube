#!/usr/bin/env python3
"""一次会话拍多组参数(诊断用):不同层 / 不同缩放 / 不同时刻。"""
import os, pathlib, sys, time, json
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".browsers"))
PAGE = (ROOT / "index.html").as_uri()
SHOTS = ROOT / "tools" / "shots"
ARGS = ["--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage",
        "--force-device-scale-factor=1"]

def main():
    specs = sys.argv[1:]
    SHOTS.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    errs = []
    with sync_playwright() as p:
        b = p.chromium.launch(env=env, args=ARGS)
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        pg.set_default_timeout(300000)
        pg.set_default_navigation_timeout(300000)
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        for spec in specs:
            name, _, q = spec.partition("=")
            full = f"{PAGE}?ui=0&freeze=1&dpr=1&{q}"
            pg.goto(full, wait_until="load")
            try:
                pg.wait_for_function("window.__worldReady === true", timeout=180000)
            except Exception as e:
                print(f"!! {name} not ready: {e}", pg.evaluate("window.__worldError||null"))
            time.sleep(1.2)
            out = SHOTS / f"d-{name}.png"
            pg.screenshot(path=str(out), timeout=240000)
            print(f"{name:14s} -> {out.name}")
        b.close()
    print("errors:", errs[:10] if errs else "none")

main()
