// 干净对比:scale 1 vs 0.18 的 getBounds 与手动顶点扫描
const { loadSkeleton } = require('./load-skeleton.cjs');

async function run() {
  const { data, spine } = await loadSkeleton({ runtime: 'core', imageLoader: async () => ({ width: 1024, height: 1024 }) });
  const stateData = new spine.AnimationStateData(data);
  stateData.defaultMix = 0.15;

  for (const s of [1, 0.1807]) {
    const skeleton = new spine.Skeleton(data);
    const state = new spine.AnimationState(stateData);
    state.setAnimation(0, 'WaitDefault', true);
    for (let i = 0; i < 2; i++) {
      state.update(1 / 60);
      state.apply(skeleton);
      if (s !== 1) {
        skeleton.getRootBone().scaleX = s;
        skeleton.getRootBone().scaleY = s;
      }
      skeleton.updateWorldTransform();
    }
    const off = new spine.Vector2(), sz = new spine.Vector2(), tmp = [];
    skeleton.getBounds(off, sz, tmp);
    // 手动扫描
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, bad = 0;
    let firstNan = null;
    for (const slot of skeleton.drawOrder) {
      const a = slot.getAttachment();
      if (!a) continue;
      try {
        if (a instanceof spine.RegionAttachment) {
          const v = new Array(8);
          a.computeWorldVertices(slot.bone, v, 0);
          if (v.some(Number.isNaN) && !firstNan) firstNan = 'region ' + slot.data.name + '/' + a.name + ' bone=' + slot.bone.data.name + ' wx=' + slot.bone.worldX + ' wy=' + slot.bone.worldY + ' a=' + slot.bone.a + ' d=' + slot.bone.d;
          for (let i = 0; i < 8; i += 2) {
            minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
            minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
          }
        } else if (a instanceof spine.MeshAttachment) {
          const v = new Array(a.worldVerticesLength);
          a.computeWorldVertices(slot, 0, a.worldVerticesLength, v, 0, 2);
          if (v.some(Number.isNaN) && !firstNan) firstNan = 'mesh ' + slot.data.name + '/' + a.name + ' bone=' + slot.bone.data.name + ' wx=' + slot.bone.worldX + ' wy=' + slot.bone.worldY;
          for (let i = 0; i < v.length; i += 2) {
            minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
            minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
          }
        }
      } catch (e) { bad++; console.log('ERR', slot.data.name, a.name, e.message); }
    }
    console.log('scale', s,
      ' getBounds:', sz.x.toFixed(1) + 'x' + sz.y.toFixed(1), ' off:', off.x.toFixed(1) + ',' + off.y.toFixed(1),
      ' 手动扫描:', (maxX - minX).toFixed(1) + 'x' + (maxY - minY).toFixed(1),
      ' err:', bad, ' NaN源:', firstNan);
  }
}
run();
