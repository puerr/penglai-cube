#!/usr/bin/env python3
"""GPU 验收(走 Windows 侧 Chrome 的 CDP):截图 + 帧率 + drawcall。

前置:
  1) Windows 侧 Chrome 已用 --remote-debugging-port=9333 启动(见 KB: 方法库/可用能力台账 §0)
  2) 本目录有常驻 http 服务:python3 -m http.server 8189

    python3 tools/gpu.py --times 0.30 0.72 --prefix p
"""
import argparse
import json
import pathlib
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDP = "http://127.0.0.1:9333"
PORT = 8189
SHOTS = ROOT / "tools" / "shots"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--times", nargs="*", type=float, default=[0.30])
    ap.add_argument("--prefix", default="p")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--query", default="")
    ap.add_argument("--frames", type=int, default=40)
    args = ap.parse_args()
    SHOTS.mkdir(parents=True, exist_ok=True)

    errs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        ctx = b.contexts[0]
        pg = ctx.new_page()
        pg.set_default_timeout(120000)
        pg.on("console", lambda m: errs.append(f"[{m.type}] {m.text}"[:200]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:200]))
        for t in args.times:
            q = f"http://127.0.0.1:{PORT}/index.html?t={t}&freeze=1&dpr=1&ui=0"
            if args.query:
                q += "&" + args.query.strip("&")
            t0 = time.time()
            pg.goto(q, wait_until="load")
            pg.wait_for_function("window.__worldReady === true", timeout=120000)
            load = time.time() - t0
            # 热身:首帧包含着色器编译,别算进 fps
            w0 = pg.evaluate("window.__frames")
            pg.wait_for_function(f"window.__frames >= {w0 + 60}", timeout=120000)
            f0 = pg.evaluate("window.__frames")
            t1 = time.time()
            pg.wait_for_function(f"window.__frames >= {f0 + args.frames}", timeout=120000)
            fps = args.frames / (time.time() - t1)
            st = pg.evaluate("window.__worldStats()")
            out = SHOTS / f"{args.prefix}-{str(t).replace('.', '')}.png"
            pg.screenshot(path=str(out), timeout=120000)
            print(f"t={t}  load={load:.1f}s  {fps:.0f} fps  calls={st['calls']} "
                  f"tri={st['triangles']}  → {out.name}")
        pg.close()
        b.close()

    gpu = "?"
    print("errors:", errs[:5] if errs else "无")
    return 1 if errs else 0


if __name__ == "__main__":
    raise SystemExit(main())
