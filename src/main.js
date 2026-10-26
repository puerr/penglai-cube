/**
 * 入口:装配整个微缩世界。
 *
 * URL 参数(调试 / 验收用,全部可选):
 *   ?t=0.3        固定时刻(0=黎明 0.25=正午 0.5=日落 0.75=深夜)
 *   &freeze=1     冻结时间与自转(截图可复现)
 *   &glass=basic  关掉玻璃透射(软件光栅太慢时的退路)
 *   &only=water   只显示某一层   &hide=glass,mist  隐藏若干层
 *   &post=0       关整条后期链   &dpr=1  像素比   &debug=1 显示 drawcall
 */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/addons/controls/OrbitControls.js';
import { createPalette } from './core/palette.js';
import { envEquirectTexture } from './lib/textures.js';
import { createReflection } from './lib/reflection.js';
import { createSky } from './scene/sky.js';
import { createGlass } from './scene/glass.js';
import { createIsland } from './scene/island.js';
import { createWater } from './scene/water.js';
import { createFlora } from './scene/flora.js';
import { createFauna } from './scene/fauna.js';
import { createAtmos } from './scene/atmos.js';
import { createArchitecture } from './scene/architecture.js';
import { createImmortals } from './scene/immortal.js';
import { createPost } from './postfx.js';
import { createUI } from './ui.js';

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? parseFloat(params.get(k)) : d);
const flag = (k) => params.get(k) === '1' || params.get(k) === 'true';

const CUBE = 10.0;      // 等距投影高 = 边长×1.633 = 16.3,要装进视锥才看得出是正方体
const FRUSTUM = 17.6;   // 要把整个立方体装进画面:10×1.633 = 16.3 + 余量
const PERIOD = 52; // 一秒几轮:一轮昼夜 = 52s

