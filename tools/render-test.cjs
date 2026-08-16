// 离线渲染测试:用 spine-canvas 3.6 + @napi-rs/canvas 渲染动画帧为 PNG,并做全动画冒烟测试
const { createCanvas, Image } = require('@napi-rs/canvas');
const { loadSkeleton, root } = require('./load-skeleton.cjs');
const path = require('node:path');
const fs = require('node:fs');

const args = process.argv.slice(2);
const ALL_MODE = args.includes('--all');
const targets = ALL_MODE ? [] : (args.length ? args : ['WaitDefault', 'MoveFront', 'AttackSword01', 'Victory01', 'MoveJump', 'RestLoop']);

function makeImageLoader() {
  const cache = new Map();
  return async (pageName) => {
    if (!cache.has(pageName)) {
      const img = new Image();
      img.src = fs.readFileSync(path.join(root, 'renderer', 'assets', pageName));
      await img.decode();
      cache.set(pageName, img);
    }
    return cache.get(pageName);
  };
}

async function main() {
  const { data, spine } = await loadSkeleton({
    runtime: 'canvas',
    imageLoader: makeImageLoader(),
  });

  console.log('动画:', data.animations.length, ' 骨骼:', data.bones.length);

  const skeleton = new spine.Skeleton(data);
  const stateData = new spine.AnimationStateData(data);
  stateData.defaultMix = 0.15;
  const state = new spine.AnimationState(stateData);

  // 记录 TR 骨骼(setup 位姿)用于位移抵消
  const trBone = skeleton.findBone('TR') || skeleton.findBone('Move');
  if (!trBone) throw new Error('找不到根骨骼 TR/Move');
  skeleton.setToSetupPose();
  skeleton.updateWorldTransform();
  const setupTrX = trBone.worldX, setupTrY = trBone.worldY;

  const offset = new spine.Vector2(), size = new spine.Vector2(), temp = [];
  skeleton.getBounds(offset, size, temp);
  console.log('setup 包围盒: offset(%s,%s) size(%s,%s)', offset.x.toFixed(1), offset.y.toFixed(1), size.x.toFixed(1), size.y.toFixed(1));

  const W = 1100, H = 1300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const renderer = new spine.canvas.SkeletonRenderer(ctx);
  renderer.triangleRendering = true;

  const maxDim = Math.max(size.x, size.y) || 2000;
  const scale = Math.min(W / maxDim, H / maxDim) * 0.92;
  skeleton.getRootBone().scaleX = scale;
  skeleton.getRootBone().scaleY = scale;
  const baseX = W / 2 - (offset.x + size.x / 2) * scale;
  const baseY = H - (offset.y + size.y) * scale - 10;
  skeleton.x = baseX;
  skeleton.y = baseY;

  function step(dt) {
    state.update(dt);
    state.apply(skeleton);
    // 3.6 的 apply 不重置骨骼,须绝对值赋值
    const rb = skeleton.getRootBone();
    rb.scaleX = scale;
    rb.scaleY = scale;
    skeleton.updateWorldTransform();
    // 增量抵消 TR 位移(收敛),让角色保持在画布中央
    skeleton.x += (baseX + setupTrX * scale) - trBone.worldX;
    skeleton.y += (baseY + setupTrY * scale) - trBone.worldY;
    skeleton.updateWorldTransform();
  }

  function renderFrame(animName, time, outName) {
    skeleton.setToSetupPose();
    skeleton.x = baseX; skeleton.y = baseY;
    state.setAnimation(0, animName, true);
    const dt = 1 / 60;
    for (let t = 0; t < time; t += dt) step(Math.min(dt, time - t));
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,160,220,0.25)';
    ctx.fillRect(0, 0, W, H);
    try {
      renderer.draw(skeleton);
    } catch (e) {
      console.error(`渲染 ${animName} 失败:`, e.message);
      return;
    }
    const out = path.join(root, 'render-test', outName);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, canvas.toBuffer('image/png'));
    console.log('已保存:', out);
  }

  if (ALL_MODE) {
    // 冒烟测试:每个动画跑 2 秒,统计失败
    const failures = [];
    for (const anim of data.animations) {
      try {
        skeleton.setToSetupPose();
        skeleton.x = 0; skeleton.y = 0;
        state.setAnimation(0, anim.name, true);
        let t = 0;
        while (t < 2) {
          step(Math.min(1 / 60, 2 - t));
          t += 1 / 60;
        }
      } catch (e) {
        failures.push(`${anim.name}: ${e.message}`);
      }
    }
    console.log(failures.length === 0 ? '冒烟测试: 全部 364 个动画通过 ✓' : `冒烟测试失败 ${failures.length} 个:`);
    for (const f of failures) console.log('  ' + f);
    return;
  }

  for (const name of targets) {
    const anim = data.findAnimation(name);
    if (!anim) { console.error('没有动画:', name); continue; }
    renderFrame(name, anim.duration * 0.5, `${name}.png`);
  }

  console.log('渲染测试完成');
}

main().catch((e) => { console.error(e); process.exit(1); });
