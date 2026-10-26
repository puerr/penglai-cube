/**
 * 植被:森林(阔叶/针叶/灌木三种 instanced)、草、乱石、野花。
 * 全部用 InstancedMesh —— 4 个 draw call 撑起整片林子。
 */
import * as THREE from 'three';
import { mulberry32, makeNoise2D, fbm, sn, clamp, smoothstep } from '../lib/noise.js';
import { addPart, mergeAll, paint } from '../lib/merge.js';

const LEAF_A = new THREE.Color('#4f7d46');
const LEAF_B = new THREE.Color('#6b9a52');
const LEAF_C = new THREE.Color('#3d6b45');
const TRUNK = new THREE.Color('#5b4a3c');
const LEAF_PINE = new THREE.Color('#2f5f52');
const LEAF_BLOSSOM = new THREE.Color('#f3bccb');
const BAMBOO = new THREE.Color('#7fa05a');
const BAMBOO_NODE = new THREE.Color('#5e7a45');
const BAMBOO_LEAF = new THREE.Color('#9fbe6a');
const TINTS = [
  [1.00, 1.00, 0.86],  // 黄绿
  [0.80, 0.98, 0.78],  // 青绿
  [0.70, 0.86, 0.92],  // 冷杉蓝绿
  [1.14, 1.06, 0.72],  // 橄榄/秋色
  [0.92, 0.90, 0.94],  // 灰绿
  [1.06, 0.86, 0.80],  // 偏红(少量)
];
const ROCK_A = new THREE.Color('#8a8580');
const ROCK_B = new THREE.Color('#5f5c5e');

function displace(geo, amp, freq, seed) {
  const n = makeNoise2D(seed);
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + amp * fbm(n, v.x * freq + 3, v.z * freq - 2, 2);
    pos.setXYZ(i, v.x * d, v.y * (1 + amp * 0.6 * fbm(n, v.z * freq, v.y * freq, 2)), v.z * d);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 自下而上的明暗渐变:假 AO,让树冠有体积 */
function gradient(geo, bottom, top, y0, y1) {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.getY(i) - y0) / (y1 - y0 || 1), 0, 1);
    c.copy(bottom).lerp(top, t * t);
    col.setXYZ(i, col.getX(i) * c.r, col.getY(i) * c.g, col.getZ(i) * c.b);
  }
  return geo;
}

/** 松:细干 + 三~四层扁平冠(层层收小、略错位)——水墨松的剪影 */
function pineGeo(rnd) {
  const p = [];
  addPart(p, new THREE.CylinderGeometry(0.012, 0.021, 0.22, 6), TRUNK, { pos: [0, 0.11, 0] });
  const tiers = [
    [0.150, 0.118],
    [0.212, 0.098],
    [0.268, 0.076],
    [0.316, 0.050],
  ];
  for (const [y, r] of tiers) {
    const g = new THREE.SphereGeometry(r, 10, 7);
    displace(g, 0.12, 7, Math.floor(rnd() * 1e6));
    addPart(p, g, LEAF_PINE, {
      pos: [(rnd() - 0.5) * 0.05, y, (rnd() - 0.5) * 0.05],
      scale: [1.15, 0.30, 1.15],
      rot: [0, rnd() * 3, 0],
    });
  }
  const geo = mergeAll(p);
  return gradient(geo, new THREE.Color('#1d3a33'), new THREE.Color('#8fc0a0'), 0.06, 0.36);
}


