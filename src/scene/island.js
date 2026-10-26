/**
 * 岛体:高度场 + 顶点配色 + 悬浮的倒锥岩底。
 * 河/湖/瀑布的水位在这里按地形算出来,water.js 再照着长水面 —— 两者共用一份剖面,不会穿帮。
 *
 * 性能:河道距离用网格桶索引;给植被/动物另建一张高度场缓存(sampleY),
 * 避免几十万次 simplex 采样把首帧拖到十几秒。
 */
import * as THREE from 'three';
import { makeNoise2D, fbm, ridged, sn, clamp, lerp, smoothstep } from '../lib/noise.js';

// 岛体整体放大比例:立方体 11,岛体占满内部又不顶到玻璃
const S = 1.24;    // 与 CUBE 同比缩小,岛/箱比例保持不变    // 岛体再放大一档:原来在箱子里像一颗枣核
const SY = 1.16;

// 峰高/半径是按"坡度 < 2 (约 63°)"反推的:之前峰太瘦太高,
// 网格采样差到 0.19/0.02 单位,渲染出来就是一片碎玻璃尖刺。
const PEAKS = [
  { x: -1.16, z: -1.34, h: 1.72, r: 1.34, k: 1.5 },
  { x: -2.08, z: 0.36, h: 1.22, r: 1.10, k: 1.45 },
  { x: -0.16, z: -1.94, h: 0.92, r: 0.96, k: 1.35 },
  { x: -1.60, z: -0.60, h: 0.70, r: 1.34, k: 1.15 },
  { x: 0.62, z: -1.62, h: 0.44, r: 0.88, k: 1.25 },
];

const LAKE = { x: 0.96 * 1.28, z: -0.40 * 1.28, r: 0.92 * 1.18 };
const BASIN_D = 0.72 * 1.16;          // 盆心深度
const BASIN_R = LAKE.r * 1.45;        // 盆缘半径(此处地形回到原状)

const RIVER_A = [
  [-1.44, -0.66], [-1.25, -0.15], [-0.90, 0.25], [-0.45, 0.42],
  [-0.05, 0.25], [0.25, -0.05], [0.50, -0.40],
];
const RIVER_B = [
  [1.72, -0.66], [2.12, -0.92], [2.56, -0.76], [2.90, -0.32],
  [3.10, 0.40], [3.14, 1.20], [3.04, 1.95], [2.84, 2.52],
];
const SPOUT_ANG = Math.atan2(2.5, 2.9);

const CORE_COLOR = new THREE.Color('#4f8a68');

const C = {
  grassA: new THREE.Color('#5f9a72'),
  grassB: new THREE.Color('#37684f'),
  grassC: new THREE.Color('#86ad86'),
  moss: new THREE.Color('#4f8270'),
  rockA: new THREE.Color('#5f6f6c'),
  rockB: new THREE.Color('#514f52'),
  rockC: new THREE.Color('#7f8f84'),
  snow: new THREE.Color('#eef8f6'),
  snowB: new THREE.Color('#c2e0dc'),
  sand: new THREE.Color('#a8b096'),
  bed: new THREE.Color('#7f9280'),
  edgeEarth: new THREE.Color('#31513f'),
  deepRock: new THREE.Color('#6b5643'),
  deepRock2: new THREE.Color('#3b3029'),
};

function flipWinding(geo) {
  const idx = geo.getIndex();
  const arr = idx.array;
  for (let i = 0; i < arr.length; i += 3) {
    const t = arr[i];
    arr[i] = arr[i + 2];
    arr[i + 2] = t;
  }
  idx.needsUpdate = true;
  geo.computeVertexNormals();
}

