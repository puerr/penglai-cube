/**
 * 蓬莱的楼台:亭、塔、拱桥、灯笼。
 * 全部程序化 + 顶点色,合并成极少的几个 mesh(不破坏 draw call 预算)。
 * 造型走"低面数 + 上翘檐口",和岛体的黏土/低多边形语言一致。
 */
import * as THREE from 'three';
import { addPart, mergeAll, paint } from '../lib/merge.js';

const C = {
  stone: new THREE.Color('#8f958c'),
  stoneDark: new THREE.Color('#6d7269'),
  pillar: new THREE.Color('#8e3b32'),   // 朱漆柱
  beam: new THREE.Color('#6b2b26'),
  roof: new THREE.Color('#2f6b62'),     // 青瓦
  roofRidge: new THREE.Color('#1f4a44'),
  gold: new THREE.Color('#d9a94a'),     // 金饰
  goldRoof: new THREE.Color('#c9a04a'),  // 金瓦(山顶仙宫)
  paper: new THREE.Color('#ffdca0'),    // 灯笼纸
  rail: new THREE.Color('#7e857c'),
};

/** 六角亭:石台 + 六柱 + 上翘的攒尖顶 + 宝顶 + 灯笼 */
function pavilion(rnd) {
  const parts = [];
  const R = 0.115;                       // 台半径
  // 石台
  addPart(parts, new THREE.CylinderGeometry(R * 1.18, R * 1.26, 0.026, 6), C.stone, { pos: [0, 0.013, 0] });
  addPart(parts, new THREE.CylinderGeometry(R * 1.10, R * 1.18, 0.018, 6), C.stoneDark, { pos: [0, 0.035, 0] });
  // 六根朱柱
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    addPart(parts, new THREE.CylinderGeometry(0.0072, 0.0082, 0.098, 6), C.pillar, {
      pos: [Math.cos(a) * R, 0.093, Math.sin(a) * R],
    });
    // 柱头金箍
    addPart(parts, new THREE.CylinderGeometry(0.0092, 0.0092, 0.006, 6), C.gold, {
      pos: [Math.cos(a) * R, 0.142, Math.sin(a) * R],
    });
  }
  // 额枋(六边形环)
  addPart(parts, new THREE.CylinderGeometry(R * 1.06, R * 1.06, 0.012, 6, 1, true), C.beam, { pos: [0, 0.152, 0] });
  // 檐:两层浅锥,上面收成小顶 —— 低多边形版的"上翘飞檐"
  addPart(parts, new THREE.ConeGeometry(R * 1.62, 0.052, 6), C.roof, { pos: [0, 0.186, 0], rot: [0, 0.26, 0] });
  addPart(parts, new THREE.ConeGeometry(R * 1.02, 0.048, 6), C.roof, { pos: [0, 0.222, 0], rot: [0, 0.26, 0] });
  addPart(parts, new THREE.ConeGeometry(R * 0.52, 0.040, 6), C.roofRidge, { pos: [0, 0.252, 0], rot: [0, 0.26, 0] });
  // 宝顶
  addPart(parts, new THREE.SphereGeometry(0.016, 8, 6), C.gold, { pos: [0, 0.282, 0] });
  addPart(parts, new THREE.ConeGeometry(0.008, 0.028, 6), C.gold, { pos: [0, 0.302, 0] });
  return parts;
}

