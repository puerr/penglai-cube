/**
 * 打包:src/main.js → IIFE → 内联进 index.html(单文件、零外部资源、file:// 双击可开)。
 *
 * 为什么内联而不是 <script type="module">:
 *   file:// 下 module 加载外部脚本会被 CORS 拦掉,双击打不开。
 *   KB 里 lessons/… 与 项目档案/3d夏日池塘 都记过这条。
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes('--dev');

const result = await esbuild.build({
  entryPoints: [path.join(HERE, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome100', 'safari15', 'firefox100'],
  minify: !dev,
  write: false,
  legalComments: 'none',
  alias: { three: path.join(HERE, 'vendor/three/three.module.js') },
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync(path.join(HERE, 'src/index.template.html'), 'utf8');
const html = tpl.replace('<!--WORLD_JS-->', () => `<script>\n${js}\n</script>`);
fs.writeFileSync(path.join(HERE, 'index.html'), html);

console.log(`[build] index.html  ${(html.length / 1024).toFixed(0)} KB${dev ? '  (dev)' : ''}`);
