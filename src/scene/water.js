/**
 * 水面:湖面 / 蜿蜒河 / 瀑布,三种几何共用一套调色板 uniform。
 * 湖与河用同一份水位剖面(由 island.js 算好),岸边靠 aDepth / aEdge 做软化,
 * 避免"水面像一块硬塑料片切在地形上"。
 */
import * as THREE from 'three';
import { smoothstep, clamp } from '../lib/noise.js';

const NOISE_GLSL = /* glsl */`
// ⚠ 不要用 sin() 型哈希:fract(sin(dot(p,K))*43758) 在 dot 到上万时精度因 GPU 而异,
// 会在部分显卡上退化成条纹/放射状摩尔纹(表现为水面上出现"风车"状条纹)。
// 这里用无 sin 的整数系哈希,量级安全、跨驱动一致。
float hash21(vec2 p){
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export function createWaterUniforms() {
  return {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color('#1d5566') },
    uShallow: { value: new THREE.Color('#63b9c2') },
    uFoam: { value: new THREE.Color('#eafcff') },
    uSunColor: { value: new THREE.Color('#ffffff') },
    uSkyColor: { value: new THREE.Color('#9fc6ee') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },
    uGlow: { value: 1 },
    uTexMatrix: { value: new THREE.Matrix4() },
    uReflect: { value: null },
    uDistort: { value: 0.05 },
    uReflectAmt: { value: 0.82 },
    uFlow: { value: 0.0 },
    uFlowMode: { value: 0.0 },
    uEndFade: { value: 0.0 },
    uDbg: { value: 0 },
  };
}

function syncUniforms(u, pal) {
  u.uDeep.value.copy(pal.wDeep);
  u.uShallow.value.copy(pal.wShallow);
  u.uFoam.value.copy(pal.wFoam);
  u.uSunColor.value.copy(pal.sun);
  u.uSkyColor.value.copy(pal.hemiSky);
  u.uSunDir.value.copy(pal.sunDir);
  u.uNight.value = pal.nightFactor;
  u.uGlow.value = 1 - 0.34 * pal.nightFactor;
}

const WATER_VERT = /* glsl */`
attribute float aDepth;
attribute float aEdge;
uniform mat4 uTexMatrix;
varying vec3 vW;
varying vec4 vRefl;
varying float vDepth;
varying float vEdge;
varying vec2 vUv;
void main(){
  vDepth = aDepth;
  vEdge = aEdge;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vRefl = uTexMatrix * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uDeep, uShallow, uFoam, uSunColor, uSkyColor, uSunDir;
uniform float uNight, uGlow, uDistort, uReflectAmt, uDbg, uFlow;
uniform float uFlowMode, uEndFade;
uniform sampler2D uReflect;
varying vec3 vW;
varying vec4 vRefl;
varying float vDepth;
varying float vEdge;
varying vec2 vUv;
${NOISE_GLSL}
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec2 p = vW.xz;
  float t = uTime;

  // 沿 vUv.y 卷动 = 顺流方向(河道:沿曲线;湖面:沿半径,读作一圈圈扩散的涟漪)
  float r1 = vnoise(vec2(p.x * 5.2, p.y * 5.2) + vec2(t * 0.18, -t * 0.26));
  float r2 = vnoise(vec2(p.x * 14.0, p.y * 14.0) - vec2(t * 0.34, -t * 0.52));
  float r3 = vnoise(p * 41.0 + vec2(-t * 0.42, t * 0.31));
  vec3 N = normalize(vec3(
    (r1 - 0.5) * 0.36 + (r2 - 0.5) * 0.22,
    1.0,
    (r1 - 0.5) * 0.32 - (r2 - 0.5) * 0.20
  ));

  float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
  float dep = clamp(vDepth * 3.0, 0.0, 1.0);

  // 真实反射:按法线扰动投影 uv,采镜像相机的 RT。
  // 之前是"混一个假天空色",所以水面像一块发亮的塑料片。
  // 顺流亮纹:水"有没有在流"主要靠它,法线扰动只在强光下才看得出来
  vec2 fp = uFlowMode > 0.5
    ? vec2(vUv.x * 9.0, vUv.y * 18.0 - t * 1.5)                       // 河道:沿曲线顺流
    : vec2(p.x * 5.5 + t * 0.10, p.y * 5.5 - t * 0.16);                // 湖面:世界坐标漂移
  float flowTex = vnoise(fp);
  float flowTex2 = vnoise(fp * 1.9 + vec2(3.7, -t * 0.30));
  float flowStreak = pow(smoothstep(0.55, 0.96, flowTex * 0.6 + flowTex2 * 0.6), 1.3);
  // 用世界坐标噪声把它打碎,否则湖面是一圈圈太规整的同心环
  flowStreak *= 0.35 + 1.05 * vnoise(p * 2.6 + vec2(t * 0.04, -t * 0.03));

  vec2 ruv = vRefl.xy / max(vRefl.w, 1e-4);
  ruv += N.xz * uDistort * (1.0 - dep * 0.4);
  vec3 reflCol = texture2D(uReflect, clamp(ruv, vec2(0.002), vec2(0.998))).rgb;
  reflCol *= mix(vec3(1.0), uDeep * 1.8 + vec3(0.10), 0.30);   // 反射被水体染一点色
  reflCol *= mix(1.0, 0.55, uNight);
  // 湖在深空里,正上方反射的大多是暗色的树底与空间 → 混一点环境光,别整片发黑
  vec3 ambRefl = uSkyColor * 0.50 + uSunColor * 0.10;
  reflCol = mix(reflCol, ambRefl, 0.32);
  // 反射本身可能是深空(近黑)或岛的岩底,给个下限,别让水面出现"黑洞"
  reflCol = max(reflCol, ambRefl * 0.55);

  vec3 base = mix(uShallow, uDeep, dep);
  float reflK = clamp((0.46 + fres * 0.72) * uReflectAmt, 0.0, 1.0);
  vec3 col = mix(base, reflCol, reflK);
  col += uFoam * flowStreak * uFlow * 0.42;

  // 只留太阳那一束高光。原来的 pow(vnoise(p*33),16) 碎光频率高于像素密度,
  // 走样成一片白点(远看像冰碴/鱼鳞)—— 直接删掉。
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), 150.0) * 1.15;
  col += uSunColor * spec * (0.55 + 0.45 * (1.0 - uNight));

  float foam = smoothstep(0.14, 0.0, vDepth) * (0.55 + 0.45 * sin(t * 1.9 + p.x * 9.0 + p.y * 7.5));
  foam += (1.0 - vEdge) * 0.22;
  float wob = vnoise(p * 14.0 + vec2(t * 0.12, 0.0));
  foam *= 0.55 + 0.75 * wob;
  col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.42);

  col *= uGlow;

  if (uDbg > 0.5) {           // 诊断:1=反射 RT 2=顺流亮纹 3=法线扰动 4=深度
    if (uDbg < 1.5)      gl_FragColor = vec4(reflCol, 1.0);
    else if (uDbg < 2.5) gl_FragColor = vec4(vec3(flowStreak), 1.0);
    else if (uDbg < 3.5) gl_FragColor = vec4(N * 0.5 + 0.5, 1.0);
    else                 gl_FragColor = vec4(vec3(dep), 1.0);
    return;
  }

  // 浅水更透(能看见湖底),深水更实
  // aDepth 取自未平滑的解析高度,而地形做过两遍平滑(最多差 ~0.06)。
  // 淡出带必须比这个误差宽,否则岸线上会浮出一圈多边形硬边。
  float alpha = smoothstep(0.04, 0.20, vDepth) * (0.58 + 0.42 * dep);
  // 原来这里还有一句 alpha = max(alpha, foam*0.85) —— 泡沫把不透明度强行顶到 0.85,
  // 而泡沫恰好集中在"深度很小"的那一圈(地形平滑误差也在这里),于是画出一圈多边形硬边。
  // 现在泡沫只做"补一点不透明度",不再决定水面在哪结束。
  alpha *= 1.0 + clamp(foam, 0.0, 1.0) * 0.40;
  alpha *= mix(0.38, 1.0, vEdge);   // 河岸软化;原来 0.10 太透,水面看着比实际窄一半
  // 河湖接缝:汇入湖的一头 / 流出湖的一头淡出,让两片水自然接住
  if (uEndFade > 0.5 && uEndFade < 1.5) alpha *= smoothstep(1.0, 0.965, vUv.y);   // 汇入湖:只淡最后 3.5%
  else if (uEndFade >= 1.5) alpha *= smoothstep(0.0, 0.035, vUv.y);               // 流出湖:只淡起端 3.5%
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * 0.94);
}
`;

const FALL_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FALL_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uFoam, uShallow, uSunColor;
uniform float uNight;
varying vec2 vUv;
varying vec3 vW;
${NOISE_GLSL}
void main(){
  float t = uTime;
  float u = vUv.x;
  float v = vUv.y;              // 0 顶 → 1 底

  // flow map 套路:两层不同速度的卷动 + 一层横向流场(让丝缕左右游走,不是笔直下垂)
  float flow = vnoise(vec2(v * 3.4 - t * 0.8, u * 2.0 + 4.0)) - 0.5;
  float uu = u + flow * 0.085 * smoothstep(0.0, 0.35, v);
  vec2 q = vec2(uu * 9.0, v * 4.2 - t * 1.55);
  float s1 = vnoise(q);
  float s2 = vnoise(q * vec2(2.3, 1.0) + vec2(11.0, -t * 2.3));
  float streak = smoothstep(0.28, 0.92, s1 * 0.60 + s2 * 0.60);
  float thread = smoothstep(0.55, 1.0, vnoise(vec2(uu * 26.0, v * 2.2 - t * 2.9)));

  float edge = smoothstep(0.0, 0.20, u) * smoothstep(1.0, 0.80, u);
  float head = smoothstep(0.0, 0.035, v) * (0.65 + 0.35 * smoothstep(0.0, 0.12, v));
  float tail = smoothstep(1.0, 0.34, v);

  vec3 col = mix(uShallow * 0.85, uFoam, 0.18 + 0.62 * streak + 0.25 * thread);
  col += uSunColor * (0.06 + 0.24 * streak) * (1.0 - uNight * 0.45);

  float a = edge * head * tail * (0.14 + 0.56 * streak + 0.30 * thread);
  a *= 0.66;
  gl_FragColor = vec4(col, a);
}
`;