/** 三层塔:逐层收分,每层一道檐 */
function pagoda(rnd) {
  const parts = [];
  addPart(parts, new THREE.CylinderGeometry(0.098, 0.112, 0.028, 8), C.stone, { pos: [0, 0.014, 0] });
  let y = 0.028;
  // [塔身半径, 塔身高, 檐半径] —— 檐大约塔身的 1.6 倍,再大就只剩"叠碟子"
  const tiers = [
    [0.070, 0.105, 0.115],
    [0.058, 0.090, 0.098],
    [0.046, 0.076, 0.082],
  ];
  for (const [r, h, eave] of tiers) {
    addPart(parts, new THREE.CylinderGeometry(r, r * 1.04, h, 8), C.beam, { pos: [0, y + h / 2, 0] });
    addPart(parts, new THREE.ConeGeometry(eave, 0.030, 8), C.roof, { pos: [0, y + h + 0.014, 0] });
    addPart(parts, new THREE.CylinderGeometry(eave * 0.96, eave * 0.96, 0.006, 8), C.roofRidge, {
      pos: [0, y + h + 0.002, 0],
    });
    y += h + 0.030;
  }
  addPart(parts, new THREE.SphereGeometry(0.014, 8, 6), C.gold, { pos: [0, y + 0.006, 0] });
  addPart(parts, new THREE.ConeGeometry(0.007, 0.034, 6), C.gold, { pos: [0, y + 0.028, 0] });
  return parts;
}

