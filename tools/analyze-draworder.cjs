// 检查 DrawOrder 时间轴与 01/02/03 变体使用分布
const { loadSkeleton } = require('./load-skeleton.cjs');

async function run() {
  const { data, spine } = await loadSkeleton({ runtime: 'core', imageLoader: async () => ({ width: 1024, height: 1024 }) });

  // 1. 所有含 DrawOrder 时间轴的动画及其顺序变化
  console.log('=== DrawOrder 时间轴动画 ===');
  let total = 0;
  for (const anim of data.animations) {
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'DrawOrderTimeline') {
        total++;
        console.log(`  ${anim.name} 帧数=${tl.frames.length}`);
      }
    }
  }
  console.log('总数:', total);

  // 2. 每个动画使用的身体变体(01/02/03)
  console.log('\n=== 变体使用分布(每动画) ===');
  const variantAnim = new Map(); // variant -> anims
  for (const anim of data.animations) {
    const variants = new Set();
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'AttachmentTimeline') {
        for (const n of tl.attachmentNames) {
          if (!n) continue;
          const m = n.match(/^(0*[0-9]+)(Face|Body|Hip|Hair|Head|Leg|Arm)/);
          if (m) variants.add(n.replace(/[0-9].*$/, ''));
        }
      }
    }
    const key = [...variants].sort().join('+') || '(无)';
    if (!variantAnim.has(key)) variantAnim.set(key, []);
    variantAnim.get(key).push(anim.name);
  }
  for (const [k, v] of variantAnim) {
    console.log(`  ${k}: ${v.length} 个动画`);
    if (v.length <= 8) console.log(`     ${v.join(', ')}`);
  }

  // 3. 检查 WaitDefault 是否切换 02 变体(对照)
  const wd = data.findAnimation('WaitDefault');
  const wdV = new Set();
  for (const tl of wd.timelines) {
    if (tl.constructor.name === 'AttachmentTimeline') {
      for (const n of tl.attachmentNames) {
        if (n && /^0*[0-9]/.test(n)) wdV.add(n);
      }
    }
  }
  console.log('\nWaitDefault 引用变体附件:', [...wdV].join(', ') || '(无)');

  // 4. 具体看一个攻击动画的 drawOrder 内容
  console.log('\n=== AttackAx01 DrawOrder 帧内容 ===');
  const ax = data.findAnimation('AttackAx01');
  for (const tl of ax.timelines) {
    if (tl.constructor.name === 'DrawOrderTimeline') {
      for (let i = 0; i < tl.frames.length; i++) {
        const order = tl.drawOrders[i];
        const names = order.map((idx) => data.slots[idx].name);
        console.log(`  帧${i} t=${tl.frames[i]}: [${names.join(', ')}]`);
      }
    }
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
