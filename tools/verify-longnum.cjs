// 验证超长数字(1万亿)渲染与窗口尺寸
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { readFileSync } = require('node:fs');
const path = require('node:path');

(async () => {
  const img = await loadImage(readFileSync(path.join(__dirname, '..', '..', 'debug-idle-counter.png')));
  const cw = img.width, ch = img.height;
  const cv = createCanvas(cw, ch);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  console.log('counter shot: ' + cw + 'x' + ch);
  const close = (a, b, tol) => Math.abs(a - b) <= tol;
  let bg = { minX: 1e9, minY: 1e9, maxX: -1, maxY: -1, cnt: 0 };
  let text = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * cw + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 40) continue;
      if (close(r, 22, 14) && close(g, 13, 12) && close(b, 44, 16) && a > 180) {
        bg.cnt++;
        if (x < bg.minX) bg.minX = x; if (x > bg.maxX) bg.maxX = x;
        if (y < bg.minY) bg.minY = y; if (y > bg.maxY) bg.maxY = y;
      }
      if (a > 120 && (r + g + b) / 3 > 140) text++;
    }
  }
  if (!bg.cnt) { console.log('card not found'); return; }
  const w = bg.maxX - bg.minX + 1, h = bg.maxY - bg.minY + 1;
  console.log('card: ' + w + 'x' + h + ' phys, 文字像素=' + text);
  console.log('格式化结果应为 "100000000万" (9字符) → 卡片应明显变宽(>150px)');
  console.log('判定: ' + (w > 150 ? 'PASS 超长数字窗口变宽' : '提示: 宽度=' + w + ' 未如预期变宽'));
})();
