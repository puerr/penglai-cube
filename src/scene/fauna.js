/**
 * 微型动物:鹿群(instanced)、兔子、绕岛飞的小鸟(翅膀在顶点着色器里扇)。
 * 都贴着地形走 —— 每帧用 island.heightAt 取高度,不会浮空/陷进地里。
 */
import * as THREE from 'three';
import { mulberry32 } from '../lib/noise.js';
import { addPart, mergeAll, paint } from '../lib/merge.js';

const DEER_BODY = new THREE.Color('#b4885d');
const DEER_DARK = new THREE.Color('#7d5c3f');
const DEER_LIGHT = new THREE.Color('#e6d8c0');
const RABBIT_BODY = new THREE.Color('#cfbfa8');
const BIRD_BODY = new THREE.Color('#efece2');
const BIRD_WING = new THREE.Color('#cfd3d8');
const BIRD_TAIL = new THREE.Color('#a8adb6');

function deerGeo() {
  const p = [];
  // 躯干
  addPart(p, new THREE.SphereGeometry(0.072, 12, 9), DEER_BODY, {
    pos: [0, 0.135, 0], scale: [1.45, 0.95, 0.9],
  });
  // 颈 + 头
  addPart(p, new THREE.CylinderGeometry(0.024, 0.032, 0.10, 7), DEER_BODY, {
    pos: [0.088, 0.192, 0], rot: [0, 0, -0.62],
  });
  addPart(p, new THREE.SphereGeometry(0.034, 10, 8), DEER_BODY, {
    pos: [0.128, 0.232, 0], scale: [1.15, 0.92, 0.86],
  });
  // 耳朵
  for (const s of [-1, 1]) {
    addPart(p, new THREE.ConeGeometry(0.012, 0.042, 6), DEER_DARK, {
      pos: [0.118, 0.262, 0.026 * s], rot: [0.5 * s, 0, -0.25],
    });
  }
  // 鹿角(小,只作为剪影)
  for (const s of [-1, 1]) {
    addPart(p, new THREE.CylinderGeometry(0.004, 0.0055, 0.075, 5), DEER_LIGHT, {
      pos: [0.132, 0.285, 0.017 * s], rot: [0.22 * s, 0, -0.32],
    });
    addPart(p, new THREE.CylinderGeometry(0.003, 0.004, 0.042, 5), DEER_LIGHT, {
      pos: [0.155, 0.315, 0.030 * s], rot: [0.5 * s, 0, 0.55],
    });
  }
  // 腿
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addPart(p, new THREE.CylinderGeometry(0.0105, 0.0085, 0.118, 6), DEER_DARK, {
        pos: [0.052 * sx, 0.059, 0.036 * sz],
      });
    }
  }
  // 尾
  addPart(p, new THREE.ConeGeometry(0.016, 0.045, 6), DEER_LIGHT, {
    pos: [-0.108, 0.152, 0], rot: [0, 0, 1.9],
  });
  return mergeAll(p);
}

function rabbitGeo() {
  const p = [];
  addPart(p, new THREE.SphereGeometry(0.030, 10, 8), RABBIT_BODY, {
    pos: [0, 0.030, 0], scale: [1.25, 0.95, 0.92],
  });
  addPart(p, new THREE.SphereGeometry(0.021, 9, 7), RABBIT_BODY, { pos: [0.032, 0.048, 0] });
  for (const s of [-1, 1]) {
    addPart(p, new THREE.ConeGeometry(0.0085, 0.040, 6), RABBIT_BODY, {
      pos: [0.030, 0.076, 0.012 * s], rot: [0.16 * s, 0, -0.16],
    });
    addPart(p, new THREE.SphereGeometry(0.013, 7, 6), RABBIT_BODY, { pos: [-0.031, 0.024, 0.014 * s] });
  }
  return mergeAll(p);
}