/** 竹:细秆分段微弯 + 顶端几片叶束。一株 = 一丛(7~11 根) */
function bambooGeo(rnd) {
  const parts = [];
  const n = 15 + ((rnd() * 9) | 0);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = rnd() * 0.075;
    const x0 = Math.cos(a) * rad;
    const z0 = Math.sin(a) * rad;
    const h = 0.40 + rnd() * 0.34;
    const lean = (rnd() - 0.5) * 0.12;
    const leanZ = (rnd() - 0.5) * 0.10;
    const segs = 3;
    for (let k = 0; k < segs; k++) {
      const u0 = k / segs;
      const u1 = (k + 1) / segs;
      const y0 = h * u0;
      const y1 = h * u1;
      const bend = (u) => lean * u * u;
      addPart(parts, new THREE.CylinderGeometry(0.0048, 0.0062, y1 - y0, 5), BAMBOO, {
        pos: [x0 + bend((u0 + u1) / 2), (y0 + y1) / 2, z0 + leanZ * (u0 + u1) / 2],
        rot: [0, 0, 0],
      });
      // 竹节
      addPart(parts, new THREE.CylinderGeometry(0.0066, 0.0066, 0.007, 5), BAMBOO_NODE, {
        pos: [x0 + bend(u1), y1, z0 + leanZ * u1],
      });
    }
    // 叶束:顶端三片外展
    const tx = x0 + lean;
    const tz = z0 + leanZ;
    for (let k = 0; k < 3; k++) {
      const la = (k / 3) * Math.PI * 2 + rnd();
      addPart(parts, new THREE.BoxGeometry(0.078, 0.005, 0.020), BAMBOO_LEAF, {
        pos: [tx + Math.cos(la) * 0.034, h + 0.008 - k * 0.007, tz + Math.sin(la) * 0.034],
        rot: [0, -la, 0.28 + k * 0.08],
      });
    }
  }
  const geo = mergeAll(parts);
  return gradient(geo, new THREE.Color('#3c5a38'), new THREE.Color('#b6cd86'), 0.05, 0.72);
}

/** 桃花树:圆冠 + 粉色系,蓬莱的春意 */
function blossomGeo(rnd) {
  const p = [];
  addPart(p, new THREE.CylinderGeometry(0.013, 0.020, 0.15, 6), TRUNK, { pos: [0, 0.075, 0] });
  const blobs = [
    [0, 0.245, 0, 0.125, 0.95],
    [0.062, 0.205, 0.030, 0.086, 0.9],
    [-0.055, 0.215, -0.040, 0.090, 0.9],
    [0.008, 0.305, -0.010, 0.072, 0.85],
  ];
  for (const [x, y, z, r, sy] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 1);
    displace(g, 0.12, 7, Math.floor(rnd() * 1e6));
    addPart(p, g, LEAF_BLOSSOM, { pos: [x, y, z], scale: [1, sy, 1] });
  }
  const geo = mergeAll(p);
  return gradient(geo, new THREE.Color('#8a5a63'), new THREE.Color('#ffd8e2'), 0.10, 0.40);
}

function coniferGeo(rnd) {
  const parts = [];
  addPart(parts, new THREE.CylinderGeometry(0.014, 0.024, 0.16, 6, 1), TRUNK, { pos: [0, 0.08, 0] });
  const tiers = [
    [0.20, 0.105, 0.24],
    [0.34, 0.082, 0.21],
    [0.45, 0.056, 0.19],
  ];
  for (let i = 0; i < tiers.length; i++) {
    const [y, r, h] = tiers[i];
    const g = new THREE.ConeGeometry(r, h, 12, 1);
    // freq 12 作用在半径 ~0.1 的锥上 = 把顶点随机拉扯,近看是一团尖刺碎片
    displace(g, 0.05, 6, Math.floor(rnd() * 1e6));
    addPart(parts, g, LEAF_C, { pos: [0, y + h * 0.28, 0], rot: [0, rnd() * 3, 0] });
  }
  const geo = mergeAll(parts);
  return gradient(geo, new THREE.Color('#24402f'), new THREE.Color('#8fb877'), 0.12, 0.62);
}

function shrubGeo(rnd) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const r = 0.055 + rnd() * 0.035;
    const g = new THREE.IcosahedronGeometry(r, 1);
    displace(g, 0.16, 8, Math.floor(rnd() * 1e6));
    addPart(parts, g, LEAF_B, {
      pos: [(rnd() - 0.5) * 0.09, 0.035 + r * 0.75, (rnd() - 0.5) * 0.09],
      scale: [1, 0.78, 1],
    });
  }
  const geo = mergeAll(parts);
  return gradient(geo, new THREE.Color('#26401f'), new THREE.Color('#a8cc7d'), 0.0, 0.16);
}

