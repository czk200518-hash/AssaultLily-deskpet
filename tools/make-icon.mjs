// 从角色图标 PNG 生成标准多尺寸 icon.ico(打包用)
// 用法: node tools/make-icon.mjs
// 输出: build/icon.ico(16/32/48/256)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'renderer', 'assets', 'CharacterJobIconM0001001.png');
const out = path.join(__dirname, '..', 'build', 'icon.ico');

const ico = await pngToIco(src);
fs.writeFileSync(out, ico);
console.log('icon.ico written:', out, ico.length, 'bytes');
