#!/usr/bin/env python3
"""量化「哪里模糊、糊多少」:同一帧开/关移轴(tilt-shift)各截一张,分区域量锐度。

    python3 tools/blurcheck.py

锐度 = 拉普拉斯响应方差(对灰度图);保留率 = 开移轴 / 关移轴。
遮罩公式(src/postfx.js):
    d = |uv.y - uFocus(0.53)|;k = smoothstep(uBand 0.135, 0.435, d)
    k = max(k, smoothstep(0.34, 0.52, |uv.x - 0.5|) * 0.85)
    stp = uDir * uTexel * k * uAmount(≈4.6px);5 tap:±1.38 / ±3.23
"""
import pathlib

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
CDP, PORT = "http://127.0.0.1:9333", 8189

# ⚠ 必须先关胶片颗粒(post.film.uniforms.uGrain = 0):
# 颗粒是最后一道加的高频噪声,不关会把拉普拉斯方差整个占满,
# 于是"开不开移轴"测出来都一样(我第一次就这么翻车的)。
REGIONS = {
    "雪山顶(20-34%)": (0.20, 0.34, 0.30, 0.70),
    "岛中部(42-58%)": (0.42, 0.58, 0.30, 0.70),   # 理论上的清晰带
    "岛下缘(64-78%)": (0.64, 0.78, 0.30, 0.70),
    # 左右边缘量不了:岛只占中间 34%~66%,两侧是空背景,拉普拉斯方差≈0

}


def sharp(path: pathlib.Path, box) -> float:
    a = np.asarray(Image.open(path).convert("L"), dtype=np.float32)
    h, w = a.shape
    r0, r1, c0, c1 = box
    sub = a[int(r0 * h):int(r1 * h), int(c0 * w):int(c1 * w)]
    lap = (-4 * sub[1:-1, 1:-1] + sub[:-2, 1:-1] + sub[2:, 1:-1]
           + sub[1:-1, :-2] + sub[1:-1, 2:])
    return float(lap.var())


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    on, off = SHOTS / "blur-on.png", SHOTS / "blur-off.png"
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        pg = b.contexts[0].new_page()
        pg.set_default_timeout(120000)
        pg.goto(f"http://127.0.0.1:{PORT}/index.html?t=0.62&freeze=1&dpr=1&ui=0", wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=120000)
        pg.evaluate("() => { window.__world.post.film.uniforms.uGrain.value = 0; }")
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 30}", timeout=120000)
        # 移轴现在默认关:先确保打开再拍"开"的那张
        if not pg.evaluate("() => window.__world.post.state.tilt"):
            pg.keyboard.press("f")
            n = pg.evaluate("window.__frames")
            pg.wait_for_function(f"window.__frames >= {n + 6}", timeout=120000)
        pg.screenshot(path=str(on))
        pg.keyboard.press("f")                     # F = 开关移轴
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 6}", timeout=120000)
        state = pg.evaluate("() => window.__world.post.state")
        pg.screenshot(path=str(off))
        pg.close()
    print(f"移轴关掉后 state.tilt = {state['tilt']}")
    print(f"{'区域':<14} {'开移轴':>9} {'关移轴':>9} {'保留率':>7}")
    for name, box in REGIONS.items():
        s_on, s_off = sharp(on, box), sharp(off, box)
        print(f"{name:<14} {s_on:>9.1f} {s_off:>9.1f} {s_on / s_off * 100:>6.0f}%")
    print("\n图:tools/shots/blur-on.png / blur-off.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
