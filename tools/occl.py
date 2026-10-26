#!/usr/bin/env python3
"""仙人站位遮挡自检。

    python3 tools/occl.py               # A 站位/落地/主视角可见率 + B 仙人视角视野(逐张截图)
    python3 tools/occl.py --no-shots    # 只出数
    python3 tools/occl.py --scan 4      # C 在 4 号障碍(雪峰)周围扫候选点,给出可替换的坐标

指标(单位:立方体边长 10 ⇒ 0.10 ≈ 一层楼高的十分之一):
  mainVis    主等距相机 → 身体 15 个采样点,「首个命中就是仙人本体」的比例;1.00 = 完全不被挡
  povClear   仙人视角 5×5 视锥射线中「最近实体 > 0.35」的比例;1.00 = 视野通透
  贴脸       眼睛 6 个轴向 0.06 内已有实体 ⇒ 眼睛埋在网格里(会拍成全黑)
射线强制 DoubleSide:否则从物体内部打出去时背面被剔除,会得到假的「通透」。
"""
import argparse
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CDP = "http://127.0.0.1:9333"
PORT = 8189
SHOTS = ROOT / "tools" / "shots"

# 参与遮挡判定的东西(白名单:省掉 1.2 万株草/花瓣的逐实例射线,否则一轮要几十秒)
TARGETS = ["terrain", "underside", "architecture", "stairs", "stone-lanterns",
           "trees-pine", "trees-blossom", "trees-conifer", "bamboo", "shrubs", "rocks",
           "immortals", "lake", "river", "waterfall", "cranes", "deer", "rabbits"]

