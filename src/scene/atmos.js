/**
 * 氛围层:漂浮云朵(面向相机的软精灵云团)、薄雾、体积光柱、浮尘、萤火。
 *
 * 云不用球几何 —— 球簇在这种尺度永远是"爆米花"。改成 instanced 软精灵:
 * 顶点着色器里做 billboard,片元采样噪声 puff,云才"虚"得下去。
 */
import * as THREE from 'three';
import { mulberry32 } from '../lib/noise.js';
import { puffTexture, glowTexture, shaftTexture } from '../lib/textures.js';

const CLOUD_VERT = /* glsl */`
attribute float aTint;
attribute float aSeed;
varying vec2 vUv;
varying float vTint;
varying float vSeed;
void main(){
  vUv = uv;
  vTint = aTint;
  vSeed = aSeed;
  vec3 center = instanceMatrix[3].xyz;
  float scl = length(instanceMatrix[0].xyz);
  // 世界空间的相机基向量 → billboard
  vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = center + (cr * position.x + cu * position.y) * scl;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uMap;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying vec2 vUv;
varying float vTint;
varying float vSeed;
void main(){
  // 只旋转不缩放:整张 puff 都要采到,不然平面边缘的 alpha 不为 0 → 露出方形
  vec2 p = vUv - 0.5;
  float ang = vSeed * 6.2831;
  float cs = cos(ang), sn = sin(ang);
  vec2 uv = clamp(mat2(cs, -sn, sn, cs) * p + 0.5, 0.0, 1.0);
  float a = texture2D(uMap, uv).a * uOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uShade, uLit, clamp(vTint, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
}
`;

function lux(p) { return 0.45 + 0.55 * p.dayFactor; }

function createClouds(rnd, group) {
  const defs = [
    { x: -3.05, y: 3.95, z: -0.30, s: 1.50, n: 12, spd: 0.030, rad: 1.45 },
    { x: 3.25, y: 4.15, z: 1.60, s: 1.30, n: 12, spd: -0.024, rad: 1.20 },
    { x: -3.60, y: 2.60, z: 2.15, s: 1.05, n: 10, spd: 0.036, rad: 1.15 },
    { x: 2.25, y: 3.10, z: -3.15, s: 1.00, n: 10, spd: -0.030, rad: 1.10 },
    { x: 1.55, y: 4.72, z: -1.05, s: 1.00, n: 9, spd: 0.024, rad: 0.85 },
    { x: -1.05, y: 4.55, z: 3.30, s: 0.90, n: 9, spd: -0.020, rad: 0.95 },
    { x: 4.20, y: 2.25, z: -2.55, s: 0.80, n: 8, spd: 0.042, rad: 0.85 },
    { x: -4.30, y: 1.95, z: -1.60, s: 0.72, n: 8, spd: 0.028, rad: 0.70 },
  ];

  const sprites = [];
  for (let ci = 0; ci < defs.length; ci++) {
    const d = defs[ci];
    for (let i = 0; i < d.n; i++) {
      const u = rnd() * 2 - 1;
      const th = rnd() * Math.PI * 2;
      const rr = Math.pow(rnd(), 0.55);
      const sx = Math.sqrt(1 - u * u);
      const ox = Math.cos(th) * sx * rr;
      const oz = Math.sin(th) * sx * rr * 0.62;
      const oy = u * rr * 0.34;
      const rad = d.s * (0.78 + rnd() * 0.55) * (1 - 0.22 * rr);
      sprites.push({
        cloud: ci,
        ox: ox * d.s * 1.05,
        oy: oy * d.s * 0.62,
        oz: oz * d.s * 1.05,
        rad,
        tint: Math.min(1, 0.34 + 0.78 * (0.5 + oy * 0.9) + rnd() * 0.14),
        seed: rnd(),
        phase: rnd() * 6.28,
      });
    }
  }

  // InstancedMesh(自带 instanceMatrix / setMatrixAt)+ 额外的 instanced 属性
  const geo = new THREE.PlaneGeometry(1, 1);
  const tints = new Float32Array(sprites.length);
  const seeds = new Float32Array(sprites.length);
  sprites.forEach((s, i) => { tints[i] = s.tint; seeds[i] = s.seed; });
  geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 1));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: puffTexture(256, 31, 1.0, 0.42, 0.7) },
      uLit: { value: new THREE.Color('#ffffff') },
      uShade: { value: new THREE.Color('#5b6a86') },
      uOpacity: { value: 0.20 },
    },
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, sprites.length);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.name = 'clouds';
  group.add(mesh);

  const m4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  const lit = new THREE.Color();
  const shade = new THREE.Color();
  const white = new THREE.Color('#ffffff');
  const dark = new THREE.Color('#20263a');

  return {
    mesh,
    mat,
    update(t, p) {
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        const d = defs[s.cloud];
        const a = d.spd * t * 2.0 + s.cloud * 1.37;
        const bob = Math.sin(t * 0.26 + s.cloud * 1.7 + s.phase * 0.15) * 0.10;
        v3.set(
          d.x + Math.cos(a) * d.rad + s.ox,
          d.y + bob + s.oy,
          d.z + Math.sin(a * 0.83 + s.cloud * 2.0) * d.rad + s.oz,
        );
        m4.makeScale(s.rad, s.rad, s.rad);
        m4.setPosition(v3);
        mesh.setMatrixAt(i, m4);
      }
      mesh.instanceMatrix.needsUpdate = true;

      lit.copy(p.sun).lerp(white, 0.70).multiplyScalar(0.55 + 0.55 * p.dayFactor);
      shade.copy(p.hemiSky).lerp(dark, 0.30).multiplyScalar(0.72 + 0.34 * lux(p));
      mat.uniforms.uLit.value.copy(lit);
      mat.uniforms.uShade.value.copy(shade);
    },
  };
}

