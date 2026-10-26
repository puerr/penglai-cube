#!/usr/bin/env python3
"""朝向断言:取实例矩阵的 +x 轴,与两帧之间的位移方向做点积(归一到余弦)。

动物"反着走"这类问题肉眼看截图很难判 —— 矩阵点积是 +1 / -1 的判据。

    python3 tools/facing.py
"""
import os
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(ROOT / ".browsers"))
PAGE = (ROOT / "index.html").as_uri()
ARGS = [
    "--ozone-platform=headless", "--use-gl=angle", "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage",
]

SAMPLE = """(name) => {
  const o = window.__world.scene.getObjectByName(name);
  const mat = o.matrixWorld.clone();
  const out = [];
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, mat);
    const e = mat.elements;
    out.push({ x: e[12], z: e[14], ax: e[0], az: e[2] });
  }
  return out;
}"""


def main() -> int:
    env = {k: v for k, v in os.environ.items() if k != "DISPLAY"}
    bad = []
    with sync_playwright() as p:
        b = p.chromium.launch(env=env, args=ARGS)
        pg = b.new_page(viewport={"width": 800, "height": 600})
        pg.set_default_timeout(300000)
        pg.goto(PAGE + "?dpr=1", wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=300000)

        for name, label in (("deer", "鹿"), ("rabbits", "兔子"), ("birds", "鸟")):
            a = pg.evaluate(SAMPLE, name)
            f0 = pg.evaluate("window.__frames")
            pg.wait_for_function(f"window.__frames >= {f0 + 3}", timeout=180000)
            bb = pg.evaluate(SAMPLE, name)
            dots = []
            for p1, p2 in zip(a, bb):
                vx, vz = p2["x"] - p1["x"], p2["z"] - p1["z"]
                L = (vx * vx + vz * vz) ** 0.5
                A = (p2["ax"] ** 2 + p2["az"] ** 2) ** 0.5
                if L < 1e-4 or A < 1e-6:
                    continue
                dots.append((p2["ax"] * vx + p2["az"] * vz) / (L * A))
            if not dots:
                print(f"{label}: 位移太小,跳过")
                continue
            avg = sum(dots) / len(dots)
            ok = avg > 0.8
            if not ok:
                bad.append(label)
            print(f"{label}: n={len(dots)}  cos={avg:+.3f} (min {min(dots):+.3f})  "
                  f"{'✅ 朝前' if ok else '❌ 反着走' if avg < -0.8 else '⚠ 侧向'}")
        b.close()
    print()
    print("✅ 朝向全部正确" if not bad else f"❌ 朝向错误: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