/**
 * 缝合极坐标网格 θ=0 的接缝。
 * 网格在 i=0 与 i=SEGS 处留了两个**位置完全相同**的顶点(321 列跑 0..2π),
 * computeVertexNormals 让它们各自只看得到一侧的三角形 ⇒ 两边法线不一样
 * (实测 133 行里 91 行有跳变,最大差 0.53 ≈ 32°)。
 * 结果就是一条从岛心射向海岸的硬明暗线 —— 桥边那道"缝隙"就是它,不是几何破洞。
 * 按位置把重合顶点的法线取平均即可。
 */
function weldSeamNormals(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const groups = new Map();
  // ⚠ 不能用 toFixed 当键:接缝两点的 z 相差 1e-15,一个算出 "-0.00000"、一个 "0.00000",
  //   键就永远对不上(第一版就是这么白改的)。Math.round 出来的 -0 在模板串里是 "0"。
  const q = (v) => Math.round(v * 1e5);
  for (let i = 0; i < pos.count; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  }
  const v = new THREE.Vector3();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of g) { v.x += nor.getX(i); v.y += nor.getY(i); v.z += nor.getZ(i); }
    if (v.lengthSq() < 1e-12) continue;
    v.normalize();
    for (const i of g) nor.setXYZ(i, v.x, v.y, v.z);
  }
  nor.needsUpdate = true;
  return geo;
}

/** 朝上的地表:法线 y 之和为负就翻 */
function ensureUp(geo) {
  const n = geo.getAttribute('normal');
  let sum = 0;
  for (let i = 0; i < n.count; i++) sum += n.getY(i);
  if (sum < 0) flipWinding(geo);
  return geo;
}

/**
 * 绕 y 轴的回转体(岩底倒锥):法线的**水平分量**要指向外。
 * ⚠ 这里不能用 ensureUp —— 倒锥的正确法线本来就是朝下的,
 * 用"y 之和为负就翻"会把它整个翻成里朝外 → 从外面看被背面剔除,像"透明"。
 */
function ensureOutward(geo) {
  const n = geo.getAttribute('normal');
  const pos = geo.getAttribute('position');
  let sum = 0;
  for (let i = 0; i < n.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    if (r < 1e-4) continue;
    sum += (n.getX(i) * pos.getX(i) + n.getZ(i) * pos.getZ(i)) / r;
  }
  if (sum < 0) flipWinding(geo);
  return geo;
}

