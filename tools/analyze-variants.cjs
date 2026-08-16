// 检查每个动画的 01/02/03 变体使用是否一致
const { loadSkeleton } = require('./load-skeleton.cjs');

async function run() {
  const { data, spine } = await loadSkeleton({ runtime: 'core', imageLoader: async () => ({ width: 1024, height: 1024 }) });

  // 变体槽位:名字含 01/02/03 前缀的槽位
  const variantSlots = [];
  for (const s of data.slots) {
    if (/^0*[0-9]/.test(s.name)) variantSlots.push(s.index);
  }
  console.log('变体槽位:', variantSlots.map((i) => data.slots[i].name).join(', '));

  const mixed = [];
  for (const anim of data.animations) {
    // 统计该动画每个变体槽位最终使用的附件前缀
    const used = new Map(); // slotIndex -> set of prefixes
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'AttachmentTimeline') {
        for (const n of tl.attachmentNames) {
          if (!n) continue;
          const m = n.match(/^(0*[0-9]+)/);
          if (m && variantSlots.includes(tl.slotIndex)) {
            if (!used.has(tl.slotIndex)) used.set(tl.slotIndex, new Set());
            used.get(tl.slotIndex).add(m[1]);
          }
        }
      }
    }
    // 前缀不唯一 => 该动画内切换变体
    const switches = [];
    for (const [si, prefixes] of used) {
      if (prefixes.size > 1) switches.push(`${data.slots[si].name}:${[...prefixes].join('/')}`);
    }
    if (switches.length) mixed.push(`${anim.name} [${switches.join(', ')}]`);
  }
  console.log(`\n动画内切换变体的动画数: ${mixed.length}`);
  for (const line of mixed.slice(0, 40)) console.log('  ' + line);

  // 02 变体使用统计
  const v02 = new Map();
  for (const anim of data.animations) {
    for (const tl of anim.timelines) {
      if (tl.constructor.name === 'AttachmentTimeline') {
        for (const n of tl.attachmentNames) {
          if (n && /^02/.test(n)) {
            if (!v02.has(anim.name)) v02.set(anim.name, []);
            v02.get(anim.name).push(n);
          }
        }
      }
    }
  }
  console.log(`\n使用 02 变体的动画数: ${v02.size}`);
  for (const [anim, names] of v02) {
    console.log(`  ${anim}: ${[...new Set(names)].join(', ')}`);
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
