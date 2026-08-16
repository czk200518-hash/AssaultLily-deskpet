// 用移植的 3.6 二进制解析器检查骨骼:加载、动画、皮肤、尺寸、附件有效性
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
for (const f of ['vendor/spine36/spine-core.js', 'vendor/spine36/skel36-binary.js']) {
  vm.runInThisContext(readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const spine = globalThis.spine;

const assets = path.join(root, 'renderer', 'assets');
const skelPath = path.join(assets, 'CharacterJobSpine_01.skel');
const atlasPath = path.join(assets, 'CharacterJobSpine_01_0001_001.atlas');

const atlasText = readFileSync(atlasPath, 'utf8');
const atlas = new spine.TextureAtlas(atlasText, (pageName) => {
  return { // 仅解析用假纹理
    setFilters() {}, setWraps() {},
    getImage() { return { width: 1024, height: 1024 }; },
  };
});
const atlasLoader = new spine.AtlasAttachmentLoader(atlas);
const binary = new spine.SkeletonBinary36(atlasLoader);

let data;
try {
  data = binary.readSkeletonData(new Uint8Array(readFileSync(skelPath)));
} catch (e) {
  console.error('读取骨骼失败:', e.message);
  process.exit(2);
}

console.log('文件版本:', data.version);
console.log('画布: %s x %s', data.width.toFixed(1), data.height.toFixed(1));
console.log('动画列表(%d):', data.animations.length);
for (const a of data.animations) console.log(`  ${a.name}  ${a.duration.toFixed(2)}s`);
console.log('皮肤列表(%d):', data.skins.length);
for (const s of data.skins) console.log(`  ${s.name}(${s.attachments.size}槽)`);
console.log('骨骼数:', data.bones.length, ' 槽位数:', data.slots.length, ' 事件数:', data.events.length);
console.log('IK约束:', data.ikConstraints.length, ' 变换约束:', data.transformConstraints.length, ' 路径约束:', data.pathConstraints.length);
console.log('默认皮肤:', (data.defaultSkin && data.defaultSkin.name) || '(无)');

// 附件有效性:所有附件必须能在图集中找到贴图区域
let missing = 0;
let attachmentCount = 0;
for (const skin of data.skins) {
  skin.attachments.forEach((dict, slotIndex) => {
    for (const name in dict) {
      const attachment = dict[name];
      attachmentCount++;
      if (attachment.constructor === spine.RegionAttachment || attachment.constructor === spine.MeshAttachment) {
        const path_ = attachment.path || name;
        if (!atlas.findRegion(path_)) {
          missing++;
          if (missing <= 10) console.error(`  附件缺少贴图: skin=${skin.name} slot=${slotIndex} name=${name} path=${path_}`);
        }
      }
    }
  });
}
console.log(`附件总数: ${attachmentCount}`);
console.log(missing === 0 ? '附件贴图校验: 全部通过 ✓' : `附件贴图校验: ${missing} 个缺失!`);

// 估算尺寸
const skeleton = new spine.Skeleton(data);
skeleton.setToSetupPose();
const offset = new spine.Vector2(), size = new spine.Vector2();
skeleton.getBounds(offset, size, []);
console.log('setup 包围盒: offset(%s,%s) size(%s,%s)',
  offset.x.toFixed(1), offset.y.toFixed(1),
  size.x.toFixed(1), size.y.toFixed(1));
