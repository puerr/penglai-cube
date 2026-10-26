/**
 * 仙人:低多边形道人/仙姬,白袍 + 青带,极缓慢浮动。
 * 尺子:亭子(含檐)约 0.7 单位 ≈ 现实 5m,人 1.7m ⇒ 人 ≈ 0.24 单位。
 * 站位点由 architecture 提供(已避开建筑障碍;桥上的用桥面拱顶高度)。
 */
import * as THREE from 'three';
import { addPart, mergeAll } from '../lib/merge.js';

const ROBE = new THREE.Color('#eef2ea');
const ROBE_SHADE = new THREE.Color('#c2cfc4');
const SASH = new THREE.Color('#4f8a72');
const SKIN = new THREE.Color('#e8cdb4');
const HAIR = new THREE.Color('#2b2a2c');
const STAFF = new THREE.Color('#6b5a45');

function immortalGeo(rnd, withStaff) {
  const p = [];
  // 道袍:下摆略张
  addPart(p, new THREE.CylinderGeometry(0.016, 0.038, 0.105, 8, 1, true), ROBE, { pos: [0, 0.053, 0] });
  addPart(p, new THREE.CylinderGeometry(0.036, 0.040, 0.010, 8), ROBE_SHADE, { pos: [0, 0.006, 0] });
  addPart(p, new THREE.CylinderGeometry(0.022, 0.026, 0.052, 8), ROBE, { pos: [0, 0.130, 0] });
  addPart(p, new THREE.CylinderGeometry(0.0235, 0.0235, 0.008, 8), SASH, { pos: [0, 0.108, 0] });
  for (const s of [-1, 1]) {
    addPart(p, new THREE.ConeGeometry(0.017, 0.055, 6), ROBE, {
      pos: [0.024 * s, 0.118, 0], rot: [0, 0, 0.55 * s],
    });
  }
  addPart(p, new THREE.SphereGeometry(0.0175, 10, 8), SKIN, { pos: [0, 0.171, 0] });
  addPart(p, new THREE.SphereGeometry(0.0135, 8, 6), HAIR, { pos: [0, 0.180, -0.004], scale: [1, 0.8, 1] });
  addPart(p, new THREE.SphereGeometry(0.008, 6, 5), HAIR, { pos: [0, 0.192, -0.006] });
  if (withStaff) {
    addPart(p, new THREE.CylinderGeometry(0.0032, 0.0032, 0.20, 5), STAFF, { pos: [0.040, 0.100, 0.008] });
    addPart(p, new THREE.SphereGeometry(0.0095, 8, 6), SASH, { pos: [0.040, 0.196, 0.008], scale: [0.8, 1, 0.8] });
  }
  return mergeAll(p);
}

export function createImmortals(island, spots = []) {
  const rnd = () => 0.5;
  const group = new THREE.Group();
  group.name = 'immortals';

  // 直接持有 spots 里的对象引用 —— 运行时改位置能立刻生效
  const items = spots.slice(0, 6).map((sp, i) => ({
    spot: sp, x: sp.x, y: sp.y, z: sp.z, ry: sp.ry, staff: i % 2 === 0, ph: i * 1.7,
  }));
  if (!items.length) return { group, count: 0, update() {} };

  const variants = [
    { geo: immortalGeo(rnd, true), list: items.filter((i) => i.staff) },
    { geo: immortalGeo(rnd, false), list: items.filter((i) => !i.staff) },
  ];
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.68, metalness: 0.0, envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  for (const vr of variants) {
    if (!vr.list.length) continue;
    vr.mesh = new THREE.InstancedMesh(vr.geo, mat, vr.list.length);
    vr.mesh.frustumCulled = false;
    vr.mesh.castShadow = true;
    group.add(vr.mesh);
    // 记下每个 item 落在哪个 mesh 的第几个实例,供 setSpot 用
    vr.list.forEach((it, slot) => { it.mesh = vr.mesh; it.slot = slot; });
  }

  return {
    group,
    count: items.length,
    /** 运行时移动第 i 位仙人(位置 + 朝向) */
    setSpot(i, pos) {
      const it = items[i];
      if (!it) return;
      if (pos.x !== undefined) it.x = pos.x;
      if (pos.y !== undefined) it.y = pos.y;
      if (pos.z !== undefined) it.z = pos.z;
      if (pos.ry !== undefined) { it.ry = pos.ry; it.spot.ry = pos.ry; }
      it.spot.x = it.x; it.spot.z = it.z;
    },
    // ⚠ 必须每帧从基准位置重算:读上一帧矩阵再 += 等于对 sin 积分,人会飘走
    update(t) {
      for (const vr of variants) {
        if (!vr.mesh) continue;
        vr.list.forEach((it, i) => {
          v.set(it.x, it.y - 0.004 + Math.sin(t * 0.6 + it.ph) * 0.005, it.z);
          e.set(0, it.ry, 0);
          q.setFromEuler(e);
          m.compose(v, q, one);
          vr.mesh.setMatrixAt(i, m);
        });
        vr.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
