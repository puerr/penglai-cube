#!/usr/bin/env python3
"""验收:headless chromium 打开 index.html,收 console 错误 + 按时刻截图 + 打 draw call。

环境里没有真 GPU,靠 ANGLE/swiftshader 软件光栅。要清掉 DISPLAY,
否则 ANGLE 会去连一个不存在的 X server,WebGL2 起不来。

用法:
    python3 tools/verify.py                       # 默认三个时刻
    python3 tools/verify.py --times 0.05 0.25 0.45 0.68 0.9
    python3 tools/verify.py --query "glass=basic" --no-shot
"""
import argparse
import json
import os
import pathlib
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 工作区内的浏览器安装目录(默认 ~/.cache 里的那份是失效软链)
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".browsers"))
PAGE = (ROOT / "index.html").as_uri()
SHOTS = ROOT / "tools" / "shots"

ARGS = [
    "--ozone-platform=headless",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--force-device-scale-factor=1",
]


def find_chrome():
    """这台机器的 playwright 客户端与已下载的 chromium 版本号不一定对得上,
    所以直接扫 ms-playwright 目录挑一个能用的 chrome 可执行文件。"""
    import glob
    cands = sorted(glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome")))
    if not cands:
        env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
        if env_path:
            cands = sorted(glob.glob(os.path.join(env_path, "chromium-*/chrome-linux*/chrome")))
    return cands[-1] if cands else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--times", nargs="*", type=float, default=[0.3, 0.46, 0.86])
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--wait", type=float, default=1.6)
    ap.add_argument("--query", default="")
    ap.add_argument("--prefix", default="w")
    ap.add_argument("--no-shot", action="store_true")
    ap.add_argument("--dpr", type=float, default=1.0)
    args = ap.parse_args()

    SHOTS.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    failed = False

    with sync_playwright() as p:
        browser = p.chromium.launch(env=env, args=ARGS)
        page = browser.new_page(viewport={"width": args.width, "height": args.height})
        page.set_default_timeout(300000)
        page.set_default_navigation_timeout(300000)

        logs, errors = [], []
        page.on("console", lambda m: (logs.append(f"[{m.type}] {m.text}"),
                                      errors.append(m.text) if m.type == "error" else None))
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        for t in args.times:
            q = f"?t={t}&freeze=1&debug=1&dpr={args.dpr}"
            if args.query:
                q += "&" + args.query.strip("&")
            url = PAGE + q
            t0 = time.time()
            page.goto(url, wait_until="load")
            try:
                page.wait_for_function("window.__worldReady === true", timeout=120000)
            except Exception as exc:  # noqa: BLE001
                failed = True
                print(f"!! [{t}] 页面未就绪: {exc}")
                print("   __worldError:", page.evaluate("window.__worldError || null"))
            load = time.time() - t0
            time.sleep(args.wait)

            stats = page.evaluate("window.__worldStats ? window.__worldStats() : null")
            print(f"--- t={t}  load={load:.1f}s")
            print("    stats:", json.dumps(stats, ensure_ascii=False))

            if not args.no_shot:
                out = SHOTS / f"{args.prefix}-{str(t).replace('.', '')}.png"
                page.screenshot(path=str(out), timeout=240000)
                print(f"    shot : {out.relative_to(ROOT)}")

        browser.close()

    if errors:
        failed = True
        print(f"\n!! console/page errors ({len(errors)}):")
        for e in errors[:40]:
            print("   ", e)
    else:
        print("\n✅ console 干净:0 error / 0 pageerror")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