/** 拱桥:沿拱线拉一条桥面带 + 两侧栏板(比堆方块干净,没有缝) */
function archBridge(span, rise, halfW = 0.046) {
  const parts = [];
  const N = 18;
  const arc = (u) => [(u - 0.5) * span, Math.sin(u * Math.PI) * rise];

  // 桥面
  const dp = [], di = [];
  for (let i = 0; i <= N; i++) {
    const [x, y] = arc(i / N);
    for (const s of [-1, 1]) dp.push(x, y, halfW * s);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deck.setIndex(di);
  deck.computeVertexNormals();
  parts.push(paint(deck, C.stone));

  // 两侧栏板(竖直薄带)
  for (const s of [-1, 1]) {
    const rp = [], ri = [];
    for (let i = 0; i <= N; i++) {
      const [x, y] = arc(i / N);
      const z = s * (halfW + 0.002);
      rp.push(x, y + 0.026, z, x, y - 0.004, z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      ri.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setIndex(ri);
    rg.computeVertexNormals();
    parts.push(paint(rg, C.rail));
  }

  // 桥墩
  for (const s of [-1, 1]) {
    const [x0] = arc(0.5 + 0.34 * s);
    addPart(parts, new THREE.BoxGeometry(0.034, 0.085, halfW * 2.4), C.stoneDark, {
      pos: [x0, rise * 0.35 - 0.045, 0],
    });
  }
  return parts;
}


/** 山顶仙宫:八角重檐大殿,金脊宝顶(比亭更"殿") */
function summitHall() {
  const parts = [];
  addPart(parts, new THREE.CylinderGeometry(0.20, 0.23, 0.036, 8), C.stone, { pos: [0, 0.018, 0] });
  addPart(parts, new THREE.CylinderGeometry(0.185, 0.20, 0.024, 8), C.stoneDark, { pos: [0, 0.048, 0] });
  // 红墙殿身
  addPart(parts, new THREE.CylinderGeometry(0.128, 0.138, 0.115, 8), C.pillar, { pos: [0, 0.117, 0] });
  // 八柱
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    addPart(parts, new THREE.CylinderGeometry(0.0075, 0.0085, 0.125, 6), C.beam, {
      pos: [Math.cos(a) * 0.148, 0.122, Math.sin(a) * 0.148],
    });
  }
  // 重檐
  addPart(parts, new THREE.CylinderGeometry(0.168, 0.168, 0.012, 8), C.beam, { pos: [0, 0.182, 0] });
  addPart(parts, new THREE.ConeGeometry(0.245, 0.062, 8), C.goldRoof, { pos: [0, 0.218, 0], rot: [0, 0.2, 0] });
  addPart(parts, new THREE.CylinderGeometry(0.20, 0.20, 0.010, 8), C.roofRidge, { pos: [0, 0.196, 0] });
  addPart(parts, new THREE.CylinderGeometry(0.098, 0.104, 0.070, 8), C.pillar, { pos: [0, 0.276, 0] });
  addPart(parts, new THREE.ConeGeometry(0.165, 0.056, 8), C.goldRoof, { pos: [0, 0.336, 0], rot: [0, 0.2, 0] });
  addPart(parts, new THREE.ConeGeometry(0.070, 0.048, 8), C.roofRidge, { pos: [0, 0.372, 0], rot: [0, 0.2, 0] });
  // 金脊 + 宝顶
  addPart(parts, new THREE.SphereGeometry(0.020, 8, 6), C.gold, { pos: [0, 0.400, 0] });
  addPart(parts, new THREE.ConeGeometry(0.010, 0.042, 6), C.gold, { pos: [0, 0.428, 0] });
  return parts;
}


/** 山门牌坊:三间四柱 + 中心匾额 + 翘檐小顶 */
function mountainGate() {
  const parts = [];
  const bays = [-0.155, -0.052, 0.052, 0.155];   // 四根柱子的 x
  // 柱础
  for (const x of bays) {
    addPart(parts, new THREE.BoxGeometry(0.026, 0.014, 0.026), C.stoneDark, { pos: [x, 0.007, 0] });
  }
  // 柱子
  for (const x of bays) {
    addPart(parts, new THREE.CylinderGeometry(0.0085, 0.0095, 0.175, 7), C.pillar, { pos: [x, 0.1015, 0] });
  }
  // 额枋(横梁)与下枋
  addPart(parts, new THREE.BoxGeometry(0.362, 0.012, 0.020), C.beam, { pos: [0, 0.170, 0] });
  addPart(parts, new THREE.BoxGeometry(0.362, 0.008, 0.016), C.beam, { pos: [0, 0.132, 0] });
  // 匾额
  addPart(parts, new THREE.BoxGeometry(0.086, 0.026, 0.010), C.gold, { pos: [0, 0.150, 0.011] });
  // 中心顶
  addPart(parts, new THREE.ConeGeometry(0.108, 0.040, 4), C.roof, { pos: [0, 0.198, 0], rot: [0, 0.785, 0] });
  addPart(parts, new THREE.BoxGeometry(0.150, 0.010, 0.030), C.roofRidge, { pos: [0, 0.179, 0] });
  // 两侧小顶
  for (const s of [-1, 1]) {
    addPart(parts, new THREE.ConeGeometry(0.058, 0.028, 4), C.roof, {
      pos: [0.1035 * s, 0.186, 0], rot: [0, 0.785, 0],
    });
    addPart(parts, new THREE.BoxGeometry(0.082, 0.008, 0.024), C.roofRidge, {
      pos: [0.1035 * s, 0.171, 0],
    });
  }
  // 顶饰
  addPart(parts, new THREE.SphereGeometry(0.010, 8, 6), C.gold, { pos: [0, 0.222, 0] });
  return parts;
}

/** 盘山石阶:沿地形铺踏步,顺坡转向 */
function stairs(island, from, to, count) {
  const parts = [];
  for (let i = 0; i <= count; i++) {
    const u = i / count;
    // 稍微带一点横向摆动,像真山路
    const sway = Math.sin(u * Math.PI * 2.2) * 0.10 * (1 - Math.abs(u - 0.5) * 0.6);
    const x = from[0] + (to[0] - from[0]) * u + sway;
    const z = from[1] + (to[1] - from[1]) * u - sway * 0.7;
    const h = island.sampleY(x, z);
    const h2 = island.sampleY(
      from[0] + (to[0] - from[0]) * Math.min(1, u + 0.02) + sway,
      from[1] + (to[1] - from[1]) * Math.min(1, u + 0.02) - sway * 0.7,
    );
    const tilt = Math.atan2(h2 - h, 0.09);
    addPart(parts, new THREE.BoxGeometry(0.052, 0.012, 0.040), i % 2 ? C.stone : C.stoneDark, {
      pos: [x, h + 0.006, z], rot: [tilt * 0.55, 0, 0],
    });
  }
  return mergeAll(parts);
}

/** 石灯笼(可点亮) */
function stoneLantern() {
  const parts = [];
  addPart(parts, new THREE.BoxGeometry(0.030, 0.010, 0.030), C.stoneDark, { pos: [0, 0.005, 0] });
  addPart(parts, new THREE.CylinderGeometry(0.008, 0.010, 0.038, 6), C.stone, { pos: [0, 0.029, 0] });
  addPart(parts, new THREE.BoxGeometry(0.026, 0.022, 0.026), C.stone, { pos: [0, 0.059, 0] });
  addPart(parts, new THREE.ConeGeometry(0.024, 0.016, 4), C.stoneDark, { pos: [0, 0.078, 0], rot: [0, 0.78, 0] });
  return mergeAll(parts);
}

/** 浮石:悬在岛外的几块小岩,缓慢上下 */
function floatingRock(rnd, r) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + 0.34 * Math.sin(v.x * 9 + v.z * 7) * Math.cos(v.y * 8);
    pos.setXYZ(i, v.x * d, v.y * d * 0.82, v.z * d);
  }
  g.computeVertexNormals();
  return paint(g, C.stoneDark);
}