export function createAtmos(island, pal) {
  const rnd = mulberry32(777777);
  const group = new THREE.Group();
  group.name = 'atmos';

  const clouds = createClouds(rnd, group);

  // ---------------- 薄雾 ----------------
  const mistTex = puffTexture(256, 91, 1.0, 0.85, 1.0);
  const mists = [];
  const mkMist = (x, y, z, s, rot, extra = {}) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshBasicMaterial({
        map: mistTex,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
        color: 0xdfeaf5,
      }),
    );
    m.position.set(x, y, z);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = rot;
    m.renderOrder = 5;
    m.userData = {
      baseOpacity: extra.baseOpacity ?? 0.22,
      spin: extra.spin ?? 0.02,
      billboard: false,
      y,
      bobAmp: extra.bobAmp ?? 0.03,
      bobPhase: rnd() * 6.28,
    };
    mists.push(m);
    group.add(m);
    return m;
  };

  // 岛面之上不放雾了:那层横铺的软片会把整块岛糊成"罩了一层膜"。
  // 雾只留在岛底下(托住悬浮感)和瀑布水花。
  const L = island.lake;

  // ---------------- 云海:岛沉在一层厚云里(蓬莱的标志) ----------------
  const seaTex = puffTexture(512, 707, 1.0, 0.75, 1.6);
  const seaLayers = [];
  const seaDefs = [
    [-1.95, 9.4, 0.30, 0.010],
    [-2.55, 9.2, 0.38, -0.007],
    [-3.15, 8.0, 0.34, 0.013],
    [-3.75, 8.8, 0.26, -0.011],
    [-4.35, 6.8, 0.16, 0.008],
  ];
  for (const [y, size, op, spin] of seaDefs) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({
        map: seaTex, transparent: true, opacity: op, depthWrite: false,
        blending: THREE.NormalBlending, side: THREE.DoubleSide, color: 0xe8f6f2,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, y, 0);
    m.renderOrder = 4;
    m.userData = { baseOpacity: op, spin, y, bobAmp: 0.05, bobPhase: rnd() * 6.28 };
    group.add(m);
    seaLayers.push(m);
  }

  // 岛底雾带:放到岩底以下,让它"悬"住又别糊掉岩底
  mkMist(0, -2.95, 0, 6.4, 0.6, { baseOpacity: 0.15, spin: 0.007, bobAmp: 0.045 });
  mkMist(0, -3.75, 0, 5.0, 2.4, { baseOpacity: 0.10, spin: -0.010, bobAmp: 0.05 });

  // 瀑布水花
  const spray = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 2.1),
    new THREE.MeshBasicMaterial({
      map: mistTex, transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.NormalBlending, side: THREE.DoubleSide, color: 0xe8f6ff,
    }),
  );
  spray.position.set(
    island.fall.x + island.fall.dx * 0.5,
    island.fall.bottomY + 0.85,
    island.fall.z + island.fall.dz * 0.5,
  );
  spray.renderOrder = 6;
  spray.userData = { baseOpacity: 0.30, spin: 0, billboard: true, y: spray.position.y, bobAmp: 0.06, bobPhase: 1.7 };
  mists.push(spray);
  group.add(spray);

  // ---------------- 瀑布底部水花(粒子) ----------------
  const SPL = 160;
  const spos = new Float32Array(SPL * 3);
  const sph = new Float32Array(SPL);
  const ssz = new Float32Array(SPL);
  const f0 = island.fall;
  for (let i = 0; i < SPL; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6) * 0.42;
    spos[i * 3] = f0.x + f0.dx * 0.32 + Math.cos(a) * rr;
    spos[i * 3 + 1] = f0.bottomY + 0.22;
    spos[i * 3 + 2] = f0.z + f0.dz * 0.32 + Math.sin(a) * rr;
    sph[i] = rnd();
    ssz[i] = 1.6 + rnd() * 3.0;
  }
  const splGeo = new THREE.BufferGeometry();
  splGeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  splGeo.setAttribute('aPhase', new THREE.BufferAttribute(sph, 1));
  splGeo.setAttribute('aSize', new THREE.BufferAttribute(ssz, 1));
  const splMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.5 },
      uScale: { value: 1 },
      uRise: { value: 0.62 },
      uMap: { value: glowTexture(64) },
      uColor: { value: new THREE.Color('#eaf7ff') },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uScale;
      uniform float uRise;
      varying float vA;
      void main(){
        float ph = fract(aPhase + uTime * 0.42);
        vec3 p = position;
        // 上升后被重力拽回,横向随相位散开
        p.y += ph * uRise;
        float spread = ph * 0.30;
        p.x += sin(aPhase * 43.7 + uTime * 1.6) * spread;
        p.z += cos(aPhase * 27.3 + uTime * 1.4) * spread;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fade = smoothstep(0.0, 0.12, ph) * smoothstep(1.0, 0.55, ph);
        vA = uOpacity * fade;
        gl_PointSize = aSize * uScale * (1.0 + ph * 1.4);
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const splash = new THREE.Points(splGeo, splMat);
  splash.frustumCulled = false;
  splash.name = 'fall-splash';
  group.add(splash);

  // ---------------- 体积光柱 ----------------
  const shaftTex = shaftTexture(64, 256);
  const shafts = new THREE.Group();
  shafts.name = 'light-shafts';
  const shaftDefs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.31;
    const rr = 1.5 + (i % 3) * 1.05;
    const w = 1.3 + (i % 2) * 0.7;
    const h = 5.2 + (i % 4) * 0.8;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: shaftTex, transparent: true, opacity: 0.02, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }),
    );
    m.position.set(Math.cos(a) * rr, 2.6 + (i % 3) * 0.25, Math.sin(a) * rr);
    m.userData = { a, base: 0.010 + (i % 3) * 0.005 };
    shafts.add(m);
    shaftDefs.push(m);
  }
  group.add(shafts);

  // ---------------- 浮尘 ----------------
  const DUST = 700;
  const dpos = new Float32Array(DUST * 3);
  const dphase = new Float32Array(DUST);
  const dsize = new Float32Array(DUST);
  for (let i = 0; i < DUST; i++) {
    dpos[i * 3] = (rnd() - 0.5) * 10.6;
    dpos[i * 3 + 1] = -4.2 + rnd() * 9.6;
    dpos[i * 3 + 2] = (rnd() - 0.5) * 10.6;
    dphase[i] = rnd();
    dsize[i] = 0.7 + rnd() * 1.6;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dustGeo.setAttribute('aPhase', new THREE.BufferAttribute(dphase, 1));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dsize, 1));

  const dustMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.4 },
      uScale: { value: 1 },
      uMap: { value: glowTexture(64) },
      uColor: { value: new THREE.Color('#f6e6c8') },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uScale;
      varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * 0.05 + aPhase * 9.4 + 4.2, 9.6) - 4.4;
        p.x += sin(uTime * 0.31 + aPhase * 6.28) * 0.26;
        p.z += cos(uTime * 0.27 + aPhase * 5.11) * 0.26;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float near = smoothstep(6.4, 0.6, length(p));
        vA = uOpacity * (0.30 + 0.70 * pow(max(0.0, sin(uTime * 1.7 + aPhase * 12.0)), 2.0)) * near;
        gl_PointSize = aSize * uScale;
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  dust.name = 'dust';
  group.add(dust);

  // ---------------- 萤火 ----------------
  const FF = 120;
  const fpos = new Float32Array(FF * 3);
  const fphase = new Float32Array(FF);
  const fsize = new Float32Array(FF);
  for (let i = 0; i < FF; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * 3.8;
    const x = Math.cos(a) * rr;
    const z = Math.sin(a) * rr;
    fpos[i * 3] = x;
    fpos[i * 3 + 1] = island.sampleY(x, z) + 0.05 + rnd() * 0.5;
    fpos[i * 3 + 2] = z;
    fphase[i] = rnd();
    fsize[i] = 1.6 + rnd() * 2.6;
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  ffGeo.setAttribute('aPhase', new THREE.BufferAttribute(fphase, 1));
  ffGeo.setAttribute('aSize', new THREE.BufferAttribute(fsize, 1));

  const ffMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uScale: { value: 1 },
      uMap: { value: glowTexture(64) },
      uColor: { value: new THREE.Color('#ffd98a') },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uScale;
      varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.63 + aPhase * 6.28) * 0.18;
        p.y += sin(uTime * 0.87 + aPhase * 4.13) * 0.14;
        p.z += cos(uTime * 0.71 + aPhase * 5.71) * 0.18;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blink = pow(max(0.0, sin(uTime * 1.9 + aPhase * 21.0)), 2.4);
        vA = uOpacity * (0.10 + 0.90 * blink);
        gl_PointSize = aSize * uScale * (0.7 + 0.6 * blink);
      }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      void main(){
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  fireflies.frustumCulled = false;
  fireflies.name = 'fireflies';
  group.add(fireflies);

  const white = new THREE.Color('#ffffff');

  return {
    group,
    update(t, p, camera, extras) {
      const pr = (extras && extras.pixelRatio) || 1;

      clouds.update(t, p);

      for (const m of mists) {
        const ud = m.userData;
        if (ud.billboard && camera) m.quaternion.copy(camera.quaternion);
        else if (!ud.billboard) m.rotation.z = ud.spin * t;
        m.position.y = ud.y + Math.sin(t * 0.45 + ud.bobPhase) * (ud.bobAmp || 0.03);
        m.material.opacity = ud.baseOpacity * (0.30 + 0.85 * p.mist);
        m.material.color.copy(p.hemiSky).lerp(white, 0.60);
      }

      for (const m of seaLayers) {
        const ud = m.userData;
        m.rotation.z = ud.spin * t;
        m.position.y = ud.y + Math.sin(t * 0.22 + ud.bobPhase) * ud.bobAmp;
        m.material.opacity = ud.baseOpacity * (0.55 + 0.85 * p.mist);
        m.material.color.copy(p.hemiSky).lerp(new THREE.Color('#ffffff'), 0.66);
      }

      const sunAz = Math.atan2(p.sunDir.z, p.sunDir.x);
      for (const s of shaftDefs) {
        if (camera) {
          const dx = camera.position.x - s.position.x;
          const dz = camera.position.z - s.position.z;
          s.rotation.y = Math.atan2(dx, dz) + Math.sin(t * 0.12 + s.userData.a) * 0.06;
        }
        // 倾角压小、片数减少:多片加色面交叉会变成放射状条纹
        s.rotation.z = 0.05 * Math.sin(s.userData.a * 1.7 + t * 0.07) + (sunAz - 2.4) * 0.04;
        s.material.opacity = s.userData.base
          * (0.2 + 1.0 * p.dayFactor)
          * (0.6 + 0.4 * Math.sin(t * 0.5 + s.userData.a * 3));
        s.material.color.copy(p.sun).lerp(white, 0.45);
      }

      splMat.uniforms.uTime.value = t;
      splMat.uniforms.uOpacity.value = 0.30 + 0.35 * (0.35 + 0.65 * p.dayFactor);
      splMat.uniforms.uScale.value = pr * 2.2;
      splMat.uniforms.uRise.value = 0.55 + 0.25 * (1 - p.nightFactor);

      dustMat.uniforms.uTime.value = t;
      dustMat.uniforms.uOpacity.value = 0.06 + 0.30 * (0.35 + 0.65 * p.dayFactor);
      dustMat.uniforms.uScale.value = pr * 1.9;
      dustMat.uniforms.uColor.value.copy(p.sun).lerp(white, 0.55);

      ffMat.uniforms.uTime.value = t;
      ffMat.uniforms.uOpacity.value = p.firefly;
      ffMat.uniforms.uScale.value = pr * 2.6;
      fireflies.visible = p.firefly > 0.02;
    },
  };
}
