/**
 * 深空背景:极简天穹 shader(渐变 + 星云)+ 会闪的星点 + 立方体背后的柔光。
 * 背景压得很暗、很虚 —— 与"桌面微缩摆件"的深色虚化背景对应。
 */
import * as THREE from 'three';
import { glowTexture } from '../lib/textures.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uTop, uMid, uLow, uNebula;
uniform float uTime;
varying vec3 vDir;

float hash31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                    mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                    mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}
float fbm3(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise3(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main(){
  vec3 d = normalize(vDir);
  float h = d.y * 0.5 + 0.5;
  vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.55, h));
  col = mix(col, uTop, smoothstep(0.45, 1.0, h));

  // 星云:低频噪声,只在中低空可见,极暗
  vec3 q = d * 2.1 + vec3(0.0, 0.0, uTime * 0.004);
  float neb = fbm3(q) * fbm3(q * 2.7 + 5.0);
  neb = pow(clamp(neb, 0.0, 1.0), 1.9);
  float band = smoothstep(0.15, 0.75, 1.0 - abs(d.y)); // 沿"银河面"更亮
  col += uNebula * neb * band * 0.85;

  // 极淡的暗角,让中间更"虚"
  float v = smoothstep(1.4, 0.2, length(d.xz));
  col *= 0.72 + 0.28 * v;

  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uOpacity;
uniform float uScale;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.62 + 0.38 * sin(uTime * (0.9 + aSize * 1.7) + aPhase * 6.28);
  vA = tw * uOpacity;
  gl_PointSize = aSize * uScale;
}
`;

const STAR_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vA;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#050a18') },
      uMid: { value: new THREE.Color('#0a1224') },
      uLow: { value: new THREE.Color('#131a2c') },
      uNebula: { value: new THREE.Color('#2c3a68') },
      uTime: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 24), skyMat);
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  group.add(sky);

  // ---- 星点 ----
  const COUNT = 2200;
  const pos = new Float32Array(COUNT * 3);
  const size = new Float32Array(COUNT);
  const phase = new Float32Array(COUNT);
  let seed = 20261026;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < COUNT; i++) {
    // 球壳上均匀取点
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = 250 + rnd() * 40;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * s * r;
    pos[i * 3 + 1] = u * r;
    pos[i * 3 + 2] = Math.sin(th) * s * r;
    size[i] = 0.6 + Math.pow(rnd(), 3.2) * 3.4;
    phase[i] = rnd();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uScale: { value: 1.0 },
      uColor: { value: new THREE.Color('#dce9ff') },
      uMap: { value: glowTexture(64) },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,   // 星星在最远处(depthTest 关掉会画到岛上)
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  group.add(stars);

  // ---- 立方体背后的柔光(把剪影托起来) ----
  const haloMat = new THREE.MeshBasicMaterial({
    map: glowTexture(256),
    color: 0x4a6ea8,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,   // 平面法线朝 +z,默认机位看的是背面 —— 不加这句它整块被背面剔除
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), haloMat);
  halo.position.set(0, 0, -26);
  halo.renderOrder = -98;
  group.add(halo);

  const halo2 = halo.clone();
  halo2.material = haloMat.clone();
  halo2.material.color = new THREE.Color(0x8f5f9e);
  halo2.material.opacity = 0.32;
  halo2.scale.set(1.7, 1.1, 1);
  halo2.position.set(-7, 4.5, -28);
  group.add(halo2);

  return {
    group,
    update(t, p) {
      skyMat.uniforms.uTime.value = t;
      skyMat.uniforms.uTop.value.copy(p.skyTop);
      skyMat.uniforms.uMid.value.copy(p.skyMid);
      skyMat.uniforms.uLow.value.copy(p.skyLow);
      skyMat.uniforms.uNebula.value.copy(p.nebula);
      starMat.uniforms.uTime.value = t;
      starMat.uniforms.uOpacity.value = p.star;
      haloMat.opacity = 0.16 + 0.42 * p.nightFactor;
      haloMat.color.copy(p.nebula).multiplyScalar(0.9);
      halo2.material.opacity = 0.1 + 0.3 * p.nightFactor;
      halo2.material.color.copy(p.nebula).multiplyScalar(0.8);
    },
  };
}
