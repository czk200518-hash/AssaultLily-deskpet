// 共享骨骼加载器:解析 atlas + 用移植版二进制解析器加载 .skel,并消毒占位附件
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');

// runtime: 'core'(spine-core.js) | 'canvas'(spine-canvas.js 独立包) | 'webgl'(spine-webgl.js 独立包)
function loadRuntime(runtime) {
  const file = runtime === 'canvas' ? 'spine-canvas.js' : runtime === 'webgl' ? 'spine-webgl.js' : 'spine-core.js';
  const src = readFileSync(path.join(root, 'vendor', 'spine36', file), 'utf8');
  vm.runInThisContext(src, { filename: file });
  vm.runInThisContext(readFileSync(path.join(root, 'vendor', 'spine36', 'skel36-binary.js'), 'utf8'), { filename: 'skel36-binary.js' });
  return globalThis.spine;
}

// 加载骨架数据
// options.imageLoader: (pageName) => 图像对象(需有 width/height 属性, 供 drawImage 使用); 可为 async
// options.runtime: 'core' | 'canvas' | 'webgl'
async function loadSkeleton(options) {
  const spine = loadRuntime(options.runtime || 'core');
  const assets = path.join(root, 'renderer', 'assets');
  const skelPath = path.join(assets, 'CharacterJobSpine_01.skel');
  const atlasPath = path.join(assets, 'CharacterJobSpine_01_0001_001.atlas');

  const atlasText = readFileSync(atlasPath, 'utf8');
  const textures = new Map(); // pageName -> { getImage }
  const atlas = new spine.TextureAtlas(atlasText, (pageName) => {
    const holder = { image: null, setFilters() {}, setWraps() {}, getImage() { return holder.image || { width: 1024, height: 1024 }; } };
    textures.set(pageName, holder);
    return holder;
  });

  // 异步加载真实图像后回填
  for (const [pageName, holder] of textures) {
    holder.image = await options.imageLoader(pageName);
  }

  const loader = new spine.AtlasAttachmentLoader(atlas);
  const binary = new spine.SkeletonBinary36(loader);
  const data = binary.readSkeletonData(new Uint8Array(readFileSync(skelPath)));

  sanitizePlaceholderAttachments(data);
  return { data, atlas, spine };
}

// 图集中 size 为 0 的占位区域(游戏运行时会按角色换图集),替换为不可见的包围盒附件
// 注意:不能只把 region 置零 —— mesh 的几何由骨骼顶点驱动,零 UV 会采样 (0,0) 像素渲染成实心色块
function sanitizePlaceholderAttachments(data) {
  for (const skin of data.skins) {
    skin.attachments.forEach((dict) => {
      for (const name in dict) {
        const a = dict[name];
        if (!a || !a.region) continue;
        const r = a.region;
        if (!r.width || !r.height) {
          // 用同名包围盒附件替换:渲染器不绘制、动画引用不报错、getBounds 忽略
          dict[name] = new spine.BoundingBoxAttachment(name);
        }
      }
    });
  }
}

module.exports = { loadSkeleton, loadRuntime, sanitizePlaceholderAttachments, root };