/** 湖面:极坐标圆盘,岸边 aDepth → 0 自动软化 */
function buildLake(island, uniforms) {
  const { lake } = island;
  const R = lake.r * 1.32;
  const RINGS = 96;
  const SEGS = 256;   // 岸线 alpha 是按顶点 aDepth 插值的,网格粗了就会出"皱纹"
  const pos = [], depth = [], edge = [], uv = [], idx = [];

  for (let j = 0; j <= RINGS; j++) {
    const rr = (j / RINGS) * R;
    for (let i = 0; i <= SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2;
      const x = lake.x + Math.cos(a) * rr;
      const z = lake.z + Math.sin(a) * rr;
      pos.push(x, lake.y, z);
      const bed = island.heightAt(x, z);
      depth.push(Math.max(0, lake.y - bed));
      edge.push(1);
      uv.push(i / SEGS, j / RINGS);
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEGS; i++) {
      const a = j * (SEGS + 1) + i;
      const b = a + 1, c = a + SEGS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  // ⚠ 必须给每片水一份**自己的** uniform 容器:
  // 之前 lake/river 共用同一个 uniforms 对象,分别设 uFlow 时后者覆盖前者。
  const u = { ...uniforms, uFlow: { value: 0.22 }, uFlowMode: { value: 0 }, uEndFade: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'lake';
  mesh.renderOrder = 2;
  return mesh;
}

/** 河道:沿剖面拉一条带 */
function buildRiver(river, uniforms) {
  const pts = river.pts;
  const N = river.N;
  const pos = [], depth = [], edge = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i];
    const pPrev = pts[Math.max(0, i - 1)];
    const pNext = pts[Math.min(N, i + 1)];
    let tx = pNext.x - pPrev.x;
    let tz = pNext.z - pPrev.z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len; tz /= len;
    const nx = -tz, nz = tx;
    const w = river.width * (1 + 0.28 * smoothstep(0.7, 1.0, i / N));
    // 三列断面:两岸边 aEdge→0 自动软化,中泓水满
    for (const s of [-1, 0, 1]) {
      const x = p.x + nx * w * s;
      const z = p.z + nz * w * s;
      pos.push(x, p.y, z);
      depth.push(s === 0 ? 0.26 : 0.055);
      edge.push(s === 0 ? 1 : 0);
      uv.push(s * 0.5 + 0.5, i / N);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      const b = a + 1;
      const c = (i + 1) * 3 + k;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const u = {
    ...uniforms,
    uFlow: { value: 1.0 },
    uFlowMode: { value: 1 },
    uEndFade: { value: river.endFade || 0 },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'river';
  mesh.renderOrder = 2;
  return mesh;
}

/** 瀑布:从瀑布口垂到虚空里,越往下越宽越透 */
function buildFall(fall, uniforms) {
  const N = 56;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const y = fall.y + (fall.bottomY - fall.y) * Math.pow(u, 1.22);
    const spread = fall.width * (1 + 1.35 * Math.pow(u, 1.4));
    const out = 0.34 * Math.pow(u, 1.6);
    const cx = fall.x + fall.dx * out + Math.sin(u * 3.1) * 0.045;
    const cz = fall.z + fall.dz * out + Math.cos(u * 2.4) * 0.045;
    const px = -fall.dz, pz = fall.dx;
    for (const s of [-1, 1]) {
      pos.push(cx + px * spread * s, y, cz + pz * spread * s);
      uv.push(s < 0 ? 0 : 1, u);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uFoam: uniforms.uFoam,
      uShallow: uniforms.uShallow,
      uSunColor: uniforms.uSunColor,
      uNight: uniforms.uNight,
    },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'waterfall';
  mesh.renderOrder = 3;
  return mesh;
}

let waterReflectionBroken = false;

export function createWater(island, pal, reflection = null) {
  const uniforms = createWaterUniforms();
  syncUniforms(uniforms, pal);

  const group = new THREE.Group();
  group.name = 'water';
  const lake = buildLake(island, uniforms);
  group.add(lake);
  const riverMeshes = island.rivers.map((r, idx) => {
    // 0 = 山泉→湖(尾端淡出)  1 = 湖→瀑布口(起端淡出)
    const m = buildRiver({ ...r, endFade: idx === 0 ? 1 : 2 }, uniforms);
    group.add(m);
    return m;
  });
  const fall = buildFall(island.fall, uniforms);
  group.add(fall);

  return {
    group,
    lake,
    rivers: riverMeshes,
    fall,
    uniforms,
    update(t, p) {
      uniforms.uTime.value = t;
      syncUniforms(uniforms, p);
    },
    /** 每帧在 post.render 之前调:渲一遍镜像视图,把矩阵与纹理喂给水面 */
    renderReflection(renderer, camera) {
      if (!reflection || waterReflectionBroken) return;
      try {
        reflection.render(renderer, camera);
      } catch (err) {
        // 反射出问题不能把整个主循环拖死(否则画面就停在黑屏上)
        waterReflectionBroken = true;
        console.error('[water] 平面反射已关闭:', err);
        return;
      }
      uniforms.uReflect.value = reflection.target.texture;
      uniforms.uTexMatrix.value.copy(reflection.textureMatrix);
    },
    resizeReflection(w, h) {
      if (reflection) reflection.resize(w, h);
    },
  };
}
