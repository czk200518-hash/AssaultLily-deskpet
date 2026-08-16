// 逐步解析头部与骨骼段,定位错位
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
for (const f of ['vendor/spine36/spine-core.js', 'vendor/spine36/skel36-binary.js']) {
  vm.runInThisContext(readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const S = globalThis.spine;

const bytes = new Uint8Array(readFileSync(path.join(root, 'renderer/assets/CharacterJobSpine_01.skel')));
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
let p = 0;
function vint() {
  let b = bytes[p++], r = b & 0x7f;
  while (b & 0x80) {
    b = bytes[p++]; r |= (b & 0x7f) << 7;
    if (!(b & 0x80)) break;
    b = bytes[p++]; r |= (b & 0x7f) << 14;
    if (!(b & 0x80)) break;
    b = bytes[p++]; r |= (b & 0x7f) << 21;
    if (!(b & 0x80)) break;
    b = bytes[p++]; r |= (b & 0x7f) << 28;
  }
  return r;
}
function rstr() {
  const n = vint();
  if (n === 0) return null;
  if (n === 1) return '';
  const s = new TextDecoder().decode(bytes.subarray(p, p + n - 1));
  p += n - 1;
  return s;
}
function rf() { const v = view.getFloat32(p, false); p += 4; return v; }
function rb() { return bytes[p++]; }

console.log('hash:', rstr());
console.log('version:', rstr());
console.log('width:', rf(), 'height:', rf());
console.log('nonessential:', rb(), ' pos:', p);
const boneCount = vint();
console.log('boneCount:', boneCount, ' at pos', p);
for (let i = 0; i < Math.min(10, boneCount); i++) {
  const nm = rstr();
  const parent = i === 0 ? '(none)' : vint();
  const rot = rf(), x = rf(), y = rf(), sx = rf(), sy = rf(), shx = rf(), shy = rf(), len = rf(), tm = vint();
  console.log(i, JSON.stringify(nm), 'parent=' + parent, 'rot=' + rot.toFixed(2), 'x=' + x.toFixed(2), 'y=' + y.toFixed(2),
    'sx=' + sx.toFixed(2), 'sy=' + sy.toFixed(2), 'len=' + len.toFixed(2), 'tm=' + tm, 'pos=' + p);
}
