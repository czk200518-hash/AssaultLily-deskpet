// 检查 .skel 是否可被 spine 运行时加载,并列出动画/皮肤/骨骼信息
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'renderer', 'assets');
const skelPath = join(assets, 'CharacterJobSpine_01.skel');
const atlasPath = join(assets, 'CharacterJobSpine_01_0001_001.atlas');

let spine;
try {
  spine = (await import('@esotericsoftware/spine-player')).spine;
  console.log('spine runtime version:', spine.SkeletonBinary.version ?? '(n/a)');
} catch (e) {
  console.error('导入 spine-player 失败:', e.message);
  process.exit(1);
}

const atlasText = readFileSync(atlasPath, 'utf8');
const atlas = new spine.TextureAtlas(atlasText, (page) => {
  // 仅解析用:不加载真实纹理
  page.texture = { getImage() { return null; } };
});

const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary(atlasLoader);

let data;
try {
  data = binary.readSkeletonData(new Uint8Array(readFileSync(skelPath)));
} catch (e) {
  console.error('读取骨骼失败:', e.message);
  process.exit(2);
}

console.log('动画列表:', data.animations.map((a) => a.name).join(', ') || '(无)');
console.log('皮肤列表:', data.skins.map((s) => s.name).join(', ') || '(无)');
console.log('骨骼数:', data.bones.length, ' 槽位数:', data.slots.length, ' 附件数:', data.skins.reduce((n, s) => n + s.attachments.size, 0));
console.log('默认皮肤:', data.defaultSkin?.name ?? '(无)');

// 估算模型尺寸(用于窗口大小)
const skeleton = new spine.Skeleton(data);
skeleton.setToSetupPose();
let bounds;
try {
  bounds = skeleton.getBounds();
  console.log('setup 包围盒: offset(%s,%s) size(%s,%s)',
    bounds.offset.x.toFixed(1), bounds.offset.y.toFixed(1),
    bounds.size.x.toFixed(1), bounds.size.y.toFixed(1));
} catch (e) {
  console.log('包围盒计算失败:', e.message);
}

// 每个动画的时长
for (const a of data.animations) {
  console.log(`  动画 ${a.name}: ${a.duration.toFixed(2)}s`);
}
