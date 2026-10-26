/**
 * 昼夜调色板:一个 0..1 的标量驱动一切(太阳方向/色温/曝光/泛光/星/雾/水色/萤火)。
 * 关键帧 + 环绕插值,避免"日出"和"午夜"之间跳色。
 */
import * as THREE from 'three';
import { smoothstep, clamp, lerp } from '../lib/noise.js';

const KF = [
  {
    t: 0.0, label: '黎明',
    sun: '#ffd9a0', sunI: 2.2, moonI: 0.0,
    hemiSky: '#5a7f8c', hemiGround: '#232a26', hemiI: 0.62,
    amb: '#a9c6cc', ambI: 0.44,
    skyTop: '#0a1a22', skyMid: '#12262c', skyLow: '#2c3a38', nebula: '#4f8f8a',
    star: 0.5, mist: 0.88, exposure: 1.16, bloom: 0.80,
    rim: '#ffe0b0', rimI: 1.20,
    wDeep: '#1d4a44', wShallow: '#5aa79a', wFoam: '#e6fff4',
    firefly: 0.30, glass: '#cfeae4', glassI: 0.85,
  },
  {
    t: 0.2, label: '上午',
    sun: '#fff4dc', sunI: 3.30, moonI: 0.0,
    hemiSky: '#8fc0c4', hemiGround: '#3e4a3a', hemiI: 0.94,
    amb: '#c6e2de', ambI: 0.60,
    skyTop: '#050f12', skyMid: '#0a181c', skyLow: '#132422', nebula: '#2f6a68',
    star: 0.07, mist: 0.55, exposure: 1.03, bloom: 0.44,
    rim: '#d8f2ea', rimI: 0.85,
    wDeep: '#17544c', wShallow: '#63b3a2', wFoam: '#f2fffb',
    firefly: 0.0, glass: '#d6f0ea', glassI: 0.70,
  },
  {
    t: 0.4, label: '正午',
    sun: '#ffffff', sunI: 3.85, moonI: 0.0,
    hemiSky: '#a8ccc8', hemiGround: '#4c5442', hemiI: 1.02,
    amb: '#dcece6', ambI: 0.66,
    skyTop: '#030a0c', skyMid: '#071114', skyLow: '#0d1a18', nebula: '#25544f',
    star: 0.0, mist: 0.40, exposure: 0.98, bloom: 0.36,
    rim: '#ffffff', rimI: 0.70,
    wDeep: '#155b52', wShallow: '#72c3ae', wFoam: '#ffffff',
    firefly: 0.0, glass: '#e4f7f1', glassI: 0.62,
  },
  {
    t: 0.57, label: '午后',
    sun: '#ffe8bc', sunI: 3.15, moonI: 0.0,
    hemiSky: '#9ec4bd', hemiGround: '#54503a', hemiI: 0.94,
    amb: '#d8d8b8', ambI: 0.62,
    skyTop: '#040c0e', skyMid: '#0a1113', skyLow: '#161a16', nebula: '#3d5b4a',
    star: 0.10, mist: 0.52, exposure: 1.06, bloom: 0.52,
    rim: '#ffe6b8', rimI: 1.20,
    wDeep: '#1a534a', wShallow: '#6fb8a4', wFoam: '#fdf7e6',
    firefly: 0.0, glass: '#dcf2e8', glassI: 0.75,
  },
  {
    t: 0.68, label: '黄昏',
    sun: '#ffc84e', sunI: 2.85, moonI: 0.1,
    hemiSky: '#ab8a5c', hemiGround: '#4e4020', hemiI: 0.90,
    amb: '#f7d08c', ambI: 0.66,
    skyTop: '#070d10', skyMid: '#181420', skyLow: '#3a2a18', nebula: '#9a6a4a',
    star: 0.32, mist: 0.62, exposure: 1.16, bloom: 0.88,
    rim: '#ffe09a', rimI: 1.85,
    wDeep: '#2f4a44', wShallow: '#93b8a0', wFoam: '#fff2cf',
    firefly: 0.30, glass: '#ffe6c4', glassI: 0.92,
  },
  {
    t: 0.79, label: '暮色',
    sun: '#ffab4a', sunI: 1.10, moonI: 0.30,
    hemiSky: '#6a6272', hemiGround: '#262a26', hemiI: 0.70,
    amb: '#b8a0a8', ambI: 0.48,
    skyTop: '#04080c', skyMid: '#0a1018', skyLow: '#1c1a22', nebula: '#6a4a5a',
    star: 0.68, mist: 0.80, exposure: 1.20, bloom: 0.98,
    rim: '#ffc98a', rimI: 1.30,
    wDeep: '#173f3c', wShallow: '#4a8a80', wFoam: '#e8e0d0',
    firefly: 0.75, glass: '#d8d0dc', glassI: 1.05,
  },
  {
    t: 0.92, label: '深夜',
    sun: '#9fc8d8', sunI: 0.12, moonI: 0.62,
    hemiSky: '#2a3d4c', hemiGround: '#141a18', hemiI: 0.44,
    amb: '#6a8a96', ambI: 0.38,
    skyTop: '#02060a', skyMid: '#050c10', skyLow: '#0a1418', nebula: '#2e4a52',
    star: 1.0, mist: 0.92, exposure: 1.24, bloom: 1.05,
    rim: '#a8d8e8', rimI: 0.85,
    wDeep: '#0d2f30', wShallow: '#2f6f6a', wFoam: '#cddde0',
    firefly: 1.0, glass: '#b4d0d8', glassI: 1.10,
  },
  {
    t: 1.0, label: '黎明',
    sun: '#ffd9a0', sunI: 2.2, moonI: 0.0,
    hemiSky: '#5a7f8c', hemiGround: '#232a26', hemiI: 0.62,
    amb: '#a9c6cc', ambI: 0.44,
    skyTop: '#0a1a22', skyMid: '#12262c', skyLow: '#2c3a38', nebula: '#4f8f8a',
    star: 0.5, mist: 0.88, exposure: 1.16, bloom: 0.80,
    rim: '#ffe0b0', rimI: 1.20,
    wDeep: '#1d4a44', wShallow: '#5aa79a', wFoam: '#e6fff4',
    firefly: 0.30, glass: '#cfeae4', glassI: 0.85,
  },
];