/** 把几何挂到地形上:底座稍微嵌进地面 */
function place(parts, x, z, island, scale, rotY, yOverride) {
  const g = new THREE.Group();
  const y = (yOverride !== undefined) ? yOverride : island.sampleY(x, z);
  const merged = mergeAll(parts);
  if (scale !== 1) merged.scale(scale, scale, scale);
  if (rotY) merged.rotateY(rotY);
  merged.translate(x, y - 0.006, z);
  g.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0.02, envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  })));
  g.userData.anchor = new THREE.Vector3(x, y, z);
  return g;
}

/** 从目标点向外螺旋找一个"干燥、平坦、不在河道里"的落点 */
function findSpot(island, x0, z0, needFlat = 0.6) {
  const lakeY = island.lake.y;
  let best = null;
  for (let r = 0; r <= 0.85; r += 0.06) {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + r * 3.1;
      const x = x0 + Math.cos(a) * r;
      const z = z0 + Math.sin(a) * r;
      if (Math.hypot(x, z) > island.coastR(x, z) - 0.25) continue;
      const h = island.sampleY(x, z);
      if (h < lakeY + 0.10) continue;                 // 别下水
      if (island.channel(x, z).d < 0.42) continue;     // 别压在河道上
      if (island.slopeFast(x, z) > needFlat) continue; // 要站得住
      if (island.lakeDist(x, z) < island.lake.r * 1.15) continue;
      return { x, z, h };
    }
    if (best) break;
  }
  return { x: x0, z: z0, h: island.sampleY(x0, z0) };
}