function grassGeo(rnd) {
  const parts = [];
  const blades = 4;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + rnd() * 0.9;
    // 以 仙人=0.20 单位为尺子:草只到脚踝(原来最高 0.32,比鹿还高)
    const h = 0.032 + rnd() * 0.030;
    const w = 0.007 + rnd() * 0.004;
    const bend = 0.014 + rnd() * 0.016;
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const ox = (rnd() - 0.5) * 0.028;
    const oz = (rnd() - 0.5) * 0.028;
    const v0 = [ox + px * w, 0, oz + pz * w];
    const v1 = [ox - px * w, 0, oz - pz * w];
    const v2 = [ox + dx * bend, h, oz + dz * bend];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...v0, ...v1, ...v2], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    const base = new THREE.Color('#40632f');
    const tip = new THREE.Color('#b7d97e');
    const cols = [];
    for (const [t, c] of [[0, base], [0, base], [1, tip]]) cols.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    parts.push(paint(g, base));
  }
  return mergeAll(parts);
}

function rockGeo(rnd) {
  const g = new THREE.IcosahedronGeometry(0.075, 1);
  displace(g, 0.22, 7, Math.floor(rnd() * 1e6));
  const parts = [paint(g, ROCK_A)];
  const small = new THREE.IcosahedronGeometry(0.04, 0);
  displace(small, 0.4, 15, Math.floor(rnd() * 1e6));
  addPart(parts, small, ROCK_B, { pos: [0.06, 0.01, 0.03], rot: [0.4, 1.2, 0.2] });
  return mergeAll(parts);
}

function flowerGeo() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    addPart(parts, new THREE.IcosahedronGeometry(0.0085, 0), new THREE.Color('#ffffff'), {
      pos: [Math.cos(a) * 0.016, 0.012 + (i % 2) * 0.008, Math.sin(a) * 0.016],
    });
  }
  return mergeAll(parts);
}

