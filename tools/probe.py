#!/usr/bin/env python3
"""把镜头推到任意世界坐标看细节,并可逐个关掉可疑网格 —— 定位"这道缝是谁"。

    python3 tools/probe.py --look 3.4,0.0,-0.6 --zoom 6 --time 0.72
    python3 tools/probe.py --look 3.4,0.0,-0.6 --zoom 6 --hide stairs,stone-lanterns
    python3 tools/probe.py --look 3.4,0.0,-0.6 --zoom 6 --shadow 0 --name noshadow

--hide 可用名字:terrain underside stairs stone-lanterns trees-pine trees-blossom
  trees-conifer bamboo shrubs rocks grass flowers lake river waterfall clouds atmos
  light-shafts dust fireflies glass architecture immortals deer rabbits cranes
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
CDP, PORT = "http://127.0.0.1:9333", 8189

JS = """
([x, y, z, zoom, hide]) => {
  const W = window.__world;
  const c = W.camera, ctl = W.controls;
  c.position.set(x + 6, y + 5.8, z + 6);     // 只定方向(正交相机)
  ctl.target.set(x, y, z);
  ctl.maxZoom = 80;
  ctl.update();
  c.zoom = zoom;
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  // 按名字关网格:先看自身 name,再看祖先 group name
  const hidden = [];
  W.scene.traverse((o) => {
    if (!o.isMesh) return;
    let n = o.name, p = o.parent;
    while (!n && p) { n = p.name; p = p.parent; }
    let n2 = o.parent ? o.parent.name : '';
    if (hide.includes(n) || hide.includes(n2)) { o.visible = false; hidden.push(n || n2); }
  });
  return { hidden: [...new Set(hidden)] };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--look", required=True, help="x,y,z")
    ap.add_argument("--zoom", type=float, default=6.0)
    ap.add_argument("--time", type=float, default=0.62)
    ap.add_argument("--hide", default="")
    ap.add_argument("--shadow", default="1")
    ap.add_argument("--name", default="probe")
    args = ap.parse_args()
    x, y, z = (float(v) for v in args.look.split(","))
    hide = [h for h in args.hide.split(",") if h]
    SHOTS.mkdir(parents=True, exist_ok=True)
    errs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        pg = b.contexts[0].new_page()
        pg.set_default_timeout(120000)
        pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
        q = f"http://127.0.0.1:{PORT}/index.html?t={args.time}&freeze=1&dpr=1&ui=0"
        if args.shadow != "1":
            q += f"&shadow={args.shadow}"
        pg.goto(q, wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=120000)
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 20}", timeout=120000)
        info = pg.evaluate(JS, [x, y, z, args.zoom, hide])
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 6}", timeout=120000)
        out = SHOTS / f"{args.name}.png"
        pg.screenshot(path=str(out))
        pg.close()
    print(f"look=({x},{y},{z}) zoom={args.zoom} t={args.time} shadow={args.shadow} "
          f"hide={hide} -> {out.name}  关掉={info['hidden']}")
    print(f"console errors: {len(errs)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