export function createArchitecture(island) {
  const rnd = () => 0.5;               // 目前不用随机;留接口
  const group = new THREE.Group();
  group.name = 'architecture';
  const anchors = [];
  const obstacles = [];   // {x,z,r} 给动物/仙人避让
  const standSpots = [];   // {x,y,z,ry} 可以站人的合法点

  // 亭:湖边高地,面朝湖
  const pav = pavilion(rnd);
  const pavAt = findSpot(island, 2.55, 1.05);
  const pavSpot = [pavAt.x, pavAt.z];
  const pavG = place(pav, pavSpot[0], pavSpot[1], island, 2.0, -0.7);
  group.add(pavG);
  anchors.push(pavG.userData.anchor);
  obstacles.push({ x: pavSpot[0], z: pavSpot[1], r: 0.33 });

  // 塔:山脚坡上,压住画面左侧
  const pag = pagoda(rnd);
  const pagAt = findSpot(island, -1.30, 1.55, 0.9);
  const pagSpot = [pagAt.x, pagAt.z];
  const pagG = place(pag, pagSpot[0], pagSpot[1], island, 1.85, 0.35);
  group.add(pagG);
  anchors.push(pagG.userData.anchor);
  obstacles.push({ x: pagSpot[0], z: pagSpot[1], r: 0.30 });

  // 拱桥:横跨出湖的那条河 —— 位置取河道上的点,朝向按该处流向转 90°
  const br = archBridge(0.58, 0.095);
  const riv = island.rivers[1];
  const bi = Math.floor(riv.N * 0.30);
  const bp = riv.pts[bi];
  const bn = riv.pts[Math.min(riv.N, bi + 1)];
  const bAngle = Math.atan2(bn.z - bp.z, bn.x - bp.x) + Math.PI / 2;
  const brSpot = [bp.x, bp.z];
  const brG = place(br, brSpot[0], brSpot[1], island, 1.6, -bAngle, bp.y + 0.075);
  group.add(brG);
  anchors.push(brG.userData.anchor);
  const deckY = bp.y + 0.075 + 0.095 * 1.6;          // 桥面拱顶高度
  const spanHalf = 0.58 * 1.6 * 0.5;
  const ux = Math.cos(-bAngle), uz = Math.sin(-bAngle);
  obstacles.push({ x: bp.x - ux * spanHalf, z: bp.z - uz * spanHalf, r: 0.16 });
  obstacles.push({ x: bp.x + ux * spanHalf, z: bp.z + uz * spanHalf, r: 0.16 });
  // 桥面中央:站人的合法点(用拱顶高度,不是河床)
  standSpots.push({ x: bp.x, y: deckY, z: bp.z, ry: -bAngle + Math.PI / 2 });

  // ---- 雪山顶的仙宫 + 盘山石阶 ----
  let peak = { h: -9, x: 0, z: 0 };
  for (let rr = 0; rr < 2.3; rr += 0.07) {
    for (let a = 0; a < Math.PI * 2; a += 0.16) {
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const h = island.sampleY(x, z);
      if (h > peak.h) peak = { h, x, z };
    }
  }
  const hallG = place(summitHall(), peak.x, peak.z, island, 2.0, 0.4);
  group.add(hallG);
  anchors.push(hallG.userData.anchor);
  obstacles.push({ x: peak.x, z: peak.z, r: 0.52 });

  // 石阶:从山脚一处平缓地爬向仙宫
  const footAt = findSpot(island, peak.x * 1.05 + 1.35, peak.z * 1.05 + 1.15, 1.6);
  const stairGeo = stairs(island, [footAt.x, footAt.z], [peak.x * 0.92, peak.z * 0.92], 46);
  const stairMesh = new THREE.Mesh(stairGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.45, side: THREE.DoubleSide,
  }));
  stairMesh.name = 'stairs';
  group.add(stairMesh);

  // 山门:立在上山石阶的起点,朝向仙宫
  const gateAngle = Math.atan2(peak.z - footAt.z, peak.x - footAt.x) + Math.PI / 2;
  const gateG = place(mountainGate(), footAt.x, footAt.z, island, 1.35, -gateAngle);
  group.add(gateG);
  anchors.push(gateG.userData.anchor);
  obstacles.push({ x: footAt.x, z: footAt.z, r: 0.26 });

  // 观瀑亭:靠近瀑布口
  const viewAt = findSpot(island, 2.55, 2.05, 0.9);
  const viewG = place(pavilion(rnd), viewAt.x, viewAt.z, island, 1.6, 1.1);
  group.add(viewG);
  anchors.push(viewG.userData.anchor);
  obstacles.push({ x: viewAt.x, z: viewAt.z, r: 0.30 });

  // ---- 浮石:悬在岛外,缓慢起伏 ----
  const floaters = [];
  const frDefs = [
    [3.9, 1.9, -2.6, 0.26],
    [-3.6, 2.5, 2.4, 0.20],
    [2.2, 3.4, -4.0, 0.17],
    [-4.4, 1.3, -0.6, 0.15],
    [0.4, 4.0, 4.2, 0.13],
  ];
  for (const [x, y, z, r] of frDefs) {
    const m = new THREE.Mesh(floatingRock(rnd, r), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true, envMapIntensity: 0.35,
    }));
    m.position.set(x, y, z);
    m.userData = { y0: y, ph: rnd() * 6.28 };
    group.add(m);
    floaters.push(m);
  }

  // ---- 灯笼:亭与塔的檐下,暖色自发光,夜里点亮 ----
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe3b0, emissive: new THREE.Color('#ffb457'), emissiveIntensity: 1.2,
    roughness: 0.55, metalness: 0.0,
  });
  const lanterns = [];
  const addLantern = (x, y, z, r) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), lanternMat);
    m.position.set(x, y, z);
    m.scale.set(1, 1.18, 1);
    group.add(m);
    lanterns.push(m);
  };
  const py = island.sampleY(pavSpot[0], pavSpot[1]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.9;
    addLantern(pavSpot[0] + Math.cos(a) * 0.24, py + 0.27, pavSpot[1] + Math.sin(a) * 0.24, 0.030);
  }
  const gy = island.sampleY(pagSpot[0], pagSpot[1]);
  addLantern(pagSpot[0], gy + 0.25, pagSpot[1] + 0.20, 0.028);

  // 石灯笼:沿石阶两侧 —— 合并成一个 mesh(否则 26 个独立 draw call)
  const lantBase = stoneLantern();
  const lantGeos = [];
  const beadPos = [];
  for (let i = 3; i <= 44; i += 7) {
    const u = i / 46;
    const sway = Math.sin(u * Math.PI * 2.2) * 0.10 * (1 - Math.abs(u - 0.5) * 0.6);
    const x = footAt.x + (peak.x * 0.92 - footAt.x) * u + sway;
    const z = footAt.z + (peak.z * 0.92 - footAt.z) * u - sway * 0.7;
    for (const sgn of [-1, 1]) {
      const lx = x + 0.055 * sgn, lz = z + 0.045 * sgn;
      const ly = island.sampleY(lx, lz) - 0.004;
      const g = lantBase.clone();
      g.translate(lx, ly, lz);
      lantGeos.push(g);
      beadPos.push([lx, ly + 0.062, lz]);
    }
  }
  if (lantGeos.length) {
    const merged = mergeAll(lantGeos);
    const lm = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.85, envMapIntensity: 0.4, side: THREE.DoubleSide,
    }));
    lm.name = 'stone-lanterns';
    group.add(lm);
    const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.010, 8, 6), lanternMat, beadPos.length);
    const mtx = new THREE.Matrix4();
    beadPos.forEach((b, i) => { mtx.makeTranslation(b[0], b[1], b[2]); beads.setMatrixAt(i, mtx); });
    beads.instanceMatrix.needsUpdate = true;
    beads.frustumCulled = false;
    beads.name = 'stone-lantern-glow';
    group.add(beads);
  }

  // 仙人站位 —— 每处只留一个,共 4 个:桥(上面已 push)/ 亭 / 雪顶仙宫 / 山门。
  // 坐标不是拍的:tools/occl.py --scan <障碍号> 在建筑周围撒候选点,对每个候选打
  // 「15 条主视角射线 + 25 条原地视野射线」,按 看得见 / 不贴脸 / 不压建筑 打分取最高。
  // 当前这 3 个点主视角可见率都是 1.00,最近实体 0.386 / 0.562 / 0.248。
  const addStand = (x, z, dist, a) => {
    const sx = x + Math.cos(a) * dist;
    const sz = z + Math.sin(a) * dist;
    standSpots.push({
      x: sx, y: island.sampleY(sx, sz), z: sz,
      ry: Math.PI / 2 - a,          // 面朝外(镜头那一侧),不是背对镜头
    });
  };
  addStand(pavSpot[0], pavSpot[1], 0.62, Math.PI * 0.25);     // 亭:镜头侧(原来是 -0.7 那侧,埋在灌木里)
  addStand(peak.x, peak.z, 0.60, Math.PI * 0.25);             // 雪顶仙宫:檐外缓坡(原来是背面,被山体全挡)
  addStand(footAt.x, footAt.z, 0.45, Math.PI * 0.875);        // 山门:缓坡侧,正前方是断崖

  return {
    group,
    anchors,
    obstacles,
    standSpots,
    update(t, pal) {
      for (const m of floaters) {
        m.position.y = m.userData.y0 + Math.sin(t * 0.55 + m.userData.ph) * 0.10;
        m.rotation.y = t * 0.08 + m.userData.ph;
      }
      // 白天几乎不亮,入夜才是灯笼
      lanternMat.emissiveIntensity = 0.25 + 2.2 * pal.nightFactor;
      lanternMat.emissive.copy(pal.rim).lerp(new THREE.Color('#ff9a3c'), 0.65);
    },
  };
}