export function createIsland() {
  const n1 = makeNoise2D(1337);
  const n2 = makeNoise2D(90210);
  const n3 = makeNoise2D(5150);
  const n4 = makeNoise2D(777);

  /** 只随方位角变化的岸线半径(岬角在瀑布口) */
  function coastR(x, z) {
    const rr = Math.hypot(x, z) || 1;
    const ux = x / rr, uz = z / rr;
    let R = 3.04 * S + 0.34 * S * sn(fbm(n3, ux * 3.0 + 5.5, uz * 3.0 - 2.2, 2));
    let da = Math.atan2(uz, ux) - SPOUT_ANG;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    R += 0.62 * S * Math.exp(-(da * da) / (2 * 0.16 * 0.16));
    return R;
  }

  /** 未经河道下切的地形 */
  function naturalH(x, z) {
    const r = Math.hypot(x, z);
    const Rc = coastR(x, z);
    const rim = smoothstep(Rc, Rc - 0.50 * S, r);

    let h = (0.15
      + 0.135 * sn(fbm(n1, x * 0.8, z * 0.8, 4))
      + 0.045 * sn(fbm(n1, x * 2.5, z * 2.5, 3))) * SY;

    let mtn = 0;
    for (let i = 0; i < PEAKS.length; i++) {
      const p = PEAKS[i];
      const d = Math.hypot(x - p.x * S, z - p.z * S) / (p.r * S);
      mtn += p.h * SY * Math.exp(-Math.pow(d, p.k) * 1.05);
    }
    const rg = ridged(n2, x * 1.1 + 4.2, z * 1.1 - 1.7, 2);
    mtn *= 0.90 + 0.20 * rg;
    h += mtn;

    const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
    // 宽而浅的盆:在 BASIN_R 处正好归零。原来是 exp 窄碗(r*0.66),深径比到 0.79,
    // 水只填得住半径 0.7 的一小汪,外面留一大圈干碗 = 看着像个空洞。
    {
      const tt = Math.min(1, ld / BASIN_R);
      const s2 = 1 - tt * tt;
      h -= BASIN_D * s2 * s2;
    }

    return h * rim;
  }

  // ---------- 水位剖面 ----------
  // 湖面高度按"湖岸一圈的平均地高"定 —— 之前用湖心反推,盆的尾巴把周边压低,
  // 水位反而高过四周草地 0.2,全岛 48% 的点被判成水下。
  // 水位 = 湖岸一圈(1.20·r)的低分位,再低 0.05 —— 物理上就是"湖面平到出水口"。
  // 试过三种:① 湖心反推(湖心贴山脚,水位被抬高 → 淹掉半个草地)
  //            ② 全圈平均(被山侧拉高,同样淹)
  //            ③ 面积分位(地形不均时偏到一边)
  // 只有"低分位 + 固定余量"既不会淹、也不受方向影响。盆改成宽而浅之后,
  // 岸线会自然落在 ~1.0·LAKE.r。
  const rimVals = [];
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    const rr = LAKE.r * 1.32;   // 取样在盆外,拿到的是真实岸高
    rimVals.push(naturalH(LAKE.x + Math.cos(a) * rr, LAKE.z + Math.sin(a) * rr));
  }
  rimVals.sort((p, q) => p - q);
  let lowSum = 0;
  for (let k = 0; k < 8; k++) lowSum += rimVals[k];
  const lakeY = lowSum / 8 - 0.05 * SY;

  function profile(points, opts) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x * S, 0, z * S)), false, 'catmullrom', 0.4,
    );
    const N = 160;
    const pts = curve.getSpacedPoints(N);
    const wy = new Float32Array(N + 1);
    for (let i = 0; i <= N; i++) wy[i] = naturalH(pts[i].x, pts[i].z) - 0.13 * SY;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i <= N; i++) wy[i] = Math.min(wy[i], wy[i - 1] - opts.slope);
      for (let i = 1; i < N; i++) wy[i] = (wy[i - 1] + wy[i] * 2 + wy[i + 1]) * 0.25;
    }
    if (opts.start !== undefined) {
      for (let i = 0; i <= N; i++) wy[i] = lerp(opts.start, wy[i], smoothstep(0, 0.35, i / N));
    }
    if (opts.end !== undefined) {
      for (let i = 0; i <= N; i++) wy[i] = lerp(opts.end, wy[i], smoothstep(0, 0.30, (N - i) / N));
    }
    let lo = Infinity;
    for (let i = 0; i <= N; i++) { lo = Math.min(lo, wy[i]); wy[i] = lo; }
    return {
      N,
      width: 0.178 * S,
      wy,
      pts: pts.map((p, i) => new THREE.Vector3(p.x, wy[i], p.z)),
    };
  }

  const rivA = profile(RIVER_A, { end: lakeY - 0.03, slope: 0.0022 });
  const rivB = profile(RIVER_B, { start: lakeY - 0.03, slope: 0.0022 });
  const rivers = [rivA, rivB];

  // ---------- 河道网格索引 ----------
  const CH_W = 0.192 * S;    // 满深下切的半宽(水面 0.178·S 略窄于它,两边才有岸)
  const CH_SH = 0.20 * S;    // 岸边过渡带(原来 0.42 太宽,等于挖了一条大沟)
  const CELL = 0.55;
  const G_MIN = -6.6;
  const G_N = Math.ceil(13.2 / CELL) + 1;

  const total = rivers.reduce((s, r) => s + r.N + 1, 0);
  const cpx = new Float32Array(total);
  const cpz = new Float32Array(total);
  const cwy = new Float32Array(total);
  let cp = 0;
  for (const r of rivers) {
    for (let i = 0; i <= r.N; i++) {
      cpx[cp] = r.pts[i].x;
      cpz[cp] = r.pts[i].z;
      cwy[cp] = r.wy[i];
      cp++;
    }
  }
  const buckets = new Array(G_N * G_N);
  for (let i = 0; i < total; i++) {
    const ci = clamp(Math.floor((cpx[i] - G_MIN) / CELL), 0, G_N - 1);
    const cj = clamp(Math.floor((cpz[i] - G_MIN) / CELL), 0, G_N - 1);
    const k = cj * G_N + ci;
    (buckets[k] || (buckets[k] = [])).push(i);
  }

  const NO_CH = { d: 999, wy: 0 };
  function channel(x, z) {
    const ci = Math.floor((x - G_MIN) / CELL);
    const cj = Math.floor((z - G_MIN) / CELL);
    if (ci < 0 || cj < 0 || ci >= G_N || cj >= G_N) return NO_CH;
    let best = 1e9, found = false;
    // ⚠ 水位必须用**加权平均**,不能取"最近那个采样点"的 wy:
    // 最近点一切换下切目标就跳一次,河道两边每个顶点都可能跳到不同水位,
    // 网格密的地方(极心附近)就变成一道道径向皱纹。
    let wsum = 0, wysum = 0;
    const SIG2 = 0.09;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = cj + dj;
      if (jj < 0 || jj >= G_N) continue;
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di;
        if (ii < 0 || ii >= G_N) continue;
        const b = buckets[jj * G_N + ii];
        if (!b) continue;
        found = true;
        for (let k = 0; k < b.length; k++) {
          const id = b[k];
          const dx = x - cpx[id];
          const dz = z - cpz[id];
          const d2 = dx * dx + dz * dz;
          if (d2 < best) best = d2;
          const w = 1 / (d2 + SIG2);
          wsum += w;
          wysum += w * cwy[id];
        }
      }
    }
    if (!found) return NO_CH;
    return { d: Math.sqrt(best), wy: wysum / wsum };
  }

  function heightAt(x, z) {
    let h = naturalH(x, z);
    const ch = channel(x, z);
    if (ch.d < CH_W + CH_SH) {
      const k = smoothstep(CH_W + CH_SH, CH_W, ch.d);
      h = lerp(h, Math.min(h, ch.wy - 0.13 * SY), k);
    }
    return h;
  }

  const lakeDist = (x, z) => Math.hypot(x - LAKE.x, z - LAKE.z);

  // ---------- 高度场缓存(给植被/动物用) ----------
  const FG_MIN = -5.4;
  const FG_MAX = 5.4;
  const FG_N = 168;
  const FG_STEP = (FG_MAX - FG_MIN) / (FG_N - 1);
  const field = new Float32Array(FG_N * FG_N);
  for (let j = 0; j < FG_N; j++) {
    const z = FG_MIN + j * FG_STEP;
    for (let i = 0; i < FG_N; i++) {
      field[j * FG_N + i] = heightAt(FG_MIN + i * FG_STEP, z);
    }
  }

  function sampleY(x, z) {
    const fx = (x - FG_MIN) / FG_STEP;
    const fz = (z - FG_MIN) / FG_STEP;
    if (fx < 0 || fz < 0 || fx >= FG_N - 1 || fz >= FG_N - 1) return heightAt(x, z);
    const i = fx | 0, j = fz | 0;
    const tx = fx - i, tz = fz - j;
    const a = field[j * FG_N + i];
    const b = field[j * FG_N + i + 1];
    const c = field[(j + 1) * FG_N + i];
    const d = field[(j + 1) * FG_N + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  function slopeFast(x, z) {
    const e = FG_STEP;
    const hx = sampleY(x + e, z) - sampleY(x - e, z);
    const hz = sampleY(x, z + e) - sampleY(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  // ---------- 顶面几何 ----------
  const RINGS = 132;
  const SEGS = 320;
  const vcount = (RINGS + 1) * (SEGS + 1) + 1;   // +1 = 极点封盖顶点
  const pos = new Float32Array(vcount * 3);
  const col = new Float32Array(vcount * 3);
  const H = new Float32Array(vcount);
  const Rgrid = new Float32Array(vcount);
  const idx = new Uint32Array(RINGS * SEGS * 6 + SEGS * 3);   // 多一圈封盖三角

  // 最内环不给 0:退化三角形会让极点法线变成垃圾,渲染出来就是中心一圈花
  // 极坐标网格的极点(以及河道正好穿过它)是天然的病态区域:
  // 环0 半径 0.018、环1 0.043,相邻顶点高度差被河道下切拉开,再按极小的弧长求坡度,
  // 顶点色就会沿径向连成一道道条纹 —— 近看就是"从一个点放射的花"。
  // 极心这个半径以内不信坡度,直接用一个平滑色压住。
  const CORE_R = 0.22;
  const ringR = (j) => (0.0042 + 0.9958 * Math.pow(j / RINGS, 1.05)) * 0.9985;
  const tmp = new THREE.Color();

  // 极心的"帽":半径 < CORE_CAP 之内把高度收敛到中心值。
  // 极坐标网格在极点有 320 个近乎重合的顶点,河道下切会按各自角度把它们拉到不同高度,
  // 于是那一圈变成 320 个高度不一的薄楔形 —— 透过半透明水面看就是"放射花纹"。
  const CORE_CAP = 0.17;
  const yCore = heightAt(1e-4, 1e-4);

  // 第一趟:只算坐标和高度
  for (let j = 0; j <= RINGS; j++) {
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const ux = Math.cos(a), uz = Math.sin(a);
      const s = ringR(j);
      const Rc = coastR(ux, uz);
      const r = s * Rc;
      const x = ux * r, z = uz * r;
      const o = j * (SEGS + 1) + i;
      let y = heightAt(x, z);
      if (r < CORE_CAP) {
        // 0 在极点 → 1 在帽外,把高度平滑收敛到 yCore
        const k = smoothstep(0.02, CORE_CAP, r);
        y = yCore + (y - yCore) * k;
      }
      H[o] = y;
      Rgrid[o] = r;
      pos[o * 3] = x;
      pos[o * 3 + 1] = y;
      pos[o * 3 + 2] = z;
    }
  }

  // 高度场平滑:山体细部在这个网格尺度上会变成刀片,两遍 [1,2,1] 就够
  {
    const tmpH = new Float32Array(H.length);
    const pass = (src, dst) => {
      for (let j = 0; j <= RINGS; j++) {
        for (let i = 0; i <= SEGS; i++) {
          const o = j * (SEGS + 1) + i;
          // ⚠ 这里必须**环绕**(i=0 的左邻是 SEGS-1,i=SEGS 的右邻是 1):
          // 第 SEGS 列与第 0 列是同一个位置。原来写成"镜像"(i=0 取 i+1),等于把接缝
          // 当成一堵墙做对称平滑,两列被推向不同高度 —— 实测最大差 0.05,
          // 于是沿 θ=0 出现一条从岛心裂到海岸的真缝(桥边那条)。
          const iL = j * (SEGS + 1) + (i === 0 ? SEGS - 1 : i - 1);
          const iR = j * (SEGS + 1) + (i === SEGS ? 1 : i + 1);
          const jU = (j === 0 ? 0 : j - 1) * (SEGS + 1) + i;
          const jD = (j === RINGS ? RINGS : j + 1) * (SEGS + 1) + i;
          dst[o] = (src[o] * 4 + src[iL] + src[iR] + src[jU] + src[jD]) * 0.125;
        }
      }
    };
    pass(H, tmpH);
    pass(tmpH, H);
    for (let o = 0; o < H.length; o++) pos[o * 3 + 1] = H[o];
  }

  // 第二趟:配色(坡度直接由邻接高度场求,不再重复采样地形)
  for (let j = 0; j <= RINGS; j++) {
    for (let i = 0; i <= SEGS; i++) {
      const o = j * (SEGS + 1) + i;
      const x = pos[o * 3], z = pos[o * 3 + 2], y = H[o];

      const iP = i > 0 ? i - 1 : SEGS - 1;
      const iN = i < SEGS ? i + 1 : 1;
      const jP = j > 0 ? j - 1 : 0;
      const jN = j < RINGS ? j + 1 : RINGS;

      // ⚠ 极点附近 r→0,弧长也跟着→0;最小值给 1e-4 会让坡度算成几万,
      // 那一圈就被涂成岩石色、沿径向连成一道道条纹(近看像"从一点放射的细线")。
      const arc = Math.max(FG_STEP * 0.9, (2 * Math.PI * Rgrid[o]) / SEGS);
      const dr = Math.max(FG_STEP * 0.9, (Rgrid[jN * (SEGS + 1) + i] - Rgrid[jP * (SEGS + 1) + i]) || FG_STEP);
      const dTh = (H[j * (SEGS + 1) + iN] - H[j * (SEGS + 1) + iP]) / arc;
      const dR = (H[jN * (SEGS + 1) + i] - H[jP * (SEGS + 1) + i]) / dr;
      const sl = Math.min(Math.hypot(dTh, dR), 8.0);

      const nBig = sn(fbm(n4, x * 1.05, z * 1.05, 3));
      const nFine = sn(fbm(n4, x * 2.9, z * 2.9, 2));

      tmp.copy(C.grassB).lerp(C.grassA, nBig);
      tmp.lerp(C.grassC, Math.pow(nFine, 1.5) * 0.38);

      const rockT = smoothstep(0.50, 1.35, sl) * (0.80 + 0.20 * nFine);
      if (rockT > 0.002) {
        const rc = C.rockA.clone().lerp(C.rockC, nFine * 0.45);
        tmp.lerp(rc, clamp(rockT, 0, 1));
      }

      // 雪线:多频侵蚀 + 陡面露岩 + 岩脊条纹(雪是"堆"出来的,不是一条平滑等值线)
      const erosion = fbm(n1, x * 2.7 + 3.1, z * 2.7 - 1.4, 4);
      const snowLine = 1.60 + 0.34 * erosion + 0.10 * sn(fbm(n2, x * 1.1, z * 1.1, 2));
      let snowT = smoothstep(snowLine, snowLine + 0.30, y);
      // 坡度越陡越留不住雪
      snowT *= smoothstep(2.35, 0.95, sl);
      // 岩脊条纹:陡面上一道道露出来的黑岩(频率只敢放在山体内部,那里的网格才够密)
      const streak = sn(fbm(n3, x * 5.0 + 1.7, z * 5.0 - 2.9, 2));
      snowT *= 1.0 - 0.62 * smoothstep(0.58, 0.86, streak) * smoothstep(2.1, 1.05, sl);
      snowT *= 0.80 + 0.20 * nFine;
      if (snowT > 0.002) {
        const sc = C.snow.clone().lerp(C.snowB, 0.25 + nBig * 0.55);
        tmp.lerp(sc, clamp(snowT, 0, 1));
      }

      const ld = lakeDist(x, z);
      const shoreT = (1 - smoothstep(lakeY + 0.02, lakeY + 0.11, y))
        * smoothstep(LAKE.r * 1.28, LAKE.r * 0.86, ld);
      if (shoreT > 0.002) tmp.lerp(C.sand, shoreT * 0.85);

      const ch = channel(x, z);
      if (ch.d < CH_W * 2.2) {
        const bedT = 1 - smoothstep(CH_W * 1.05, CH_W * 2.2, ch.d);
        tmp.lerp(C.bed, bedT * 0.55);
      }

      const mossT = smoothstep(0.45, 0.90, y) * (1 - smoothstep(1.0, 1.35, y));
      if (mossT > 0.002) tmp.lerp(C.moss, mossT * 0.35 * nFine);

      // 岸缘压深:这一圈没有植被覆盖,裸地面在掠射角会被打到接近纯白,
      // 画面上就变成"岛外面罩了一层膜"。用土/苔色把边收住。
      const edgeT = smoothstep(0.34, 0.05, coastR(x, z) - Math.hypot(x, z));
      if (edgeT > 0.002) tmp.lerp(C.edgeEarth, edgeT * 0.80);

      // 极心:位置越靠近极点,越退回一个平滑的草地色
      const rCore = Math.hypot(x, z);
      if (rCore < CORE_R) {
        const coreT = smoothstep(CORE_R, CORE_R * 0.25, rCore);
        tmp.lerp(CORE_COLOR, coreT * 0.92);
      }

      col[o * 3] = tmp.r;
      col[o * 3 + 1] = tmp.g;
      col[o * 3 + 2] = tmp.b;
    }
  }

  let ii = 0;
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEGS; i++) {
      const a = j * (SEGS + 1) + i;
      const b = a + 1;
      const c = a + SEGS + 1;
      const d = c + 1;
      idx[ii++] = a; idx[ii++] = c; idx[ii++] = b;
      idx[ii++] = b; idx[ii++] = c; idx[ii++] = d;
    }
  }

  // ---- 极点封盖 ----
  // 极坐标网格从 r=0.018 起,中心本来是个**没盖的小孔**(透过它能看到岩底内侧,
  // 就是在水面上看到的那个"黑点/黑洞")。这里补一个中心顶点 + 一圈三角扇把它封上。
  const CENTER = vcount - 1;
  {
    const cx = 0, cz = 0;
    const cy = H[0];                       // 用最内环的高度当中心高度,天然连续
    pos[CENTER * 3] = cx;
    pos[CENTER * 3 + 1] = cy;
    pos[CENTER * 3 + 2] = cz;
    col[CENTER * 3] = CORE_COLOR.r;
    col[CENTER * 3 + 1] = CORE_COLOR.g;
    col[CENTER * 3 + 2] = CORE_COLOR.b;
    for (let i = 0; i < SEGS; i++) {
      const a = 0 * (SEGS + 1) + i;        // 最内环
      const b = a + 1;
      idx[ii++] = CENTER; idx[ii++] = a; idx[ii++] = b;
    }
  }

  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  topGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  topGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  topGeo.computeVertexNormals();
  ensureUp(topGeo);
  weldSeamNormals(topGeo);       // 缝 θ=0 的接缝法线(否则桥边有一条放射状硬线)

  const topMesh = new THREE.Mesh(topGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.28,
  }));
  topMesh.castShadow = true;
  topMesh.receiveShadow = true;
  topMesh.name = 'terrain';

  // ---------- 悬浮岩底 ----------
  const UP_RINGS = 46;
  const uPos = [];
  const uCol = [];
  const uIdx = [];

  // 每个角度上"地表最外环"的真实高度。河道下切会把瀑布口附近那一段岛缘削下去
  // 0.2~0.5,岩底顶环若取固定值就会在那里高出一截,中间露出黑缝。
  const rimY = new Float32Array(SEGS + 1);
  for (let i = 0; i <= SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    const ux = Math.cos(a), uz = Math.sin(a);
    const Rc = coastR(ux, uz);
    rimY[i] = heightAt(ux * Rc * 0.9985, uz * Rc * 0.9985);
  }
  for (let j = 0; j <= UP_RINGS; j++) {
    const u = j / UP_RINGS;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const ux = Math.cos(a), uz = Math.sin(a);
      const Rc = coastR(ux, uz);
      // 顶环(u=0)的外形噪声权重必须是 0,否则会在岛缘外侧支出一圈法兰边
      const crag = 1 + 0.10 * fbm(n2, ux * 3.1 + u * 5, uz * 3.1 - u * 4, 3) * smoothstep(0.0, 0.16, u);
      // 顶环必须与地表最外环**完全重合**(半径 0.9985·Rc、高度 ≈0),否则两者之间留一条黑缝
      const r = Rc * 0.9985 * Math.pow(1 - u, 0.62) * crag;
      const x = ux * r, z = uz * r;
      // 顶环贴合真实边缘高度,往下 0.35 内过渡到统一的下坠曲线
      const yTop = rimY[i] * (1 - smoothstep(0.0, 0.35, u));
      const y = yTop - 3.02 * Math.pow(u, 0.92)
        + 0.30 * fbm(n3, x * 1.6 + 7, z * 1.6 - 3, 3) * Math.sin(u * Math.PI);
      uPos.push(x, y, z);
      const t = sn(fbm(n4, x * 2.2, z * 2.2 + u * 3, 3));
      tmp.copy(C.deepRock).lerp(C.deepRock2, t);
      const mossT = (1 - smoothstep(0.06, 0.40, u)) * 0.42 * sn(fbm(n1, x * 4, z * 4, 2));
      if (mossT > 0.002) tmp.lerp(C.moss, mossT);
      uCol.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let j = 0; j < UP_RINGS; j++) {
    for (let i = 0; i < SEGS; i++) {
      const a = j * (SEGS + 1) + i;
      const b = a + 1, c = a + SEGS + 1, d = c + 1;
      uIdx.push(a, b, c, b, d, c);
    }
  }
  const underGeo = new THREE.BufferGeometry();
  underGeo.setAttribute('position', new THREE.Float32BufferAttribute(uPos, 3));
  underGeo.setAttribute('color', new THREE.Float32BufferAttribute(uCol, 3));
  underGeo.setIndex(uIdx);
  underGeo.computeVertexNormals();
  weldSeamNormals(underGeo);     // 岩底同一个接缝也要缝
  ensureOutward(underGeo);

  const underMesh = new THREE.Mesh(underGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.97, metalness: 0, flatShading: true,
    // 朝下的岩底几乎接不到太阳光,只给环境光会黑成一坨;
    // 抬 envMapIntensity + 一点 emissive 当"底面反弹",让它读成土/岩而不是黑洞。
    envMapIntensity: 0.62,
    emissive: new THREE.Color('#1a1410'),
    emissiveIntensity: 1.0,
  }));
  underMesh.castShadow = true;
  underMesh.receiveShadow = true;
  underMesh.name = 'underside';

  const group = new THREE.Group();
  group.name = 'island';
  group.add(topMesh, underMesh);

  // ---------- 瀑布口 ----------
  const lastB = rivers[1];
  let lip = lastB.N;
  for (let i = lastB.N; i >= 0; i--) {
    const p = lastB.pts[i];
    if (Math.hypot(p.x, p.z) <= coastR(p.x, p.z) - 0.05) { lip = i; break; }
  }
  const lipP = lastB.pts[lip];
  const flat = new THREE.Vector2(lipP.x, lipP.z);
  if (flat.lengthSq() < 1e-6) flat.set(1, 0);
  flat.normalize();

  return {
    group,
    heightAt,
    sampleY,
    slopeFast,
    slopeAt: slopeFast,
    coastR,
    channel,
    lakeDist,
    lake: { ...LAKE, y: lakeY },
    rivers,
    fall: {
      x: lipP.x, y: lastB.wy[lip], z: lipP.z,
      dx: flat.x, dz: flat.y,
      width: 0.25,
      bottomY: -3.55,
    },
  };
}
