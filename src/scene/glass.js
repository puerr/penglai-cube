/**
 * 玻璃立方体:透射主体 + 亚克力棱条 + 加色边缘辉光壳。
 * 棱条上的 emissive 会被 bloom 拾起来 —— "玻璃边缘折射微光"就是这么来的。
 */
import * as THREE from 'three';
import { glowTexture } from '../lib/textures.js';
import { smoothstep } from '../lib/noise.js';

const BAR_TARGET = new THREE.Color(0x8fb4d2);

const GLOW_VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vViewDir;
void main(){
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GLOW_FRAG = /* glsl */`
precision highp float;
uniform float uHalf;
uniform float uWidth;
uniform vec3 uColor;
uniform float uIntensity;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vViewDir;

void main(){
  vec3 a = abs(vLocal);
  vec3 d = vec3(uHalf) - a;
  // 该点所在的那个面:某一轴 d≈0;剩下的两条轴给出"到最近棱的距离"
  float best = 1e9;
  if (d.x > 0.0015 && d.x < best) best = d.x;
  if (d.y > 0.0015 && d.y < best) best = d.y;
  if (d.z > 0.0015 && d.z < best) best = d.z;
  float edge = 1.0 - smoothstep(0.0, uWidth, best);

  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vViewDir))), 2.4);
  float g = edge * 0.85 + fres * 0.30 + 0.045;
  gl_FragColor = vec4(uColor * g * uIntensity, g * uIntensity);
}
`;

export function createGlass(size = 11, opts = {}) {
  const half = size / 2;
  const camDir = new THREE.Vector3(0.577, 0.577, 0.577);
  const group = new THREE.Group();
  group.name = 'glass';

  // 默认**不用** transmission:它要额外开一张全尺寸 4×MSAA 半浮点 RT 并把整场重渲一遍,
  // 是这类页面上最容易在真显卡驱动/显存上翻车的一环(实测:开着玻璃罩才闪黑)。
  // 便宜方案 = 低透明度体 + 强环境反射 + clearcoat,棱条微光与面向相机的高光由外壳负责。
  const physical = opts.physical === true;

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.045,
    transmission: physical ? 1 : 0,
    thickness: 0.6,
    ior: 1.46,
    transparent: true,
    opacity: physical ? 1 : 0.028,
    side: THREE.DoubleSide,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    iridescence: 0.5,
    iridescenceIOR: 1.36,
    iridescenceThicknessRange: [180, 620],
    attenuationColor: new THREE.Color('#bfe6ff'),
    attenuationDistance: 1.15,
    envMapIntensity: physical ? 2.3 : 1.9,
    specularIntensity: 1.15,
    depthWrite: false,
    premultipliedAlpha: false,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), bodyMat);
  body.name = 'glass-body';
  body.renderOrder = 8;
  group.add(body);

  // ---- 棱条 ----
  const barR = 0.026;
  const barMat = new THREE.MeshPhysicalMaterial({
    color: 0xb9d4ea,
    roughness: 0.12,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.10,
    emissive: new THREE.Color(0x1d3c5c),
    emissiveIntensity: 0.12,
    envMapIntensity: 1.2,
  });

  const barGeoX = new THREE.BoxGeometry(size, barR * 2, barR * 2);
  const barGeoY = new THREE.BoxGeometry(barR * 2, size, barR * 2);
  const barGeoZ = new THREE.BoxGeometry(barR * 2, barR * 2, size);

  const bars = new THREE.Group();
  const barList = [];
  // 每根棱一份材质:靠相机那一侧的棱要压淡,否则它在某些机位会变成一条横穿画面的白线
  const addBar = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, barMat.clone());
    m.position.set(x, y, z);
    m.userData.dir = new THREE.Vector3(x, y, z).normalize();
    bars.add(m);
    barList.push(m);
    return m;
  };
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) addBar(barGeoX, 0, half * sy, half * sz);
    for (const sx of [-1, 1]) addBar(barGeoZ, half * sx, half * sy, 0);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) addBar(barGeoY, half * sx, 0, half * sz);
  }
  // 八个小圆球盖住接缝
  const knobGeo = new THREE.SphereGeometry(barR * 1.35, 10, 8);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const m = new THREE.Mesh(knobGeo, barMat);
        m.position.set(half * sx, half * sy, half * sz);
        bars.add(m);
      }
    }
  }
  bars.name = 'glass-frame';
  group.add(bars);

  // ---- 玻璃面上的"影棚柔光"反射(产品摄影里玻璃之所以像玻璃,靠的就是这个) ----
  const reflTex = glowTexture(256);
  const reflMat = new THREE.MeshBasicMaterial({
    map: reflTex,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const reflections = new THREE.Group();
  reflections.name = 'glass-reflections';
  const mkRefl = (w, h, pos, rot, op) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), reflMat.clone());
    m.position.set(...pos);
    m.rotation.set(...rot);
    m.material.opacity = op;
    m.renderOrder = 7;
    reflections.add(m);
    return m;
  };
  // 三个可见面各一条:上 / 前左(+x)/ 前右(+z)
  mkRefl(7.6, 3.2, [0.6, half - 0.03, 0.2], [-Math.PI / 2, 0, 0.5], 0.038);
  mkRefl(5.2, 2.6, [half - 0.03, 2.35, 0.4], [0, Math.PI / 2, 0.32], 0.052);
  mkRefl(4.4, 3.0, [-0.4, 2.05, half - 0.03], [0, 0, -0.28], 0.044);
  group.add(reflections);

  // ---- 边缘辉光壳 ----
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uHalf: { value: half },
      uWidth: { value: 0.055 },
      uColor: { value: new THREE.Color('#bfe0ff') },
      uIntensity: { value: 0.9 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(size * 1.004, size * 1.004, size * 1.004), glowMat);
  glow.name = 'glass-glow';
  glow.renderOrder = 9;
  group.add(glow);

  return {
    group,
    bodyMat,
    barMat,
    glowMat,
    update(p, time, camera) {
      if (camera) {
        // 近端棱:透明度压到 0.02;远端棱:0.14。近端本来就是"看不见"的那三条
        camDir.copy(camera.position).normalize();
        for (const b of barList) {
          const d = b.userData.dir.dot(camDir);
          const near = smoothstep(-0.25, 0.55, d);      // d 越大 = 越靠相机
          b.material.opacity = 0.145 - 0.125 * near;
        }
      }
      glowMat.uniforms.uColor.value.copy(p.glass);
      // 边缘辉光只当一道细边:太亮会在某些机位变成一条横穿水面的白线
      glowMat.uniforms.uIntensity.value = p.glassI * 0.12 * (0.85 + 0.15 * Math.sin(time * 0.7));
      barMat.emissive.copy(p.glass).multiplyScalar(0.35);
      barMat.emissiveIntensity = 0.04 + 0.16 * p.nightFactor;
      barMat.color.copy(p.glass).lerp(BAR_TARGET, 0.62).multiplyScalar(0.85);
    },
  };
}
