/**
 * 运行时用 canvas 生成所有贴图 —— 零外部资源。
 * 颜色贴图进 sRGB;alpha/遮罩贴图保持线性(NoColorSpace),否则会被二次解码。
 */
import * as THREE from 'three';
import { makeNoise2D, fbm, sn, smoothstep } from './noise.js';

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d') };
}

/** 径向柔光点(星、萤火、光晕) */
export function glowTexture(size = 128, inner = 0.0, mid = 0.42) {
  const { c, ctx } = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(mid, 'rgba(255,255,255,0.38)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.09)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 软的噪声雾团:径向衰减 × 多频噪声,一朵一朵的 */
export function puffTexture(size = 256, seed = 11, power = 1.0, noiseAmt = 0.9, noiseFreq = 1.0) {
  const n = makeNoise2D(seed);
  const { c, ctx } = canvas2d(size, size);
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (i - half) / half;
      const dy = (j - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const fall = Math.pow(Math.max(0, 1 - r), 1.35) * power;
      const f = sn(fbm(n, i * 0.021 * noiseFreq, j * 0.021 * noiseFreq, 4)) * 0.72
              + sn(fbm(n, i * 0.058 * noiseFreq, j * 0.058 * noiseFreq, 3)) * 0.28;
      const a = Math.pow(Math.max(0, fall * (1.0 - noiseAmt + noiseAmt * 1.45 * f)), 1.2);
      const k = (j * size + i) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 一条竖直的柔光带(体积光柱 / 瀑布雾) */
export function shaftTexture(w = 64, h = 256) {
  const { c, ctx } = canvas2d(w, h);
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = i / (w - 1);
      const v = j / (h - 1);
      const across = Math.pow(Math.sin(Math.PI * u), 2.6);
      const along = smoothstep(1.0, 0.06, v) * smoothstep(0.0, 0.14, v) * 0.6 + smoothstep(1.0, 0.0, v) * 0.4;
      const k = (j * w + i) * 4;
      img.data[k] = 255;
      img.data[k + 1] = 255;
      img.data[k + 2] = 255;
      img.data[k + 3] = Math.max(0, Math.min(255, across * along * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/**
 * 等距柱状环境图 → PMREM:给玻璃和黏土材质一层"影棚"反射。
 * 这是"玻璃边缘折射微光"和黏土细腻高光的来源,不能省。
 */
export function envEquirectTexture(w = 512, h = 256) {
  const { c, ctx } = canvas2d(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0.0, '#1a2440');
  g.addColorStop(0.34, '#0d1424');
  g.addColorStop(0.52, '#070a12');
  g.addColorStop(1.0, '#020306');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 主光软箱(偏上、偏暖)
  const blobs = [
    [w * 0.24, h * 0.24, w * 0.16, 'rgba(255,236,205,0.95)'],
    [w * 0.30, h * 0.30, w * 0.24, 'rgba(255,214,160,0.45)'],
    [w * 0.68, h * 0.20, w * 0.13, 'rgba(190,222,255,0.85)'],
    [w * 0.63, h * 0.26, w * 0.26, 'rgba(120,170,255,0.30)'],
    [w * 0.88, h * 0.46, w * 0.20, 'rgba(255,170,210,0.16)'],
    [w * 0.06, h * 0.52, w * 0.18, 'rgba(120,255,232,0.14)'],
  ];
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y, r, col] of blobs) {
    for (const ox of [-w, 0, w]) {
      const rg = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x + ox, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
