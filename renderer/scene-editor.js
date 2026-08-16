// 台词场景数据模块(桌宠内置"设置 → 台词与场景"面板使用)
// 与独立"梨璃交互编辑器"(交互编辑器/renderer/editor.js)完全同源:
// 场景元数据、_settings(允许打断 + 冷却)、宽度截断、JSONC 解析/序列化规则一致,
// 两个工具编辑同一个 lines.jsonc 文件互不破坏。
'use strict';
window.SceneEditor = (() => {
  // ---- 场景元数据(编号 → 名称/说明/分组/动作/部位) ----
  const SCENE_META = {
    '01_greeting':    { group: '通用', name: '启动问候', desc: '桌宠出现时说的第一句话', hasMotion: false },
    '02_random':      { group: '通用', name: '通用随机台词', desc: '点击宠物 / 自动说话时随机挑选', hasMotion: false },
    '03_doubleClick': { group: '通用', name: '双击表情', desc: '双击宠物切换表情时', hasMotion: false },
    '04_wakeUp':      { group: '通用', name: '被点击唤醒', desc: '点击睡着的梨璃唤醒时', hasMotion: false },
    '05_wakeGrumpy':  { group: '通用', name: '被吵醒(起床气)', desc: '睡觉时被键盘/鼠标声吵醒', hasMotion: false },
    '06_sleep':       { group: '通用', name: '入睡气泡', desc: '睡着时的 Zzz 气泡', hasMotion: false },
    '10_typing':      { group: '场景互动', name: '连续打字', desc: '3 秒内 ≥5 次按键', hasMotion: true },
    '11_clicking':    { group: '场景互动', name: '连续点击', desc: '2 秒内 ≥4 次鼠标点击', hasMotion: true },
    '12_mousemove':   { group: '场景互动', name: '持续滑鼠', desc: '连续移动 2.2 秒', hasMotion: true },
    '13_highcpu':     { group: '场景互动', name: 'CPU 高占用', desc: '≥70% 持续 5 秒', hasMotion: true },
    '14_media':       { group: '场景互动', name: '播放视频', desc: '检测到视频播放', hasMotion: true },
    '15_mediaMusic':  { group: '场景互动', name: '播放音乐', desc: '检测到音乐播放', hasMotion: true },
    '16_mediaStop':   { group: '场景互动', name: '停止播放', desc: '媒体停止播放', hasMotion: true },
    '20_partHead':    { group: '身体部位', name: '摸头', desc: '点击头部区域', hasMotion: true, part: 'head' },
    '21_partArmL':    { group: '身体部位', name: '摸左臂', desc: '点击左臂区域', hasMotion: true, part: 'armL' },
    '22_partArmR':    { group: '身体部位', name: '摸右臂', desc: '点击右臂区域', hasMotion: true, part: 'armR' },
    '23_partTorso':   { group: '身体部位', name: '摸肚子', desc: '点击躯干区域', hasMotion: true, part: 'torso' },
    '24_partLegs':    { group: '身体部位', name: '摸腿', desc: '点击腿部 / 裙子区域', hasMotion: true, part: 'legs' },
  };
  const META_ORDER = Object.keys(SCENE_META);

  // 可配置冷却的键:场景互动(15_mediaMusic 跟随 14_media)+ 身体部位点击
  const COOLDOWN_KEYS = [
    '10_typing', '11_clicking', '12_mousemove', '13_highcpu', '14_media', '16_mediaStop',
    '20_partHead', '21_partArmL', '22_partArmR', '23_partTorso', '24_partLegs',
  ];
  const DEFAULT_COOLDOWNS = {
    '10_typing': 4000, '11_clicking': 6000, '12_mousemove': 12000, '13_highcpu': 30000,
    '14_media': 10000, '16_mediaStop': 10000,
    '20_partHead': 3000, '21_partArmL': 3000, '22_partArmR': 3000, '23_partTorso': 3000, '24_partLegs': 3000,
  };

  // 发言最大长度:硬编码固定为 100 显示宽度单位(1 汉字/全角 = 2,1 英文/数字/半角 = 1)
  const MAX_LINE_WIDTH = 100;

  // ---- JSONC 注释剥离(与桌宠 renderer.js / 交互编辑器同一实现) ----
  function stripJsonComments(text) {
    let out = '';
    let inStr = false, esc = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], nx = text[i + 1];
      if (inStr) {
        out += ch;
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; out += ch; continue; }
      if (ch === '/' && nx === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (ch === '/' && nx === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
      out += ch;
    }
    return out;
  }

  // 单个字符的显示宽度(中文/全角/emoji 算 2,其余算 1)
  function charWidth(ch) {
    const c = ch.codePointAt(0);
    if (
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
    ) return 2;
    return 1;
  }

  function displayWidth(s) {
    let w = 0;
    for (const ch of s) w += charWidth(ch);
    return w;
  }

  // 按显示宽度截断字符串(累计宽度不超过 maxW,不会截断 emoji 代理对)
  function truncateByWidth(s, maxW) {
    let w = 0, out = '';
    for (const ch of s) {
      const cw = charWidth(ch);
      if (w + cw > maxW) break;
      w += cw;
      out += ch;
    }
    return out;
  }

  // ---- 解析:文本 → { scenes, settings, unknownKeys } ----
  function parse(text) {
    const data = JSON.parse(stripJsonComments(text));
    // 场景互动设置(_settings):允许打断 + 冷却(非法值回退默认)
    const raw = (data && data._settings) || {};
    const settings = { allowInterrupt: raw.allowInterrupt !== false, cooldowns: {} };
    for (const k of COOLDOWN_KEYS) {
      const v = Number(raw.cooldowns && raw.cooldowns[k]);
      settings.cooldowns[k] = v > 0 && Number.isFinite(v) ? Math.round(v) : DEFAULT_COOLDOWNS[k];
    }
    // 提取备注:键行行尾注释  "10_typing": [  // 备注文字
    const remarkMap = {};
    const re = /"(\d{2}_\w+)"\s*:\s*\[[^\n]*\/\/\s*(.+)$/gm;
    let m;
    while ((m = re.exec(text))) remarkMap[m[1]] = m[2].trim();

    const scenes = {};
    for (const key of META_ORDER) {
      const meta = SCENE_META[key];
      const arr = Array.isArray(data[key]) ? data[key].filter((x) => typeof x === 'string') : [];
      scenes[key] = {
        meta,
        lines: arr.map((s) => truncateByWidth(s, MAX_LINE_WIDTH)),
        motion: '',
        remark: remarkMap[key] || '',
      };
      // 动作映射:场景互动 → motions;身体部位 → partMotions(面板不编辑,原样保留)
      if (meta.hasMotion && data.motions && typeof data.motions[key] === 'string') {
        scenes[key].motion = data.motions[key];
      }
      if (meta.part && data.partMotions && typeof data.partMotions[key] === 'string') {
        scenes[key].motion = data.partMotions[key];
      }
    }
    // 编辑器不认识但文件里存在的键 → 保存时原样保留
    const unknownKeys = {};
    for (const key of Object.keys(data)) {
      if (!(key in SCENE_META) && key !== 'motions' && key !== 'partMotions' &&
          key !== '_maxLineLength' && key !== '_settings') {
        unknownKeys[key] = data[key];
      }
    }
    return { scenes, settings, unknownKeys };
  }

  // ---- 空白模板(文件缺失/损坏时兜底) ----
  function createDefault() {
    const scenes = {};
    for (const key of META_ORDER) {
      scenes[key] = { meta: SCENE_META[key], lines: [], motion: '', remark: '' };
    }
    return { scenes, settings: { allowInterrupt: true, cooldowns: { ...DEFAULT_COOLDOWNS } }, unknownKeys: {} };
  }

  // ---- 序列化:{ scenes, settings, unknownKeys } → JSONC 文本(与交互编辑器同格式) ----
  function serialize(model) {
    const { scenes, settings, unknownKeys } = model;
    const L = [];
    L.push('{');
    L.push('  // ============================================================================');
    L.push('  // 突击莉莉桌宠 · 台词配置文件');
    L.push('  // 本文件由桌宠内置"设置 → 台词与场景"维护,也可用"梨璃交互编辑器"或文本编辑器手动修改。');
    L.push('  // 每个"场景编号"是一个键,值为发言数组,桌宠会随机从中挑选一句。');
    L.push('  // 修改保存后即时生效;删除键/数组留空会回退内置默认台词。');
    L.push('  // ============================================================================');
    L.push('');
    L.push('  // ---- 场景互动设置(可在设置 → 台词与场景 中修改) ----');
    L.push('  "_settings": {');
    L.push(`    "allowInterrupt": ${settings.allowInterrupt ? 'true' : 'false'}, // 是否允许场景互动打断当前发言/动作`);
    L.push('    "cooldowns": { // 各场景互动/身体部位点击的冷却(毫秒);0 = 不限制');
    COOLDOWN_KEYS.forEach((k, i) => {
      L.push(`      ${JSON.stringify(k)}: ${settings.cooldowns[k]}${i < COOLDOWN_KEYS.length - 1 ? ',' : ''}`);
    });
    L.push('    }');
    L.push('  },');
    let first = true;
    for (const key of META_ORDER) {
      const sc = scenes[key];
      if (!first) L.push('');
      first = false;
      L.push(`  // ---- ${key} ${sc.meta.name}(${sc.meta.desc}) ----`);
      if (sc.remark) L.push(`  // 备注: ${sc.remark}`);
      L.push(`  "${key}": [`);
      sc.lines.forEach((ln, i) => {
        L.push(`    ${JSON.stringify(ln)}${i < sc.lines.length - 1 ? ',' : ''}`);
      });
      L.push('  ],');
    }
    for (const key of Object.keys(unknownKeys)) {
      L.push('');
      L.push('  // ---- 未知场景(编辑器不认识,原样保留) ----');
      L.push(`  ${JSON.stringify(key)}: ${JSON.stringify(unknownKeys[key])},`);
    }
    // 动作映射:场景互动 → motions;身体部位 → partMotions
    const mk = META_ORDER.filter((k) => SCENE_META[k].hasMotion && !SCENE_META[k].part);
    L.push('');
    L.push('  // ---- 场景动作映射(可选,留空则只说话) ----');
    L.push('  "motions": {');
    mk.forEach((k, i) => {
      L.push(`    ${JSON.stringify(k)}: ${scenes[k].motion ? JSON.stringify(scenes[k].motion) : '""'}${i < mk.length - 1 ? ',' : ''}`);
    });
    L.push('  },');
    const pk = META_ORDER.filter((k) => SCENE_META[k].part);
    L.push('  "partMotions": {');
    pk.forEach((k, i) => {
      L.push(`    ${JSON.stringify(k)}: ${scenes[k].motion ? JSON.stringify(scenes[k].motion) : '""'}${i < pk.length - 1 ? ',' : ''}`);
    });
    L.push('  }');
    L.push('}');
    return L.join('\n');
  }

  return {
    SCENE_META, META_ORDER, COOLDOWN_KEYS, DEFAULT_COOLDOWNS, MAX_LINE_WIDTH,
    parse, createDefault, serialize, truncateByWidth, displayWidth, stripJsonComments,
  };
})();