PROBE = r"""
async ({ mode, arg }) => {
  const THREE = await import('/vendor/three/three.module.js');
  const W = window.__world;
  const wl = new Set(%(targets)s);
  const rc = new THREE.Raycaster();
  const V = THREE.Vector3;

  // 只对白名单网格做射线(草的 12000 个实例会把一轮拖到几十秒)
  const targets = [];
  W.scene.traverse((o) => {
    if (!o.isMesh) return;
    let n = o.name, p = o.parent;
    while (!wl.has(n) && p) { n = p.name || n; p = p.parent; }
    if (wl.has(n)) targets.push(o);
  });

  // 强制双面,否则「从网格内部打出去」会被背面剔除骗成通透
  const savedSide = new Map();
  for (const o of targets) {
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (m && m.side !== THREE.DoubleSide && !savedSide.has(m)) {
        savedSide.set(m, m.side); m.side = THREE.DoubleSide; m.needsUpdate = true;
      }
    }
  }
  const restore = () => { for (const [m, s] of savedSide) { m.side = s; m.needsUpdate = true; } };

  const chain = (o) => { const out = [o.name || '?']; let p = o.parent;
    while (p) { out.push(p.name || '?'); p = p.parent; } return out; };
  const tag = (o) => (o.name || chain(o)[0]);

  const near = (o, d, maxD) => {
    rc.set(o, d);
    rc.far = maxD === undefined ? 1e3 : maxD;
    const hs = rc.intersectObjects(targets, true);
    return hs.length ? hs[0] : null;
  };
  const r3 = (v) => +v.toFixed(3);

  const isl = W.island;
  const spots = W.parts.architecture.standSpots;
  const obstacles = W.parts.architecture.obstacles || [];
  const cam = W.camera; cam.updateMatrixWorld();

  const OFF5 = [[0, 0], [0.026, 0], [-0.026, 0], [0, 0.026], [0, -0.026]];
  const HYS = [0.030, 0.100, 0.170];

  const mainVis = (sp) => {
    let vis = 0; const blk = {};
    for (const hy of HYS) for (const [ox, oz] of OFF5) {
      const p = new V(sp.x + ox, sp.y + hy, sp.z + oz);
      const d = p.clone().sub(cam.position); const dist = d.length();
      const h = near(cam.position, d.normalize(), dist + 0.05);
      if (!h || h.distance >= dist - 0.012 || chain(h.object).includes('immortals')) vis++;
      else blk[tag(h.object)] = (blk[tag(h.object)] || 0) + 1;
    }
    return { vis: +(vis / (HYS.length * OFF5.length)).toFixed(2), blk };
  };

  // 视野:朝向 dirYaw 的 5x5 视锥射线
  const vista = (eye, dirYaw, fovDeg, pitch) => {
    let clear = 0, tot = 0, nearMin = 1e3, nearName = '-', sum = 0;
    const hist = {};
    const fov = fovDeg * Math.PI / 180;
    for (let iy = 0; iy < 5; iy++) for (let ix = 0; ix < 5; ix++) {
      const ax = ((ix / 4) * 2 - 1) * fov / 2 * 1.6;      // 水平张角(16:9)
      const ay = ((iy / 4) * 2 - 1) * fov / 2 + pitch;
      const d = new V(Math.sin(dirYaw) * Math.cos(ay), Math.sin(ay), Math.cos(dirYaw) * Math.cos(ay))
        .applyAxisAngle(new V(0, 1, 0), ax).normalize();
      const h = near(eye, d, 60);
      tot++;
      if (h && h.distance <= 0.35) { hist[tag(h.object)] = (hist[tag(h.object)] || 0) + 1; } else clear++;
      if (h) { sum += Math.min(h.distance, 3);
        if (h.distance < nearMin) { nearMin = h.distance; nearName = tag(h.object); } }
    }
    return { clear: +(clear / tot).toFixed(2), near: r3(nearMin), name: nearName,
             avg: +(sum / tot).toFixed(2), hist };
  };

  const tightN = (eye) => {
    let n = 0;
    for (const a of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      if (near(eye, new V(...a), 0.06)) n++;
    }
    return n;
  };

  const centerYaw = (x, z) => Math.atan2(-x, -z);   // 朝岛心(0,0)的水平朝向

  if (mode === 'main') {
    const rows = spots.map((sp, i) => {
      const g = isl.sampleY(sp.x, sp.z);
      const mv = mainVis(sp);
      const ob = obstacles.map((o, k) => ({ k, gap: +(Math.hypot(o.x - sp.x, o.z - sp.z) - o.r).toFixed(3) }))
        .sort((a, b) => a.gap - b.gap).slice(0, 2);
      return { i: i + 1, x: r3(sp.x), y: r3(sp.y), z: r3(sp.z), ry: r3(sp.ry),
               ground: r3(g), gap: r3(sp.y - g), vis: mv.vis, blk: mv.blk, ob };
    });
    restore();
    return { cam: cam.position.toArray().map(r3), rows };
  }

  if (mode === 'sweep') {
    // 绕岛转一圈,看每个仙人在各方位角下被挡的比例(岛是自转的,单一机位会误判)
    const el = Math.atan2(cam.position.y, Math.hypot(cam.position.x, cam.position.z));
    const rad = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
    const yaw0 = Math.atan2(cam.position.z, cam.position.x);
    const rows = spots.map((sp) => ({ x: r3(sp.x), y: r3(sp.y), z: r3(sp.z), v: [] }));
    for (let k = 0; k < arg.n; k++) {
      const a = yaw0 + (k / arg.n) * Math.PI * 2;
      cam.position.set(Math.cos(a) * rad * Math.cos(el), Math.sin(el) * rad,
                       Math.sin(a) * rad * Math.cos(el));
      cam.lookAt(W.controls ? W.controls.target : new V(0, 0, 0));
      cam.updateMatrixWorld();
      spots.forEach((sp, i) => rows[i].v.push(mainVis(sp).vis));
    }
    restore();
    return rows;
  }

  if (mode === 'pov') {
    const pc = window.__povCamera; pc.updateMatrixWorld();
    const eye = pc.position.clone();
    const fwd = new V(0, 0, -1).applyQuaternion(pc.quaternion).normalize();
    const yaw = Math.atan2(fwd.x, fwd.z);
    const pin = vista(eye, yaw, pc.fov, pc.rotation.x);
    const pout = vista(eye, yaw + Math.PI, pc.fov, pc.rotation.x);
    const hC = near(eye, fwd, 3);
    const out = { eye: eye.toArray().map(r3), yaw: r3(yaw), fov: pc.fov,
                  tight: tightN(eye), face: pin, back: pout,
                  center: hC ? [tag(hC.object), r3(hC.distance)] : ['-', -1] };
    restore();
    return out;
  }

  if (mode === 'scan') {
    // arg: {k: 障碍下标, rMin, rMax}
    const ob = obstacles[arg.k];
    const out = [];
    const nA = arg.nA || 16, a0 = (arg.aFrom || 0) * Math.PI / 180;
    const span = ((arg.aTo === undefined ? 360 : arg.aTo) - (arg.aFrom || 0)) * Math.PI / 180;
    for (let ir = 0; ir <= 4; ir++) {
      const r = arg.rMin + (arg.rMax - arg.rMin) * (ir / 4);
      for (let ia = 0; ia < nA; ia++) {
        const a = a0 + span * (ia / nA);
        const x = ob.x + Math.cos(a) * r, z = ob.z + Math.sin(a) * r;
        const y = isl.sampleY(x, z);
        const sl = Math.max(Math.abs(isl.sampleY(x + 0.02, z) - isl.sampleY(x - 0.02, z)),
                            Math.abs(isl.sampleY(x, z + 0.02) - isl.sampleY(x, z - 0.02))) / 0.04;
        const clip = obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 0.02);
        const sp = { x, y, z };
        const mv = mainVis(sp).vis;
        const eye = new V(x, y + 0.176, z);
        const vc = vista(eye, centerYaw(x, z), 64, -0.10);
        const tg = tightN(eye);
        const score = +(mv * 0.45 + vc.clear * 0.40 + Math.min(vc.avg / 1.2, 1) * 0.15
                        - (sl > 0.9 ? 0.35 : 0) - (clip ? 0.9 : 0) - tg * 0.35).toFixed(3);
        out.push({ x: r3(x), z: r3(z), y: r3(y), r: r3(r), a: r3(a / Math.PI * 180),
                   slope: r3(sl), clip, mv, clear: vc.clear, near: vc.near, nm: vc.name,
                   avg: vc.avg, tight: tg, score });
      }
    }
    restore();
    out.sort((p, q) => q.score - p.score);
    return out.slice(0, 10);
  }

  restore();
  return { err: 'unknown mode' };
}
""" % {"targets": repr(sorted(TARGETS))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--time", type=float, default=0.62)
    ap.add_argument("--no-shots", action="store_true")
    ap.add_argument("--scan", type=int, default=-1, help="扫描第 k 个障碍周围的候选站位")
    ap.add_argument("--nang", type=int, default=16)
    ap.add_argument("--astep", type=float, nargs=2, default=None, help="扫描角度范围(度),如 --astep 15 75")
    ap.add_argument("--sweep", type=int, default=0, help="绕岛 N 个方位角统计可见率")
    ap.add_argument("--rmin", type=float, default=0.55)
    ap.add_argument("--rmax", type=float, default=0.95)
    args = ap.parse_args()
    SHOTS.mkdir(parents=True, exist_ok=True)

    errs = []
    with sync_playwright() as p:
        b = p.chromium.connect_over_cdp(CDP)
        pg = b.contexts[0].new_page()
        pg.set_default_timeout(180000)
        pg.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"[:160]))
        pg.goto(f"http://127.0.0.1:{PORT}/index.html?t={args.time}&freeze=1&dpr=1&ui=0",
                wait_until="load")
        pg.wait_for_function("window.__worldReady === true", timeout=180000)
        pg.wait_for_function(f"window.__frames >= {pg.evaluate('window.__frames') + 8}", timeout=180000)

        run = lambda mode, arg=None: pg.evaluate(PROBE, {"mode": mode, "arg": arg})

        if args.sweep:
            print(f"=== D. 绕岛 {args.sweep} 个方位角(等距高度不变),每个仙人能被看见的比例 ===")
            print(f"{'#':>2} {'x':>7} {'y':>7} {'z':>7}  {'最差':>5} {'平均':>5} {'最好':>5}  各角")
            for i, r in enumerate(run("sweep", {"n": args.sweep})):
                v = r["v"]
                print(f"{i + 1:>2} {r['x']:>7.3f} {r['y']:>7.3f} {r['z']:>7.3f}  "
                      f"{min(v):>5.2f} {sum(v) / len(v):>5.2f} {max(v):>5.2f}  "
                      + " ".join(f"{x:.2f}" for x in v))
        elif args.scan >= 0:
            print(f"=== C. 障碍 #{args.scan} 周围候选站位"
                  f"(score = 主视角 0.45 + 通透 0.40 + 有景 0.15;压障碍/太陡/埋网格 扣分)===")
            print(f"{'x':>7} {'z':>7} {'y':>7} {'r':>5} {'角度':>5} {'坡':>5} {'主视角':>5} "
                  f"{'通透':>5} {'最近':>6} {'均距':>5} {'贴脸':>4} {'分':>6}")
            aarg = {}
            if args.astep:
                aarg = {"aFrom": args.astep[0], "aTo": args.astep[1], "nA": args.nang}
            for c in run("scan", {"k": args.scan, "rMin": args.rmin, "rMax": args.rmax, **aarg}):
                print(f"{c['x']:>7.3f} {c['z']:>7.3f} {c['y']:>7.3f} {c['r']:>5.2f} "
                      f"{c['a']:>5.1f} {c['slope']:>5.2f} {c['mv']:>5.2f} {c['clear']:>5.2f} "
                      f"{c['near']:>6.3f} {c['avg']:>5.2f} {c['tight']:>4} {c['score']:>6.3f}"
                      + ("  ⚠压障碍" if c['clip'] else ""))
        else:
            res = run("main")
            print(f"主相机 {res['cam']}")
            print("=== A. 站位 / 落地 / 主视角可见率 ===")
            print(f"{'#':>2} {'x':>7} {'y':>7} {'z':>7} {'地面':>7} {'离地':>6} {'主视角':>6}  "
                  f"最近障碍 / 挡住它的东西")
            for r in res["rows"]:
                ob = r["ob"][0] if r["ob"] else {"k": -1, "gap": 9}
                flag = " ⚠贴障碍" if ob["gap"] < 0.02 else ""
                blk = f"  挡住={r['blk']}" if r["blk"] else ""
                print(f"{r['i']:>2} {r['x']:>7.3f} {r['y']:>7.3f} {r['z']:>7.3f} "
                      f"{r['ground']:>7.3f} {r['gap']:>6.3f} {r['vis']:>6.2f}  "
                      f"#{ob['k']} gap={ob['gap']:.3f}{flag}{blk}")

            if not args.no_shots:
                pg.screenshot(path=str(SHOTS / "occl-main.png"))

            print("\n=== B. 仙人视角(V 逐个切换)===")
            print(f"{'#':>2} {'眼位 x,y,z':>24} {'朝岛心':>6} {'背对':>5} "
                  f"{'最近':>7} {'『名称』':>18} {'均距':>5} {'贴脸':>4}")
            for i in range(len(res["rows"])):
                pg.keyboard.press("v")
                pg.wait_for_function(f"window.__frames >= {pg.evaluate('window.__frames') + 4}",
                                     timeout=180000)
                t = run("pov")
                print(f"{i + 1:>2} {str(t['eye']):>24} {t['face']['clear']:>6.2f} "
                      f"{t['back']['clear']:>5.2f} {t['face']['near']:>7.3f} "
                      f"{('『' + t['face']['name'] + '』'):>18} {t['face']['avg']:>5.2f} "
                      f"{t['tight']:>4}"
                      + (f"  近处={t['face']['hist']}" if t["face"]["hist"] else ""))
                if not args.no_shots:
                    pg.screenshot(path=str(SHOTS / f"pov-{i}.png"))
            pg.keyboard.press("Escape")

    pg.close()   # ⚠ 不关页:CDP 里会堆一堆跑渲染循环的标签页,帧率读数会被拖垮
    print(f"\nconsole errors: {len(errs)}" + (f" -> {errs[:3]}" if errs else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