function boot() {
  const ui = createUI();
  const canvas = document.getElementById('scene');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  const maxDpr = num('dpr', Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setPixelRatio(maxDpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = params.get('shadow') !== '0';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#03050b');

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 700);
  const camDir = new THREE.Vector3(1, 0.98, 1).normalize();
  const target = new THREE.Vector3(0, -0.18, 0);
  camera.position.copy(camDir).multiplyScalar(26).add(target);
  camera.lookAt(target);

  // ---------- 环境贴图(玻璃与黏土的高光来源) ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const eq = envEquirectTexture(512, 256);
  const envRT = pmrem.fromEquirectangular(eq);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1.0;
  eq.dispose();
  pmrem.dispose();

  const pal = createPalette();
  pal.apply(num('t', 0.30));

  // ---------- 灯光 ----------
  const keyLight = new THREE.DirectionalLight(0xffffff, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 60;
  // 收紧到场景实际范围:每单位的 texel 密度提高约 1.4 倍,掠射角自阴影条纹会明显减少
  keyLight.shadow.camera.left = -5.2;
  keyLight.shadow.camera.right = 5.2;
  keyLight.shadow.camera.top = 5.2;
  keyLight.shadow.camera.bottom = -5.2;
  keyLight.shadow.bias = -0.0005;
  keyLight.shadow.normalBias = 0.055;   // 原来 0.024 偏小,平缓坡面上会出条纹
  keyLight.shadow.camera.updateProjectionMatrix();
  scene.add(keyLight);
  scene.add(keyLight.target);

  const rimLight = new THREE.DirectionalLight(0xcfe0ff, 1);
  rimLight.position.set(-9, 11, -10);
  scene.add(rimLight);

  const moonLight = new THREE.DirectionalLight(0x9db8ff, 0.0);
  scene.add(moonLight);

  const hemi = new THREE.HemisphereLight(0x9dbbe0, 0x3a3428, 0.8);
  scene.add(hemi);

  const amb = new THREE.AmbientLight(0xaabbdd, 0.4);
  scene.add(amb);

  // ---------- 内容 ----------
  const parts = {};
  const layers = new Map();

  parts.sky = createSky();
  scene.add(parts.sky.group);
  layers.set('sky', parts.sky.group);

  const island = createIsland();

  // 默认便宜玻璃;要物理透射(refraction)用 ?glass=phys
  parts.glass = createGlass(CUBE, { physical: params.get('glass') === 'phys' });
  scene.add(parts.glass.group);
  layers.set('glass', parts.glass.group);
  // 玻璃罩开关:?glass=0 初始隐藏,运行中按 G 切换
  // 默认不显示玻璃罩;要看用 G 键或 ?glass=1
  if (params.get('glass') !== '1') parts.glass.group.visible = false;

  scene.add(island.group);
  layers.set('island', island.group);

  // 平面反射:镜像相机渲到半分辨率 RT(水面 shader 按世界坐标投影取样)
  const reflection = createReflection({ scene, planeY: island.lake.y, scale: 0.5 });

  // 逃生阀:机器扛不住平面反射(或多渲一遍场景)时用 ?refl=0 关掉
  const useReflection = params.get('refl') !== '0';
  parts.water = createWater(island, pal, useReflection ? reflection : null);
  scene.add(parts.water.group);
  layers.set('water', parts.water.group);
  // 水面自身不能进反射(会自反馈);玻璃排除掉 —— 它进去会再触发一遍透射渲染,太贵
  reflection.exclude(parts.water.group);
  reflection.exclude(parts.glass.group);
  reflection.install(renderer);

  // 建筑先建:它要占掉的地盘(半径)交给植被去避让
  parts.architecture = createArchitecture(island);
  scene.add(parts.architecture.group);
  layers.set('architecture', parts.architecture.group);
  const keepOut = parts.architecture.anchors.map((a) => ({ x: a.x, z: a.z, r: 0.34 }));

  parts.flora = createFlora(island, { exclude: keepOut });
  scene.add(parts.flora.group);
  layers.set('flora', parts.flora.group);

  parts.fauna = createFauna(island, { obstacles: parts.architecture.obstacles });
  scene.add(parts.fauna.group);
  layers.set('fauna', parts.fauna.group);

  parts.immortals = createImmortals(island, parts.architecture.standSpots);
  scene.add(parts.immortals.group);
  layers.set('immortals', parts.immortals.group);

  parts.atmos = createAtmos(island, pal);
  scene.add(parts.atmos.group);
  layers.set('atmos', parts.atmos.group);
  layers.set('mist', parts.atmos.group);   // README 里写的 hide=mist 别名

  // ---------- 层可见性(诊断)----------
  if (params.get('flat') === '1') {
    const tm = island.group.getObjectByName('terrain');
    tm.material.vertexColors = false;
    tm.material.color.set(0x9a9a9a);
    tm.material.flatShading = params.get('flatshade') === '1';
    tm.material.needsUpdate = true;
  }

  const dbg = params.get('dbg');
  if (dbg === 'refl') parts.water.uniforms.uDbg.value = 1;
  else if (dbg) parts.water.uniforms.uDbg.value = parseFloat(dbg) || 0;

  const only = params.get('only');
  const hide = (params.get('hide') || '').split(',').filter(Boolean);
  if (only) {
    for (const [name, obj] of layers) obj.visible = name === only;
  }
  for (const h of hide) {
    const obj = layers.get(h);
    if (obj) obj.visible = false;
  }

  // ---------- 相机控制 ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.44;
  controls.minZoom = 0.6;
  controls.maxZoom = 4.0;
  controls.rotateSpeed = 0.42;
  controls.zoomSpeed = 0.7;
  controls.autoRotateSpeed = 0.30;
  controls.autoRotate = !flag('freeze');
  controls.update();

  // 诊断:?zoom=1.8 推近;?ui=0 隐藏 HUD(截图用)
  const zoomParam = num('zoom', 1);
  if (zoomParam !== 1) {
    camera.zoom = zoomParam;
    camera.updateProjectionMatrix();
  }
  if (params.get('ui') === '0') {
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
  }

  // ---------- 仙人视角(?pov=1 或按 V) ----------
  const povCam = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.012, 400);
  let povIndex = -1;                 // -1 = 关闭;否则是站位点下标
  let povYaw = 0, povPitch = -0.10;
  const EYE_FWD = 0.042;             // 沿朝前推出去的量(眼在脸前,不在头球里)
  let povEye = num('eye', 0.176);    // 眼高,可由面板/URL 调
  let povDx = 0, povDz = 0;          // 相对基准点的平面偏移
  let povBase = null;                // 进入视角时记下的基准站位点
  const panel = document.getElementById('pov-panel');
  const spots = parts.architecture.standSpots;

  function applyPov() {
    const on = povIndex >= 0 && spots[povIndex];
    controls.enabled = !on;
    controls.autoRotate = !on && !paused;
    if (on) {
      const sp = spots[povIndex];
      // 朝向:一律望向岛心 —— 仙人本就站在建筑外侧,望出去就是全岛/湖面。
      // 俯仰:按站位高度算,站得越高越要俯下去。固定 -0.16rad(≈-9°)只适合地面那几个:
      // 雪山那位眼高 2.99,岛面在脚下 40~60°,小俯角会让整屏 95% 是空天、岛只剩最下沿一条。
      povYaw = Math.atan2(sp.x, sp.z);          // 相机 yaw 使其朝向原点
      povPitch = -Math.min(0.80, 0.14 + 0.20 * (sp.y + povEye));
      povBase = { x: sp.x, y: sp.y, z: sp.z };
      povDx = 0; povDz = 0;
      syncPanel();
    }
    if (panel) panel.classList.toggle('on', !!on);
    const hud = document.getElementById('hud-pov');
    if (hud) {
      hud.textContent = on ? `仙人视角 ${povIndex + 1}/${spots.length} · 拖动转头 · V 切换 · ESC 退出` : '';
      hud.style.opacity = on ? '1' : '0';
    }
  }
  /** 当前仙人实际站的位置(保留桥面那种自定义高度) */
  function povPlacement() {
    if (!povBase) return null;
    const x = povBase.x + povDx;
    const z = povBase.z + povDz;
    const dy = povBase.y - island.sampleY(povBase.x, povBase.z);   // 相对地面的高度差(桥面/台阶)
    return { x, y: island.sampleY(x, z) + dy, z };
  }

  function syncPanel() {
    const e = document.getElementById('pp-eye');
    const ex = document.getElementById('pp-dx');
    const ez = document.getElementById('pp-dz');
    if (e) {
      e.value = String(povEye);
      document.getElementById('pp-eye-v').textContent = povEye.toFixed(3);
      ex.value = String(povDx);
      document.getElementById('pp-dx-v').textContent = povDx.toFixed(2);
      ez.value = String(povDz);
      document.getElementById('pp-dz-v').textContent = povDz.toFixed(2);
    }
  }

  function cyclePov() {
    povIndex = povIndex + 1 >= spots.length ? -1 : povIndex + 1;
    applyPov();
  }

  let drag = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (povIndex < 0) return;
    drag = { x: e.clientX, y: e.clientY };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!drag || povIndex < 0) return;
    povYaw -= (e.clientX - drag.x) * 0.004;
    povPitch = Math.max(-1.2, Math.min(0.9, povPitch - (e.clientY - drag.y) * 0.003));
    drag = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', () => { drag = null; });
  renderer.domElement.addEventListener('wheel', (e) => {
    if (povIndex < 0) return;
    povCam.fov = Math.max(28, Math.min(95, povCam.fov + Math.sign(e.deltaY) * 3));
    povCam.updateProjectionMatrix();
  });

  // ---------- 后期 ----------
  const post = createPost(renderer, scene, camera, {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: maxDpr,
    enabled: params.get('post') !== '0',
  });

  // ---------- 尺寸 ----------
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    camera.left = (-FRUSTUM * aspect) / 2;
    camera.right = (FRUSTUM * aspect) / 2;
    camera.top = FRUSTUM / 2;
    camera.bottom = -FRUSTUM / 2;
    camera.updateProjectionMatrix();
    povCam.aspect = aspect;
    povCam.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    post.setSize(w, h, pr);
    parts.water.resizeReflection(w, h);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- 时间与键盘 ----------
  const freeze = flag('freeze');
  let timeOfDay = num('t', 0.30);
  let paused = freeze;
  let clockTime = 0;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      paused = !paused;
      controls.autoRotate = !paused;
      e.preventDefault();
    } else if (e.key === 'h' || e.key === 'H') {
      ui.toggle();
    } else if (e.key === 'r' || e.key === 'R') {
      camera.position.copy(camDir).multiplyScalar(26).add(target);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controls.target.copy(target);
      controls.update();
    } else if (e.key === '1') { timeOfDay = 0.03; }
    else if (e.key === '2') { timeOfDay = 0.25; }
    else if (e.key === '3') { timeOfDay = 0.45; }
    else if (e.key === '4') { timeOfDay = 0.67; }
    else if (e.key === '5') { timeOfDay = 0.90; }
    else if (e.key === 'p' || e.key === 'P') { post.toggle('post'); }
    else if (e.key === 'b' || e.key === 'B') { post.toggle('bloom'); }
    else if (e.key === 'f' || e.key === 'F') { post.toggle('tilt'); }
    else if (e.key === 'a' || e.key === 'A') { post.toggle('aa'); }
    else if (e.key === 'g' || e.key === 'G') { parts.glass.group.visible = !parts.glass.group.visible; }
    else if (e.key === 'v' || e.key === 'V') { cyclePov(); }
    else if (e.key === 'Escape' && povIndex >= 0) { povIndex = -1; applyPov(); e.preventDefault(); }
    else if (povIndex >= 0) {
      const step = e.shiftKey ? 0.05 : 0.01;
      let used = true;
      if (e.key === 'ArrowLeft') povDx -= step;
      else if (e.key === 'ArrowRight') povDx += step;
      else if (e.key === 'ArrowUp') povDz -= step;
      else if (e.key === 'ArrowDown') povDz += step;
      else if (e.key === '[') povEye = Math.max(0.02, povEye - 0.005);
      else if (e.key === ']') povEye = Math.min(0.60, povEye + 0.005);
      else if (e.key === 'c' || e.key === 'C') {
        const pl = povBase ? povPlacement() : null;
        const out = pl
          ? `[仙人] index=${povIndex + 1} x=${pl.x.toFixed(3)} y=${pl.y.toFixed(3)} z=${pl.z.toFixed(3)} eye=${povEye.toFixed(3)}`
          : '[仙人] 未进入视角';
        console.log(out);
        const hud = document.getElementById('hud-pov');
        if (hud) hud.textContent = out;
      } else used = false;
      if (used) { e.preventDefault(); syncPanel(); }
    }
  });

  // ---------- 主循环 ----------
  const clock = new THREE.Clock();
  let frames = 0;
  let fpsAcc = 0;
  let fps = 0;
  let firstRendered = false;

  const kd = new THREE.Vector3();
  const moonPos = new THREE.Vector3();

  function applyPalette() {
    pal.apply(timeOfDay);
    renderer.toneMappingExposure = pal.exposure;

    // 主光:太阳在地平线下时夹住高度,避免"从地底打光"
    kd.copy(pal.sunDir);
    if (kd.y < 0.14) {
      kd.y = 0.14 + (0.14 - kd.y) * 0.32;
      kd.normalize();
    }
    keyLight.position.copy(kd).multiplyScalar(24);
    keyLight.target.position.set(0, -0.3, 0);
    keyLight.target.updateMatrixWorld();
    keyLight.color.copy(pal.sun);
    keyLight.intensity = pal.sunI * (0.72 + 0.28 * pal.dayFactor);

    moonPos.copy(pal.moonDir).multiplyScalar(22);
    moonLight.position.copy(moonPos);
    moonLight.position.y = Math.max(moonLight.position.y, 6);
    moonLight.color.set('#9db8ff');
    moonLight.intensity = pal.moonI * 1.5;

    rimLight.color.copy(pal.rim);
    rimLight.intensity = pal.rimI;

    hemi.color.copy(pal.hemiSky);
    // 地面反弹色抬亮:湖盆内侧这类凹面只吃环境光,原来的深棕色会把它们压成近乎纯黑
    hemi.groundColor.copy(pal.hemiGround).lerp(new THREE.Color('#6b6552'), 0.45);
    hemi.intensity = pal.hemiI * 1.18;

    amb.color.copy(pal.amb);
    amb.intensity = pal.ambI * 1.15;
  }

  renderer.info.autoReset = false;
  window.__frames = 0;   // 帧计数:验收要等"渲染了几帧",不能等秒(软件光栅一帧 1~2s)

  const activeCamera = () => (povIndex >= 0 && spots[povIndex] ? povCam : camera);
  window.__povCamera = povCam;

  function frame() {
    renderer.info.reset();
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    clockTime += dt;

    if (!paused) {
      timeOfDay = (timeOfDay + dt / PERIOD) % 1;
    }

    applyPalette();
    if (povIndex >= 0 && spots[povIndex] && povBase) {
      const pl = povPlacement();
      // 仙人本体跟着走(不然相机动了人没动)
      parts.immortals.setSpot(povIndex, { x: pl.x, y: pl.y, z: pl.z });
      const bob = Math.sin(clockTime * 0.6 + povIndex) * 0.004;
      povCam.position.set(
        pl.x - Math.sin(povYaw) * EYE_FWD,
        pl.y + povEye + bob,
        pl.z - Math.cos(povYaw) * EYE_FWD,
      );
      povCam.rotation.set(povPitch, povYaw, 0, 'YXZ');
      post.renderPass.camera = povCam;
    } else {
      // ⚠ 退出仙人视角必须把渲染相机换回主相机,否则画面会冻在最后那个眼位上
      if (post.renderPass.camera !== camera) post.renderPass.camera = camera;
      if (controls.enabled) controls.update(dt);
    }

    parts.sky.update(clockTime, pal);
    parts.glass.update(pal, clockTime, camera);
    parts.water.update(clockTime, pal);
    parts.fauna.update(clockTime, pal);
    parts.architecture.update(clockTime, pal);
    parts.immortals.update(clockTime);
    parts.atmos.update(clockTime, pal, camera, { pixelRatio: renderer.getPixelRatio() });
    post.update(clockTime, pal);

    parts.water.renderReflection(renderer, activeCamera());
    post.render(dt);
    window.__frames++;

    ui.setPhase(pal.label, timeOfDay, pal.hour);

    frames++;
    fpsAcc += rawDt;
    if (fpsAcc > 0.5) {
      fps = Math.round(frames / fpsAcc);
      frames = 0;
      fpsAcc = 0;
      if (params.has('debug')) {
        const info = renderer.info.render;
        // 整帧口径:含阴影 + 玻璃透射重渲 + 全部后期 pass,所以比 __worldStats 的场景值大
        const fpsTxt = fps >= 10 ? String(fps) : fps >= 1 ? fps.toFixed(1) : `<1`;
        ui.setStats(`${fpsTxt} fps · ${info.calls} calls/frame · ${(info.triangles / 1000).toFixed(0)}k tri`);
      }
    }

    if (!firstRendered) {
      firstRendered = true;
      window.__worldReady = true;
      ui.ready();
    }

    requestAnimationFrame(frame);
  }

  // ---------- 验收接口 ----------
  window.__worldStats = () => {
    renderer.info.autoReset = true;
    renderer.render(scene, camera);   // 只量场景本身(不含后期)
    const i = { ...renderer.info.render };
    renderer.info.autoReset = false;  // 还给主循环的整帧口径
    renderer.info.reset();
    return {
      calls: i.calls,
      triangles: i.triangles,
      programs: renderer.info.programs ? renderer.info.programs.length : -1,
      flora: parts.flora.counts,
      rej: parts.flora.rej,
      camera: { zoom: camera.zoom, pos: camera.position.toArray().map((v) => +v.toFixed(2)) },
      timeOfDay: +timeOfDay.toFixed(3),
      phase: pal.label,
    };
  };
  window.__world = { scene, camera, renderer, pal, parts, island, post, controls, setTime: (v) => { timeOfDay = v; paused = true; controls.autoRotate = false; } };

  if (panel) {
    const bind = (id, set) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { set(parseFloat(el.value)); syncPanel(); });
    };
    bind('pp-eye', (v) => { povEye = v; });
    bind('pp-dx', (v) => { povDx = v; });
    bind('pp-dz', (v) => { povDz = v; });
  }

  if (params.get('pov') === '1') { povIndex = 0; applyPov(); }

  if (params.has('debug')) ui.setStats('…');
  else ui.hideStats();

  // ?pick=1 —— 点画面任意位置,在 console 打出命中的对象名与世界坐标。
  // 遇到"某个位置有花纹但我在别的机器上复现不出"时,靠它把位置钉死,不用互相猜机位。
  if (params.has('pick')) {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown', (ev) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, activeCamera());
      // 玻璃罩与天穹会把一切挡住(它们是包围盒),必须排除,否则永远只命中 glass-glow
      const isUnder = (obj, root) => {
        let o = obj;
        while (o) { if (o === root) return true; o = o.parent; }
        return false;
      };
      const hits = ray.intersectObjects(scene.children, true)
        .filter((h) => h.object.visible)
        .filter((h) => h.object.isMesh)                 // 排除 dust/fireflies/星点(Points)
        .filter((h) => !isUnder(h.object, parts.glass.group) && !isUnder(h.object, parts.sky.group))
        .filter((h) => !isUnder(h.object, parts.atmos.group))   // 雾片/光柱也别挡
        .slice(0, 3);
      const fmt = (h) => {
        const n = h.face ? ` n=(${h.face.normal.x.toFixed(2)}, ${h.face.normal.y.toFixed(2)}, ${h.face.normal.z.toFixed(2)})` : '';
        return `${h.object.name || h.object.type} p=(${h.point.x.toFixed(2)}, ${h.point.y.toFixed(2)}, ${h.point.z.toFixed(2)})${n}`;
      };
      const msg = hits.length ? '[pick] ' + hits.map(fmt).join('  |  ') : '[pick] 没打到';
      console.log(msg);
      ui.setStats(msg);
    });
  }

  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  window.__worldError = String(err && err.stack ? err.stack : err);
  const veil = document.getElementById('veil');
  if (veil) {
    veil.innerHTML = `<div class="veil-inner"><div class="veil-title">初始化失败</div><div class="veil-sub">${String(err.message || err)}</div></div>`;
  }
  console.error(err);
}
