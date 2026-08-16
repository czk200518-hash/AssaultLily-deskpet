// 一次性测量脚本:加载 assets-v1 模型并播放待机动画 01BaseLoop,
// 按附件世界顶点计算包围盒(与 app 运行时 computeRenderBounds 同思路)
// 仅开发用,不随桌宠发布
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

// 与 tools/load-skeleton.cjs 相同的 spine36 core 运行时加载方式
const file = 'spine-core.js';
vm.runInThisContext(readFileSync(path.join(root, 'vendor', 'spine36', file), 'utf8'), { filename: file });
vm.runInThisContext(readFileSync(path.join(root, 'vendor', 'spine36', 'skel36-binary.js'), 'utf8'), { filename: 'skel36-binary.js' });

const assets = path.join(root, 'renderer', 'assets-v1');
const skelPath = path.join(assets, 'CharacterJobSpine010001001.skel');
const atlasPath = path.join(assets, 'CharacterJobSpine010001001.atlas');
const atlasText = readFileSync(atlasPath, 'utf8');

const atlas = new spine.TextureAtlas(atlasText, (pageName) => {
  const holder = { image: { width: 2048, height: 2048 }, setFilters() {}, setWraps() {}, getImage() { return holder.image; } };
  return holder;
});
const loader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary36(loader);
const data = binary.readSkeletonData(new Uint8Array(readFileSync(skelPath)));

// 占位附件消毒(与 load-skeleton.cjs 一致)
for (const skin of data.skins) {
  skin.attachments.forEach((dict) => {
    for (const name in dict) {
      const a = dict[name];
      if (!a || !a.region) continue;
      const r = a.region;
      if (!r.width || !r.height) dict[name] = new spine.BoundingBoxAttachment(name);
    }
  });
}

const skeleton = new spine.Skeleton(data);
const state = new spine.AnimationState(new spine.AnimationStateData(data));
state.setAnimation(0, '01BaseLoop', true);
state.update(0.05);
state.apply(skeleton);
skeleton.updateWorldTransform();

let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
const verts = new Float32Array(16);
for (const slot of skeleton.drawOrder) {
  const att = slot.attachment;
  if (!att) continue;
  try {
    if (att instanceof spine.RegionAttachment) {
      att.computeWorldVertices(slot.bone, verts, 0, 2);
      for (let i = 0; i < 8; i += 2) {
        if (verts[i] < minX) minX = verts[i];
        if (verts[i] > maxX) maxX = verts[i];
        if (verts[i + 1] < minY) minY = verts[i + 1];
        if (verts[i + 1] > maxY) maxY = verts[i + 1];
      }
    } else if (att instanceof spine.MeshAttachment) {
      const n = att.worldVerticesLength;
      if (!n) continue;
      const wv = new Float32Array(n);
      att.computeWorldVertices(slot, 0, n, wv, 0, 2);
      for (let i = 0; i < n; i += 2) {
        if (wv[i] < minX) minX = wv[i];
        if (wv[i] > maxX) maxX = wv[i];
        if (wv[i + 1] < minY) minY = wv[i + 1];
        if (wv[i + 1] > maxY) maxY = wv[i + 1];
      }
    }
  } catch (e) { /* 跳过异常附件 */ }
}

console.log('01BaseLoop 待机姿势包围盒(骨架单位):');
console.log('  x[' + minX.toFixed(1) + ', ' + maxX.toFixed(1) + '] y[' + minY.toFixed(1) + ', ' + maxY.toFixed(1) + ']');
console.log('  宽=' + (maxX - minX).toFixed(1) + ' 高=' + (maxY - minY).toFixed(1));
console.log('相对画布 1400x2400: 宽=' + ((maxX - minX) / 1400 * 100).toFixed(1) + '% 高=' + ((maxY - minY) / 2400 * 100).toFixed(1) + '%');
// 参考:fit 日志实测 scale=0.215 时窗口 303px 宽 → charScale=0.215, 模型像素宽=(maxX-minX)*0.215
console.log('scale=0.215 时像素宽=' + ((maxX - minX) * 0.215).toFixed(0) + 'px (画布 301px)');

// 脚部区域 x 范围:取模型底部 12% 高度内的附件顶点(y 向下为正向)
const footTop = maxY - (maxY - minY) * 0.12;
let fMinX = 1e9, fMaxX = -1e9;
for (const slot of skeleton.drawOrder) {
  const att = slot.attachment;
  if (!att) continue;
  try {
    let pts = null;
    if (att instanceof spine.RegionAttachment) {
      const v = new Float32Array(8);
      att.computeWorldVertices(slot.bone, v, 0, 2);
      pts = v;
    } else if (att instanceof spine.MeshAttachment) {
      const n = att.worldVerticesLength;
      if (!n) continue;
      pts = new Float32Array(n);
      att.computeWorldVertices(slot, 0, n, pts, 0, 2);
    }
    if (!pts) continue;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i + 1] >= footTop) {
        if (pts[i] < fMinX) fMinX = pts[i];
        if (pts[i] > fMaxX) fMaxX = pts[i];
      }
    }
  } catch (e) { /* 忽略 */ }
}
console.log('脚部区域(底部 12%)x 范围: [' + (fMinX === 1e9 ? '?' : fMinX.toFixed(1)) + ', ' + (fMaxX === -1e9 ? '?' : fMaxX.toFixed(1)) + ']');
if (fMinX !== 1e9) {
  console.log('  脚部宽=' + (fMaxX - fMinX).toFixed(1) + ' 单位; 左缘距画布左缘=' + (fMinX + 700).toFixed(1) + ' 单位 (画布中心 x=0)');
  console.log('  scale=0.215: 脚部像素宽=' + ((fMaxX - fMinX) * 0.215).toFixed(0) + 'px, 左缘距画布左缘=' + ((fMinX + 700) * 0.215).toFixed(0) + 'px');
}