function birdGeo() {
  // 蓬莱仙鹤:白身、墨色飞羽、丹顶、长颈后掠、双腿拖尾
  const p = [];
  const WHITE = new THREE.Color('#f6f7f2');
  const INK = new THREE.Color('#2b2f36');
  const CRIMSON = new THREE.Color('#c0392b');
  const HOME = new THREE.Color('#4a4a4e');

  // 身体(细长纺锤)
  addPart(p, new THREE.SphereGeometry(0.030, 12, 9), WHITE, { scale: [2.05, 0.78, 0.72] });

  // 长颈:S 形,两段
  addPart(p, new THREE.CylinderGeometry(0.0085, 0.012, 0.055, 7), WHITE, {
    pos: [0.058, 0.030, 0], rot: [0, 0, -0.85],
  });
  addPart(p, new THREE.CylinderGeometry(0.0072, 0.0085, 0.050, 7), WHITE, {
    pos: [0.079, 0.068, 0], rot: [0, 0, -0.22],
  });
  // 头 + 丹顶 + 喙
  addPart(p, new THREE.SphereGeometry(0.0135, 10, 8), WHITE, { pos: [0.083, 0.094, 0], scale: [1.25, 0.95, 0.9] });
  addPart(p, new THREE.SphereGeometry(0.0062, 8, 6), CRIMSON, { pos: [0.082, 0.104, 0] });
  addPart(p, new THREE.ConeGeometry(0.0045, 0.026, 6), INK, {
    pos: [0.101, 0.092, 0], rot: [0, 0, -1.57],
  });

  // 双腿拖在身后(仙鹤标志性剪影)
  for (const sgn of [-1, 1]) {
    addPart(p, new THREE.CylinderGeometry(0.0026, 0.0022, 0.085, 5), HOME, {
      pos: [-0.062, -0.012, 0.012 * sgn], rot: [0, 0, 1.32],
    });
    addPart(p, new THREE.CylinderGeometry(0.0021, 0.0018, 0.040, 5), HOME, {
      pos: [-0.104, -0.020, 0.014 * sgn], rot: [0, 0, 1.57],
    });
  }

  // 翼:宽展、后掠、上反角;翼尖一段墨色飞羽
  for (const sgn of [-1, 1]) {
    const wing = new THREE.BufferGeometry();
    const A = [0.022, 0.006, 0.014 * sgn];
    const B = [-0.030, 0.002, 0.016 * sgn];
    const C = [-0.048, 0.034, 0.125 * sgn];
    const D = [0.006, 0.038, 0.115 * sgn];
    wing.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...C, ...A, ...C, ...D], 3));
    wing.setAttribute('normal', new THREE.Float32BufferAttribute(
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    wing.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    p.push(paint(wing, WHITE));

    const tip = new THREE.BufferGeometry();
    const E = [-0.048, 0.034, 0.125 * sgn];
    const F = [0.006, 0.038, 0.115 * sgn];
    const G = [-0.020, 0.040, 0.170 * sgn];
    const H2 = [0.004, 0.042, 0.160 * sgn];
    tip.setAttribute('position', new THREE.Float32BufferAttribute([...E, ...F, ...G, ...F, ...H2, ...G], 3));
    tip.setAttribute('normal', new THREE.Float32BufferAttribute(
      [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    tip.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
    p.push(paint(tip, INK));
  }
  return mergeAll(p);
}

/** 绕圈朝向:位置 C+(cos a, sin a)·r ⇒ 速度 (-sin a, cos a);模型头朝 +x,
 *  rotY=θ 把 +x 映射到 (cosθ,-sinθ) ⇒ θ = -(a+π/2)(写 -heading+π 会多转 180°)。 */
function faceAngle(a, dir) {
  return dir > 0 ? -(a + Math.PI / 2) : -(a - Math.PI / 2);
}

function buildInstanced(geo, mat, items) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createFauna(island, opts = {}) {
  const rnd = mulberry32(20260214);
  const obstacles = opts.obstacles || [];
  /** 把位置从建筑障碍圆里推出来 —— 不然鹿会直接穿墙 */
  const keepOut = (x, z) => {
    for (const o of obstacles) {
      const dx = x - o.x, dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < o.r) {
        if (d < 1e-4) return [o.x + o.r, z];
        const k = o.r / d;
        return [o.x + dx * k, o.z + dz * k];
      }
    }
    return [x, z];
  };
  const group = new THREE.Group();
  group.name = 'fauna';

  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.45,
  });

  // ---------- 鹿 ----------
  const deerHerd = [
    { cx: 1.82, cz: 0.92, r: 0.58, spd: 0.16, n: 3, dir: 1 },
    { cx: -0.38, cz: 1.34, r: 0.50, spd: -0.13, n: 2, dir: -1 },
  ];
  const deerList = [];
  for (const h of deerHerd) {
    for (let i = 0; i < h.n; i++) {
      deerList.push({
        ...h,
        phase: (i / h.n) * Math.PI * 2 + rnd() * 0.6,
        rr: h.r * (0.72 + rnd() * 0.5),
        scale: 0.52 + rnd() * 0.14,
        speedJit: 0.85 + rnd() * 0.3,
      });
    }
  }
  const deerMesh = buildInstanced(deerGeo(), bodyMat, deerList);
  deerMesh.name = 'deer';
  group.add(deerMesh);

  // ---------- 兔子 ----------
  const rabbitList = [];
  const warrens = [
    { cx: 2.62, cz: -0.06, r: 0.48 },
    { cx: -0.70, cz: 0.32, r: 0.40 },
    { cx: 1.47, cz: 1.98, r: 0.44 },
  ];
  for (const w of warrens) {
    for (let i = 0; i < 3; i++) {
      rabbitList.push({
        ...w,
        phase: rnd() * Math.PI * 2,
        rr: w.r * (0.6 + rnd() * 0.6),
        scale: 0.50 + rnd() * 0.22,
        speed: (0.36 + rnd() * 0.3) * (rnd() > 0.5 ? 1 : -1),
        hopJit: rnd() * 6.28,
      });
    }
  }
  const rabbitMesh = buildInstanced(rabbitGeo(), bodyMat, rabbitList);
  rabbitMesh.name = 'rabbits';
  group.add(rabbitMesh);

  // ---------- 鸟 ----------
  const timeUniform = { value: 0 };
  const birdMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, metalness: 0.0, envMapIntensity: 0.5,
  });
  birdMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = 'uniform float uTime;\nattribute float aPhase;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float flap = sin(uTime * 5.4 + aPhase * 6.2831);
       float w = clamp(abs(position.z) / 0.170, 0.0, 1.0);
       // 翼沿 ±z 展开,绕身体轴(x)上下扇;上挥时略微收拢
       transformed.y += flap * w * w * 0.115;
       transformed.z -= sign(position.z) * abs(flap) * w * 0.012;`,
    );
  };
  birdMat.customProgramCacheKey = () => 'bird-flap';

  const BIRDS = 16;
  const birdGeoA = birdGeo();
  const phases = new Float32Array(BIRDS);
  for (let i = 0; i < BIRDS; i++) phases[i] = rnd();
  birdGeoA.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  const birdMesh = new THREE.InstancedMesh(birdGeoA, birdMat, BIRDS);
  birdMesh.frustumCulled = false;
  birdMesh.name = 'cranes';
  group.add(birdMesh);

  const birdState = [];
  for (let i = 0; i < BIRDS; i++) {
    birdState.push({
      r: 1.9 + rnd() * 1.7,
      y: 2.95 + rnd() * 1.35,
      spd: (0.10 + rnd() * 0.10) * (rnd() > 0.35 ? 1 : -1),
      phase: rnd() * Math.PI * 2,
      bob: 0.10 + rnd() * 0.16,
      scale: 0.80 + rnd() * 0.30,
      cx: (rnd() - 0.5) * 0.6,
      cz: (rnd() - 0.5) * 0.6,
    });
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  return {
    group,
    update(t, p) {
      timeUniform.value = t;

      // 鹿:绕小圈慢慢走,四脚落地高度贴地形
      for (let i = 0; i < deerList.length; i++) {
        const d = deerList[i];
        const a = d.phase + t * d.spd * d.speedJit * 6.0;
        let x = d.cx + Math.cos(a) * d.rr;
        let z = d.cz + Math.sin(a) * d.rr;
        [x, z] = keepOut(x, z);
        const y = island.sampleY(x, z);
        const bob = Math.sin(t * 2.6 + d.phase) * 0.004;
        pos.set(x, y - 0.022 + bob, z);
        // 朝向 = 切线方向
        e.set(0, faceAngle(a, Math.sign(d.spd) || 1), 0);
        q.setFromEuler(e);
        scl.setScalar(d.scale);
        m.compose(pos, q, scl);
        deerMesh.setMatrixAt(i, m);
      }
      deerMesh.instanceMatrix.needsUpdate = true;

      // 兔:蹦跳
      for (let i = 0; i < rabbitList.length; i++) {
        const r = rabbitList[i];
        const a = r.phase + t * r.speed * 0.55;
        let x = r.cx + Math.cos(a) * r.rr;
        let z = r.cz + Math.sin(a) * r.rr;
        [x, z] = keepOut(x, z);
        const y = island.sampleY(x, z);
        const hop = Math.max(0, Math.sin(t * 5.2 + r.hopJit)) * 0.022;
        pos.set(x, y - 0.016 + hop, z);
        e.set(-hop * 5.0, faceAngle(a, Math.sign(r.speed) || 1), 0);
        q.setFromEuler(e);
        scl.setScalar(r.scale);
        m.compose(pos, q, scl);
        rabbitMesh.setMatrixAt(i, m);
      }
      rabbitMesh.instanceMatrix.needsUpdate = true;

      // 鸟:绕岛飞 + 轻微起伏
      for (let i = 0; i < BIRDS; i++) {
        const b = birdState[i];
        const a = b.phase + t * b.spd * 1.6;
        const x = b.cx + Math.cos(a) * b.r;
        const z = b.cz + Math.sin(a) * b.r;
        const y = b.y + Math.sin(t * 1.3 + b.phase * 3) * b.bob;
        pos.set(x, y, z);
        e.set(0, faceAngle(a, Math.sign(b.spd) || 1), Math.sin(t * 1.3 + b.phase * 3) * 0.12);
        q.setFromEuler(e);
        scl.setScalar(b.scale);
        m.compose(pos, q, scl);
        birdMesh.setMatrixAt(i, m);
      }
      birdMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
