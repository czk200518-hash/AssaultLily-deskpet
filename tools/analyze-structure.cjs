// 分析槽位/附件结构:默认附件、皮肤附件、动画附件时间轴引用
const { loadSkeleton } = require('./load-skeleton.cjs');

async function run() {
  const { data, spine } = await loadSkeleton({ runtime: 'core', imageLoader: async () => ({ width: 1024, height: 1024 }) });

  // 1. 槽位清单
  console.log('=== 54 个槽位:默认附件 ===');
  for (const s of data.slots) {
    console.log(`  slot[${s.index}] ${s.name} (bone:${s.boneData.name}) default=${s.attachmentName || '(无)'} blend=${s.blendMode}`);
  }

  // 2. 默认皮肤里每个槽位挂了哪些附件
  console.log('\n=== 默认皮肤附件(按槽位) ===');
  const skin = data.defaultSkin;
  skin.attachments.forEach((dict, slotIndex) => {
    const names = Object.keys(dict);
    console.log(`  slot[${slotIndex}] ${data.slots[slotIndex].name}: ${names.join(', ')}`);
  });

  // 3. WaitDefault 的附件时间轴(切换哪些附件)
  console.log('\n=== WaitDefault 附件时间轴 ===');
  const wd = data.findAnimation('WaitDefault');
  for (const tl of wd.timelines) {
    if (tl.constructor.name === 'AttachmentTimeline') {
      const names = [...new Set(tl.attachmentNames)];
      console.log(`  slot[${tl.slotIndex}] ${data.slots[tl.slotIndex].name}: ${names.join(', ')}`);
    }
  }

  // 4. 各动画引用过的所有附件名(按槽位汇总)
  console.log('\n=== 所有动画用到的附件名(按槽位) ===');
  const usedBySlot = new Map();
  for (const anim of data.animations) {
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'AttachmentTimeline') {
        if (!usedBySlot.has(tl.slotIndex)) usedBySlot.set(tl.slotIndex, new Set());
        for (const n of tl.attachmentNames) usedBySlot.get(tl.slotIndex).add(n);
      }
    }
  }
  for (const [slotIndex, names] of usedBySlot) {
    console.log(`  slot[${slotIndex}] ${data.slots[slotIndex].name}: ${[...names].join(', ')}`);
  }

  // 5. DrawOrder 时间轴
  console.log('\n=== 含 DrawOrder 时间轴的动画 ===');
  let doCount = 0;
  for (const anim of data.animations) {
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'DrawOrderTimeline') {
        doCount++;
        console.log(`  ${anim.name} 帧数=${tl.frames.length}`);
      }
    }
  }
  if (!doCount) console.log('  无');

  // 6. IK 约束
  console.log('\n=== IK 约束 ===');
  for (const c of data.ikConstraints) {
    console.log(`  ${c.name}: bones=[${c.bones.map((b) => b.name).join(',')}] target=${c.target.name} mix=${c.mix} bend=${c.bendDirection}`);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
