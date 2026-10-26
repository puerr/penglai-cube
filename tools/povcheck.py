#!/usr/bin/env python3
"""仙人视角验收:逐位切 V 截图 + 报俯仰角 / 视野里"岛"的占比,最后验 ESC 能否退回主相机。

    python3 tools/povcheck.py
临时脚本请写在工作区内,别放 /tmp。
"""
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tools" / "shots"
CDP, PORT = "http://127.0.0.1:9333", 8189

OCC = """
async () => {
  const THREE = await import('/vendor/three/three.module.js');
  const c = window.__povCamera; c.updateMatrixWorld();
  const W = window.__world, rc = new THREE.Raycaster(), V = THREE.Vector3;
  const o = c.position.clone();
  let near = 0, empty = 0, tot = 0;
  for (let iy = 0; iy < 5; iy++) for (let ix = 0; ix < 5; ix++) {
    const d = new V((ix / 4) * 2 - 1, (iy / 4) * 2 - 1, 0.5).unproject(c).sub(o).normalize();
    rc.set(o, d); rc.far = 60;
    const hs = rc.intersectObject(W.scene, true)
      .filter((h) => !/dust|fireflies|clouds|sky|atmos|glass/.test(h.object.name || 'x'));
    tot++;
    if (!hs.length || hs[0].distance > 4) empty++; else near++;
  }
  return { island: +(near / tot).toFixed(2), empty: +(empty / tot).toFixed(2) };
}
"""


def main() -> int:
    errs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        pg = b.contexts[0].new_page()
        pg.set_default_timeout(120000)
        pg.on("console", lambda m: errs.append(m.text[:120]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:120]))
        pg.goto(f"http://127.0.0.1:{PORT}/index.html?t=0.62&freeze=1&dpr=1&ui=0&pov=1",
                wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=120000)
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 10}", timeout=120000)
        n_spot = pg.evaluate("window.__world.parts.architecture.standSpots.length")
        print(f"standSpots = {n_spot}")
        for idx in range(n_spot):
            if idx:
                pg.keyboard.press("v")
                n = pg.evaluate("window.__frames")
                pg.wait_for_function(f"window.__frames >= {n + 5}", timeout=120000)
            info = pg.evaluate("""() => { const c = window.__povCamera;
                return { pos: c.position.toArray().map((v) => +v.toFixed(3)),
                         pitch: +c.rotation.x.toFixed(3), yaw: +c.rotation.y.toFixed(3) }; }""")
            occ = pg.evaluate(OCC)
            print(f"  #{idx + 1} pitch={info['pitch']:+.3f} ({info['pitch'] * 57.3:+.0f}°) "
                  f"岛占比={occ['island']:.2f} 空={occ['empty']:.2f}  眼位={info['pos']}")
            pg.screenshot(path=str(SHOTS / f"pv-{idx}.png"))
        # ESC 退回主相机
        pg.keyboard.press("Escape")
        n = pg.evaluate("window.__frames")
        pg.wait_for_function(f"window.__frames >= {n + 3}", timeout=120000)
        back = pg.evaluate("() => window.__world.post.renderPass.camera === window.__world.camera")
        print(f"ESC 退回主相机: {back}")
        pg.close()
    print(f"console errors: {len(errs)}" + (f" -> {errs[:3]}" if errs else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
