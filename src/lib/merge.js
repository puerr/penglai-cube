/**
 * 极简几何合并:只处理 position / normal / color,统一转成非索引。
 * 不引 BufferGeometryUtils —— 少一个依赖点,属性集我自己定死。
 */
import * as THREE from 'three';

/** 确保有 color 属性(没有就填纯色),返回克隆 */
export function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
  }
  if (!g.getAttribute('color')) {
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  // 交给我们自己的合并,丢掉多余属性
  for (const key of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color', 'uv'].includes(key)) g.deleteAttribute(key);
  }
  g.morphAttributes = {};
  return g;
}

/** 合并一组已 paint 的几何体 */
export function mergeAll(geos) {
  let total = 0;
  for (const g of geos) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const nAttr = g.getAttribute('normal');
    const cAttr = g.getAttribute('color');
    const uAttr = g.getAttribute('uv');
    pos.set(p.array, o * 3);
    nor.set(nAttr.array, o * 3);
    col.set(cAttr.array, o * 3);
    uv.set(uAttr.array, o * 2);
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/** 便捷:应用变换后 paint 再收集 */
export function addPart(list, geo, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale));
  geo.applyMatrix4(m);
  list.push(paint(geo, color));
  return list;
}
