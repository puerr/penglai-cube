/**
 * 后期链:RenderPass → 移轴模糊(H+V 两趟)→ UnrealBloom → OutputPass(ACES+sRGB)→ 胶片(暗角/颗粒/色散)。
 * 移轴不是真景深:按屏幕 Y 到"焦点带"的距离决定模糊量 —— 这正是移轴镜头的可见特征,也更省。
 */
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from '../vendor/three/addons/shaders/FXAAShader.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TiltShiftShader = {
  name: 'TiltShiftShader',
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 800) },
    uDir: { value: new THREE.Vector2(1, 0) },
    uAmount: { value: 6.5 },
    uFocus: { value: 0.53 },
    uBand: { value: 0.135 },
    uFeather: { value: 0.30 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform vec2 uDir;
    uniform float uAmount;
    uniform float uFocus;
    uniform float uBand;
    uniform float uFeather;
    varying vec2 vUv;
    void main(){
      float d = abs(vUv.y - uFocus);
      float k = smoothstep(uBand, uBand + uFeather, d);
      // 角落再多一点
      float dx = abs(vUv.x - 0.5);
      k = max(k, smoothstep(0.34, 0.52, dx) * 0.85);
      vec2 stp = uDir * uTexel * (k * uAmount);
      vec4 sum = texture2D(tDiffuse, vUv) * 0.227027;
      sum += texture2D(tDiffuse, vUv + stp * 1.3846154) * 0.3162162;
      sum += texture2D(tDiffuse, vUv - stp * 1.3846154) * 0.3162162;
      sum += texture2D(tDiffuse, vUv + stp * 3.2307692) * 0.0702703;
      sum += texture2D(tDiffuse, vUv - stp * 3.2307692) * 0.0702703;
      gl_FragColor = sum;
    }
  `,
};

const FilmShader = {
  name: 'FilmShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 800) },
    uTime: { value: 0 },
    uGrain: { value: 0.032 },
    uAberration: { value: 0.0022 },
    uVignette: { value: 1.0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0, 289.0))) * 43758.5453123); }

    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ab = uAberration * (0.35 + r2 * 2.4);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;

      float v = smoothstep(1.10, 0.24, length(c * vec2(1.02, 1.16)));
      col *= mix(0.30, 1.0, mix(1.0, v, uVignette));

      float g = hash(vUv * uResolution + fract(uTime * 0.37) * 137.0) - 0.5;
      col += g * uGrain * (1.0 - 0.45 * v);

      col = max(col, vec3(0.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera, opts = {}) {
  const W = opts.width || 1280;
  const H = opts.height || 800;
  const PR = opts.pixelRatio || 1;
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(PR);
  composer.setSize(W, H);
  const bloomRes = new THREE.Vector2(W * PR, H * PR);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const tiltH = new ShaderPass(TiltShiftShader);
  tiltH.uniforms.uDir.value.set(1, 0);
  composer.addPass(tiltH);

  const tiltV = new ShaderPass(TiltShiftShader);
  tiltV.uniforms.uDir.value.set(0, 1);
  composer.addPass(tiltV);

  const bloom = new UnrealBloomPass(bloomRes, 0.5, 0.72, 0.82);
  composer.addPass(bloom);

  const output = new OutputPass();
  composer.addPass(output);

  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  const state = {
    enabled: opts.enabled !== false,
    tilt: false,            // 移轴默认关(会把画面上/下沿糊掉);按 F 可开回来
    bloomOn: true,
    filmOn: true,
    aa: true,
  };

  function applyToggles() {
    tiltH.enabled = state.tilt;
    tiltV.enabled = state.tilt;
    fxaa.enabled = state.aa;
    bloom.enabled = state.bloomOn;
    film.enabled = state.filmOn;
  }
  applyToggles();

  return {
    composer,
    renderPass,
    bloom,
    tiltH,
    tiltV,
    fxaa,
    film,
    output,
    state,
    toggle(what) {
      if (what === 'post') state.enabled = !state.enabled;
      if (what === 'tilt') state.tilt = !state.tilt;
      if (what === 'bloom') state.bloomOn = !state.bloomOn;
      if (what === 'film') state.filmOn = !state.filmOn;
      if (what === 'aa') state.aa = !state.aa;
      applyToggles();
      return state;
    },
    setSize(w, h, pixelRatio) {
      if (pixelRatio) composer.setPixelRatio(pixelRatio);
      composer.setSize(w, h);
      const pr = pixelRatio || composer.pixelRatio || 1;
      bloom.setSize(w * pr, h * pr);
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      tiltH.uniforms.uTexel.value.set(1 / db.x, 1 / db.y);
      tiltV.uniforms.uTexel.value.set(1 / db.x, 1 / db.y);
      film.uniforms.uResolution.value.set(db.x, db.y);
      fxaa.material.uniforms.resolution.value.set(1 / db.x, 1 / db.y);
      // 移轴半径随分辨率缩放,保证观感一致
      const k = Math.max(0.55, Math.min(1.6, db.y / 900));
      tiltH.uniforms.uAmount.value = 4.6 * k;
      tiltV.uniforms.uAmount.value = 4.6 * k;
    },
    update(time, pal) {
      bloom.strength = pal.bloom;
      bloom.threshold = 0.78 - 0.18 * pal.nightFactor;
      bloom.radius = 0.66 + 0.2 * pal.nightFactor;
      film.uniforms.uTime.value = time;
    },
    render(dt) {
      if (state.enabled) composer.render(dt);
      else renderer.render(scene, camera);
    },
  };
}
