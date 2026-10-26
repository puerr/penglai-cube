#!/usr/bin/env python3
"""把相机贴到每个仙人站位拍近景,肉眼确认:没浮空、没陷进地面、没被压在屋檐/石头里。

    python3 tools/closeup.py            # 每个站位一张 tools/shots/near-<i>.png
    python3 tools/closeup.py --wide     # 另外再拍一张默认全景
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
CDP, PORT = "http://127.0.0.1:9333", 8189

# ⚠ 主相机是 OrthographicCamera(-1,1,1,-1):拉近靠 zoom,不是靠 position。
JS = """
([i, zoom]) => {
  const W = window.__world;
  const sp = W.parts.architecture.standSpots[i];
  const c = W.camera, ctl = W.controls;
  c.position.set(sp.x + 6, sp.y + 5.8, sp.z + 6);     // 只定方向(正交,距离无所谓)
  ctl.target.set(sp.x, sp.y + 0.10, sp.z);
  ctl.update();
  ctl.maxZoom = 80;            // 平时 maxZoom=4,验几何时临时放开
  c.zoom = zoom;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return { x: sp.x, y: sp.y, z: sp.z, n: W.parts.architecture.standSpots.length };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wide", action="store_true")
    ap.add_argument("--zoom", type=float, default=16.0)
    args = ap.parse_args()
    SHOTS.mkdir(parents=True, exist_ok=True)
    errs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        pg = b.contexts[0].new_page()
        pg.set_default_timeout(120000)
        pg.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:160]))
        pg.goto(f"http://127.0.0.1:{PORT}/index.html?t=0.62&freeze=1&dpr=1&ui=0", wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=120000)
        pg.wait_for_function(f"window.__frames >= {pg.evaluate('window.__frames') + 10}", timeout=120000)
        n = pg.evaluate("window.__world.parts.architecture.standSpots.length")
        print(f"standSpots = {n}")
        for i in range(n):
            sp = pg.evaluate(JS, [i, args.zoom])
            pg.wait_for_function(f"window.__frames >= {pg.evaluate('window.__frames') + 3}",
                                 timeout=120000)
            out = SHOTS / f"near-{i}.png"
            pg.screenshot(path=str(out))
            print(f"  #{i + 1} ({sp['x']:.3f}, {sp['y']:.3f}, {sp['z']:.3f}) -> {out.name}")
        if args.wide:
            pg.goto(f"http://127.0.0.1:{PORT}/index.html?t=0.62&freeze=1&dpr=1&ui=0", wait_until="load")
            pg.wait_for_function("window.__worldReady === true", timeout=120000)
            pg.wait_for_function(f"window.__frames >= {pg.evaluate('window.__frames') + 10}",
                                 timeout=120000)
            pg.screenshot(path=str(SHOTS / "wide.png"))
            print(f"  wide -> wide.png")
    pg.close()   # ⚠ 不关页:CDP 里会堆一堆跑渲染循环的标签页,帧率读数会被拖垮
    print(f"console errors: {len(errs)}" + (f" -> {errs[:2]}" if errs else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