// 每帧对应的小时数(0..24,越过 24 = 次日)。时钟和"上午/正午/黄昏"标签都从这里来,
// 之前时钟走 (t+0.06)*24、标签走关键帧,两边打架 → 界面显示过"正午 08:38"。
const KF_HOUR = [6.0, 9.0, 12.5, 15.5, 18.0, 19.5, 22.5, 30.0];

const COLOR_KEYS = ['sun', 'hemiSky', 'hemiGround', 'amb', 'skyTop', 'skyMid', 'skyLow', 'nebula', 'rim', 'wDeep', 'wShallow', 'wFoam', 'glass'];
const NUM_KEYS = ['sunI', 'moonI', 'hemiI', 'ambI', 'star', 'mist', 'exposure', 'bloom', 'rimI', 'firefly', 'glassI'];

export function createPalette() {
  const P = {
    t: 0.28,
    label: '上午',
    sunDir: new THREE.Vector3(0.4, 0.8, 0.4).normalize(),
    moonDir: new THREE.Vector3(-0.4, -0.8, -0.4).normalize(),
    sunElev: 0.6,
    dayFactor: 1,
    nightFactor: 0,
    hour: 10,
  };
  for (const k of COLOR_KEYS) P[k] = new THREE.Color('#ffffff');
  for (const k of NUM_KEYS) P[k] = 0;

  const cA = new THREE.Color();
  const cB = new THREE.Color();

  P.apply = function apply(t) {
    P.t = ((t % 1) + 1) % 1;
    const tt = P.t;
    let i = 0;
    while (i < KF.length - 2 && KF[i + 1].t <= tt) i++;
    const a = KF[i];
    const b = KF[i + 1] || KF[KF.length - 1];
    const span = b.t - a.t || 1;
    const f = clamp((tt - a.t) / span, 0, 1);
    // 平滑(避免关键帧处速度突变)
    const e = f * f * (3 - 2 * f);

    for (const k of COLOR_KEYS) {
      cA.set(a[k]);
      cB.set(b[k]);
      P[k].copy(cA).lerp(cB, e);
    }
    for (const k of NUM_KEYS) P[k] = lerp(a[k], b[k], e);

    const hour = lerp(KF_HOUR[i], KF_HOUR[i + 1], f);
    P.hour = hour % 24;
    P.label = hour < 4.5 ? '深夜'
      : hour < 6.8 ? '黎明'
      : hour < 11.0 ? '上午'
      : hour < 13.6 ? '正午'
      : hour < 17.0 ? '午后'
      : hour < 18.6 ? '黄昏'
      : hour < 20.2 ? '暮色'
      : '深夜';

    // 太阳轨迹:方位角扫过背侧,高度角随昼夜起落
    const ang = tt * Math.PI * 2;
    const elev = Math.sin(ang) * 1.28;          // 弧度,-1.28 .. 1.28
    const az = 2.35 + tt * 2.6;
    const ce = Math.cos(Math.min(elev, 1.45));
    P.sunDir.set(Math.cos(az) * ce, Math.sin(elev), Math.sin(az) * ce).normalize();
    P.moonDir.copy(P.sunDir).multiplyScalar(-1);
    P.sunElev = Math.sin(elev);

    P.dayFactor = smoothstep(-0.16, 0.22, P.sunElev);
    P.nightFactor = 1 - P.dayFactor;
    return P;
  };

  P.apply(0.28);
  return P;
}