function instanced(geo, mat, list, { cast = true, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    p.set(it.x, it.y, it.z);
    q.setFromEuler(new THREE.Euler(it.rx || 0, it.ry || 0, it.rz || 0));
    s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.tint) {
      c.setRGB(it.tint[0], it.tint[1], it.tint[2]);
      mesh.setColorAt(i, c);
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  return mesh;
}

export function createFlora(island, opts = {}) {
  const ex = opts.exclude || [];
  const blocked = (x, z) => ex.some((e) => Math.hypot(x - e.x, z - e.z) < e.r);
  const rnd = mulberry32(9137);
  const nForest = makeNoise2D(4242);
  const nMeadow = makeNoise2D(8181);
  const lake = island.lake;

  function forestDensity(x, z) {
    const f = sn(fbm(nForest, x * 0.60, z * 0.60, 3));
    let d = smoothstep(0.40, 0.76, f);
    const ld = island.lakeDist(x, z);
    d *= smoothstep(lake.r * 0.95, lake.r * 1.8, ld);
    return d;
  }

  const rej = { coast: 0, water: 0, high: 0, slope: 0, channel: 0, density: 0, spacing: 0, ok: 0 };
  const trees = { pine: [], conifer: [], shrub: [], blossom: [] };
  const taken = [];
  const MAX_TREE = 660;
  for (let guard = 0; guard < 140000 && taken.length < MAX_TREE; guard++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 4.62;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (blocked(x, z)) continue;
    if (Math.hypot(x, z) > island.coastR(x, z) - 0.13) { rej.coast++; continue; }
    const h = island.sampleY(x, z);
    if (h < lake.y + 0.03) { rej.water++; continue; }
    if (h > 1.55) { rej.high++; continue; }
    if (island.slopeFast(x, z) > 1.75) { rej.slope++; continue; }
    if (island.channel(x, z).d < 0.36) { rej.channel++; continue; }
    const dens = Math.max(forestDensity(x, z), smoothstep(0.80, 1.30, h) * 0.45);
    if (rnd() > dens * 0.95) { rej.density++; continue; }
    let ok = true;
    for (const t of taken) {
      const dx = t[0] - x, dz = t[1] - z;
      if (dx * dx + dz * dz < 0.058) { ok = false; break; }
    }
    if (!ok) { rej.spacing++; continue; }
    rej.ok++;
    taken.push([x, z, h]);

    const r = rnd();
    // 色相拉开:黄绿 / 深绿 / 蓝绿 / 橄榄,再叠一点明度差
    const pal = TINTS[(rnd() * TINTS.length) | 0];
    const lv = 0.80 + rnd() * 0.45;
    const tint = [pal[0] * lv, pal[1] * lv, pal[2] * lv];
    if (r < 0.15) {
      // 桃花:点缀,成小片最好看
      trees.blossom.push({ x, y: h - 0.02, z, s: 1.40 + rnd() * 0.70, ry: rnd() * 6.28, tint });
    } else if (h > 1.05 && r < 0.52) {
      trees.conifer.push({ x, y: h - 0.02, z, s: 1.00 + rnd() * 0.70, ry: rnd() * 6.28, tint });
    } else if (r < 0.66) {
      trees.shrub.push({ x, y: h - 0.01, z, s: 1.20 + rnd() * 1.0, ry: rnd() * 6.28, tint });
    } else {
      trees.pine.push({
        x, y: h - 0.02, z,
        s: 1.35 + rnd() * 0.90,
        ry: rnd() * 6.28,
        sx: 0.92 + rnd() * 0.2,
        sz: 0.92 + rnd() * 0.2,
        tint,
      });
    }
  }

  // ---- 草 ----
  const grass = [];
  const MAX_GRASS = 12000;
  for (let guard = 0; guard < 90000 && grass.length < MAX_GRASS; guard++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 4.55;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (blocked(x, z)) continue;
    if (Math.hypot(x, z) > island.coastR(x, z) - 0.015) continue;
    const h = island.sampleY(x, z);
    if (h < lake.y + 0.035) continue;
    if (h > 1.35) continue;
    if (island.slopeFast(x, z) > 1.5) continue;
    if (island.channel(x, z).d < 0.30) continue;
    const openness = 1.0 - 0.72 * forestDensity(x, z);
    const patch = 0.45 + 0.55 * sn(fbm(nMeadow, x * 2.3, z * 2.3, 3));
    // 岸缘额外加密度:那一圈最容易露出裸地面
    const rimBoost = 1 + 1.6 * smoothstep(0.55, 0.05, island.coastR(x, z) - Math.hypot(x, z));
    if (rnd() > Math.min(1, openness * patch * rimBoost)) continue;
    grass.push({
      x, y: h - 0.004, z,
      s: 0.75 + rnd() * 0.60,
      ry: rnd() * 6.28,
      tint: [0.82 + rnd() * 0.45, 0.88 + rnd() * 0.30, 0.72 + rnd() * 0.34],
    });
  }

  // ---- 竹丛:按噪声成片,不铺满 ----
  const bamboo = [];
  const nBamboo = makeNoise2D(6161);
  for (let guard = 0; guard < 24000 && bamboo.length < 58; guard++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 3.95;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    if (blocked(x, z)) continue;
    const h = island.sampleY(x, z);
    if (h < lake.y + 0.05 || h > 1.25) continue;
    if (island.slopeFast(x, z) > 1.25) continue;
    if (island.channel(x, z).d < 0.45) continue;
    if (sn(fbm(nBamboo, x * 0.78 + 13, z * 0.78 - 7, 3)) < 0.53) continue;
    let ok = true;
    for (const b of bamboo) {
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < 0.075) { ok = false; break; }
    }
    if (!ok) continue;
    bamboo.push({ x, y: h - 0.012, z, s: 0.85 + rnd() * 0.42, ry: rnd() * 6.28,
      tint: [0.9 + rnd() * 0.2, 0.92 + rnd() * 0.18, 0.84 + rnd() * 0.2] });
  }

  // ---- 乱石 ----
  const rocks = [];
  for (let guard = 0; guard < 18000 && rocks.length < 110; guard++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 4.5;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const h = island.sampleY(x, z);
    if (h < lake.y - 0.02) continue;
    if (island.channel(x, z).d < 0.26) continue;
    const sl = island.slopeFast(x, z);
    const alpine = smoothstep(0.75, 1.5, h);
    if (rnd() > 0.10 + alpine * 0.32 + sl * 0.05) continue;
    const s = h > 1.0 ? 0.5 + rnd() * 1.1 : 0.5 + rnd() * 1.3;
    rocks.push({
      x, y: h - 0.01, z, s,
      rx: rnd() * 0.7, ry: rnd() * 6.28, rz: rnd() * 0.7,
      tint: [0.8 + rnd() * 0.4, 0.8 + rnd() * 0.4, 0.82 + rnd() * 0.35],
    });
  }

  // ---- 野花 ----
  const flowers = [];
  const flowerCols = ['#f4e7c8', '#f0c6d8', '#d8c8f2', '#ffe9a8', '#f6d2c0'];
  for (let guard = 0; guard < 22000 && flowers.length < 300; guard++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 4.35;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    const h = island.sampleY(x, z);
    if (h < lake.y + 0.06 || h > 1.0) continue;
    if (island.slopeFast(x, z) > 0.9) continue;
    if (island.channel(x, z).d < 0.34) continue;
    if (forestDensity(x, z) > 0.45) continue;
    const c = new THREE.Color(flowerCols[(rnd() * flowerCols.length) | 0]);
    flowers.push({ x, y: h, z, s: 0.7 + rnd() * 0.7, ry: rnd() * 6.28, tint: [c.r, c.g, c.b] });
  }

  const leafMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.0,
    envMapIntensity: 0.62,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
    envMapIntensity: 0.4,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    envMapIntensity: 0.35,
  });
  const flowerMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.0,
    emissive: new THREE.Color(0x1a1408),
    emissiveIntensity: 0.35,
    envMapIntensity: 0.5,
  });

  const group = new THREE.Group();
  group.name = 'flora';
  const pineMesh = instanced(pineGeo(rnd), leafMat, trees.pine);
  const blossomMesh = instanced(blossomGeo(rnd), leafMat, trees.blossom);
  const coniferMesh = instanced(coniferGeo(rnd), leafMat, trees.conifer);
  const shrubMesh = instanced(shrubGeo(rnd), leafMat, trees.shrub);
  const grassMesh = instanced(grassGeo(rnd), grassMat, grass, { cast: false });
  const bambooMesh = instanced(bambooGeo(rnd), leafMat, bamboo);
  const rockMesh = instanced(rockGeo(rnd), rockMat, rocks);
  const flowerMesh = instanced(flowerGeo(), flowerMat, flowers, { cast: false });
  pineMesh.name = 'trees-pine';
  blossomMesh.name = 'trees-blossom';
  coniferMesh.name = 'trees-conifer';
  shrubMesh.name = 'shrubs';
  grassMesh.name = 'grass';
  bambooMesh.name = 'bamboo';
  rockMesh.name = 'rocks';
  flowerMesh.name = 'flowers';
  group.add(pineMesh, blossomMesh, coniferMesh, shrubMesh, bambooMesh, grassMesh, rockMesh, flowerMesh);

  return {
    group,
    rej,
    counts: {
      pine: trees.pine.length,
      blossom: trees.blossom.length,
      conifer: trees.conifer.length,
      shrub: trees.shrub.length,
      grass: grass.length,
      bamboo: bamboo.length,
      rocks: rocks.length,
      flowers: flowers.length,
    },
  };
}
