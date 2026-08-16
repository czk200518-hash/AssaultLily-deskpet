/* 突击莉莉桌宠 - 渲染与行为逻辑
 * 引擎: PixiJS 5.1.3 + pixi-spine(spine37 运行时) + 原版 SkeletonJsonConverter
 * 模型: v1 全身立绘 CharacterJobSpine010001001(74 骨骼 / 97 槽位 / 33 动画 / 24 表情)
 */
'use strict';
(() => {
  const API = window.petAPI;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let DEBUG = false;
  let DEBUG_TARGET = null;
  const dlog = (msg) => { console.log(msg); if (DEBUG) API.debugLog(msg); };

  // ================= 配置 =================
  let config = { scale: 1, alwaysOnTop: true, clickThrough: false, autoLaunch: false, outline: true, sceneInteract: true };
  let userScale = 1;

  // ================= 渲染对象 =================
  let app = null;
  let lilySpine = null;   // PIXI.spine.Spine
  let spineData = null;
  let canvasW = 0;
  let canvasH = 0;
  let charScale = 1;
  let ANIM_DUR = {};      // 动画名 → 时长(秒),加载时从转换后的 JSON 关键帧算出(供交互锁用)

  // ================= 行为状态 =================
  const MODE = { IDLE: 'idle', REACT: 'react', SLEEP: 'sleep' };
  let mode = MODE.IDLE;
  // 交互锁(后摇):动作"主拍"结束前点击不响应,主拍结束后即可点击/打断,不用等队列播完
  let reactLockUntil = 0;
  let currentAnim = '01BaseLoop';
  let currentEmotion = 0;
  let idleElapsed = 0;
  let bubbleTimer = null;
  let emoteTimer = null;
  let menuOpen = false;
  let menuCloseByClickAt = 0; // 最近一次"点击角色关闭菜单"的时刻(防止右键的 contextmenu 紧随 mousedown 又把菜单重开)
  let downPos = null;
  let downTime = 0;         // mousedown 时刻(卡死拖动兜底:超时强制结束)
  let lastDragMove = 0;     // 最近一次拖动中 mousemove 时刻
  let wasDrag = false;
  let tempInteractive = false; // 托盘"移动宠物":全穿透期间的临时像素级交互
  // 拖动(跟手优化):不用逐事件 IPC,而是记录拖动基准,用"绝对目标"按帧节流发送
  let dragBase = null;      // 拖动基准:起始窗口位置(DIP) + 起始光标位置(与 e.screenX 同单位)
  let pendingTarget = null; // 待发送的窗口目标位置(绝对坐标,DIP),由 frame() 每帧发送一次
  let lastDragSent = null;  // 最近一次已发送的目标(去重,位置没变就不重复发)
  let lastClickTime = 0;
  let lastEmotionLocked = false;

  // 说话/眨眼
  let talkTimer = null;
  let blinkTimer = null;
  let talking = false;

  // ================= 文案(外部 JSON 配置,按场景编号维护) =================
  // 台词文件: renderer/lines.jsonc(JSONC 格式,支持 // 与 /* */ 注释,
  // VS Code 等编辑器原生支持,不会报"不允许注释")。
  // 键名即"场景编号": 01~09 通用场景 | 10~19 场景互动 | 20~29 身体部位。
  // 文件缺失 / 键缺失 / 数组为空 → 自动回退到下方内置默认台词,程序始终可用。
  const DEFAULT_LINES = {
    '01_greeting': [            // 启动问候
      '你好！我是一柳梨璃，请多关照！',
      '今天也要一起加油哦☆',
      '一柳队，出击准备完毕！',
    ],
    '02_random': [              // 通用随机台词
      '我是一柳梨璃！请多关照！',
      '今天也要一起加油哦☆',
      '想成为姐姐大人的话，可不能偷懒呢！',
      '呼啊……好想睡觉……不行不行，训练要紧！',
      '这个敌人就交给我吧！',
      '别、别捏我的脸啦！',
      '唔……有点饿了，训练完要好好吃饭！',
      '你的手好暖和……',
      '梦结酱在的话，一定又会说我发呆了吧……',
      '哼，这点小事算什么！',
      '我会好好守护大家的！',
    ],
    '03_doubleClick': ['嘻嘻～怎么样？', '我的新表情！', '怎样？可爱吧！'],
    '04_wakeUp': ['啊！我睡着了吗！', '唔……该去训练了！', '梦到和梦结酱一起出击了……'],
    '05_wakeGrumpy': ['唔……你敲键盘的声音太大啦！', '吵醒梨璃了！在忙什么呀？', 'Zzz……啊！谁在疯狂点点点！'],
    '06_sleep': ['Zzz……'],
    '10_typing': [
      '噼里啪啦的……打字好快呀！是在写作战报告吗？',
      '打字像操作 CHARM 一样熟练呢！',
      '键盘都要冒烟啦！休息一下比较好哦？',
      '在工作吗？梨璃给你加油！',
      '唔……我也想学会这么快的打字……',
    ],
    '11_clicking': [
      '哒哒哒……点这么快，在打游戏吗？',
      '手速不错嘛！要跟梨璃比试一下吗？',
      '连续点击……是发现了什么大敌人吗？',
      '再点下去，鼠标会像 CHARM 一样过热的！',
    ],
    '12_mousemove': [
      '鼠标滑来滑去的，在找什么呀？',
      '绕来绕去……是迷路了吗？让我来带路吧！',
      '转得我头都晕啦～',
      '在翻资料吗？需要梨璃帮忙吗？',
    ],
    '13_highcpu': [
      '电脑好像有点吃力……像梨璃训练过度的样子！',
      '风扇转得好大声……辛苦啦！',
      'CPU 都拉满啦，休息一下吧？',
      '唔……有点发热，要好好爱护它哦！',
    ],
    '14_media': [
      '在看视频吗？好看吗！',
      '屏幕上好热闹，梨璃也凑过来看啦',
      '又看番又打游戏，真羡慕呀！',
      '有声音……你在看什么呀？',
    ],
    '15_mediaMusic': [
      '在听歌呀？梨璃也想听～',
      '这旋律……好想跟着一起唱！',
      '音乐真好听，一起享受吧☆',
      '这首歌好像在哪里听过……是训练时放的曲子吗？',
    ],
    '16_mediaStop': ['啊，不看了吗？那来陪梨璃玩吧！', '这么快就看完啦？'],
    '20_partHead': ['嘿嘿，摸摸头～', '别摸啦，头发会乱掉的！', '摸头会长不高的！', '好、好舒服……再摸一下下也可以……'],
    '21_partArmL': ['唔，别挠我左边胳膊！', '左手还要拿装备呢！'],
    '22_partArmR': ['右手要握 CHARM，别乱碰！', '啊！差点把 CHARM 弄掉了！'],
    '23_partTorso': ['别戳肚子啦，好痒！', '这里不能随便碰啦！', '哈哈……别挠啦！'],
    '24_partLegs': ['呀！别碰腿！', '裙子会飞起来的！', '唔……痒痒的！'],
  };
  // 场景动作映射(可选值: fun/anger/shy/surprise/think/positive/negative,可留空 "" 只说话)
  const DEFAULT_SCENE_MOTION = {
    '10_typing': 'think', '11_clicking': 'positive', '12_mousemove': 'think',
    '13_highcpu': 'negative', '14_media': 'fun', '15_mediaMusic': 'fun', '16_mediaStop': 'shy',
  };
  const DEFAULT_PART_MOTION = {
    '20_partHead': 'shy', '21_partArmL': 'surprise', '22_partArmR': 'surprise',
    '23_partTorso': 'fun', '24_partLegs': 'surprise',
  };

  // 场景事件类型 → 场景编号(10~19)
  const SCENE_KEY = {
    typing: '10_typing', clicking: '11_clicking', mousemove: '12_mousemove',
    highcpu: '13_highcpu', media: '14_media', 'media-stop': '16_mediaStop',
  };
  // 身体部位 → 场景编号(20~29)
  const PART_KEY = {
    head: '20_partHead', armL: '21_partArmL', armR: '22_partArmR',
    torso: '23_partTorso', legs: '24_partLegs',
  };

  let LINES_CFG = {};    // 合并后的台词表(外部 JSON 优先,缺失键回退内置)
  let SCENE_MOTION = {}; // 合并后的场景动作表
  let PART_MOTION = {};  // 合并后的部位动作表

  // 剥离 JSON 注释(// 行注释与 /* */ 块注释;字符串内的 // 不受影响),支持 JSONC 写法
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

  // 发言最大长度:硬编码固定为 100 显示宽度单位(1 汉字/全角 = 2,1 英文/数字/半角 = 1),
  // 即 50 个汉字 或 100 个英文字母。不允许外部修改(如需调整请改此处常量)。
  const MAX_LINE_WIDTH = 100;

  // 单个字符的显示宽度(按东亚宽度近似:中文/全角/emoji 算 2,其余算 1)
  function charWidth(ch) {
    const c = ch.codePointAt(0);
    if (
      (c >= 0x1100 && c <= 0x115f) ||   // 谚文 Jamo
      (c >= 0x2e80 && c <= 0xa4cf) ||   // 部首 ~ 彝文
      (c >= 0xac00 && c <= 0xd7a3) ||   // 谚文音节
      (c >= 0xf900 && c <= 0xfaff) ||   // CJK 兼容表意文字
      (c >= 0xfe30 && c <= 0xfe4f) ||   // CJK 兼容形式
      (c >= 0xff00 && c <= 0xff60) ||   // 全角形式
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)    // emoji
    ) return 2;
    return 1;
  }

  // 字符串显示宽度
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

  // 加载台词配置:外部 lines.jsonc 优先,键缺失/非法时回退内置默认
  async function loadLines() {
    let file = null;
    try {
      const buf = await API.readAsset('lines.jsonc');
      file = JSON.parse(stripJsonComments(new TextDecoder().decode(buf)));
    } catch (e) {
      dlog('[lines] lines.jsonc 加载失败,回退内置台词: ' + (e && e.message));
    }
    for (const key of Object.keys(DEFAULT_LINES)) {
      const v = file && Array.isArray(file[key]) && file[key].length ? file[key] : DEFAULT_LINES[key];
      LINES_CFG[key] = v;
    }
    // 场景互动设置(_settings):允许打断 + 各场景冷却(ms)
    sceneSettings = {
      allowInterrupt: true,
      cooldowns: {},
      ...((file && file._settings) || {}),
    };
    // 冷却同步给主进程(按场景编号),主进程据此做事件频率限制
    if (file && file._settings) {
      try { API.setSceneSettings({ cooldowns: sceneSettings.cooldowns || {} }); } catch (e) { /* 忽略 */ }
    }
    // 发言最大长度硬编码固定:超长发言按显示宽度截断
    for (const key of Object.keys(LINES_CFG)) {
      LINES_CFG[key] = LINES_CFG[key].map((s) => truncateByWidth(s, MAX_LINE_WIDTH));
    }
    // 动作映射:写错动作名回退默认(防止配置错误导致场景无反应)
    const fm = (file && file.motions) || {};
    const fpm = (file && file.partMotions) || {};
    for (const key of Object.keys(DEFAULT_SCENE_MOTION)) {
      const v = fm[key];
      SCENE_MOTION[key] = v && MOTIONS[v] ? v : DEFAULT_SCENE_MOTION[key];
    }
    for (const key of Object.keys(DEFAULT_PART_MOTION)) {
      const v = fpm[key];
      PART_MOTION[key] = v && MOTIONS[v] ? v : DEFAULT_PART_MOTION[key];
    }
    dlog('[lines] 台词配置加载完成: ' + Object.keys(LINES_CFG).length + ' 个场景' + (file ? ' (来自 lines.jsonc)' : ' (内置默认)') + ' 最大发言=' + MAX_LINE_WIDTH + '宽度(硬编码)');
  }

  // 取某场景编号的一条随机台词(空则返回 '')
  function line(key) {
    const arr = LINES_CFG[key];
    return arr && arr.length ? pick(arr) : '';
  }

  let lastSceneAt = 0;

  // 场景互动设置(来自 lines.jsonc 的 _settings):
  //   allowInterrupt: 是否允许场景互动打断当前发言/动作(false = 等当前说完再回应)
  //   cooldowns: 各场景/身体部位冷却(ms),场景冷却同步给主进程,部位冷却在渲染层执行
  let sceneSettings = { allowInterrupt: true, cooldowns: {} };
  const partLastTime = {}; // 身体部位 → 上次点击回应时刻(部位冷却用)

  // 是否正在"忙"(气泡显示中 / 说话中 / 动作播放中)
  function sceneBusy() {
    return !!bubbleTimer || talking || mode !== MODE.IDLE;
  }

  function onSceneEvent(ev) {
    const key = ev && SCENE_KEY[ev.type];
    if (!key) return;
    if (downPos || menuOpen) return; // 拖动宠物 / 菜单打开时不打扰
    if (mode === MODE.SLEEP) {
      // 睡觉时:打字/连续点击 → 带着起床气醒来;其余场景不打扰睡眠
      if (ev.type === 'typing' || ev.type === 'clicking') {
        wakeUp();
        showBubble(line('05_wakeGrumpy') || '唔……吵醒我了！', 3600);
        startTalk(2200);
      }
      return;
    }
    // 不允许打断:梨璃正在说话/动作/气泡显示中 → 忽略本次场景事件
    if (sceneSettings.allowInterrupt === false && sceneBusy()) return;
    const now = Date.now();
    if (now - lastSceneAt < 2000) return; // 渲染侧节流:避免连珠炮式刷台词(缩短后摇,响应更快)
    lastSceneAt = now;
    if (mode === MODE.IDLE) idleElapsed = 0; // 用户在忙 → 推迟入睡
    // 音乐与视频区分台词
    let k = key;
    if (ev.type === 'media' && ev.music) k = '15_mediaMusic';
    const text = line(k);
    if (!text) return;
    const motion = SCENE_MOTION[k];
    if (motion && Math.random() < 0.6) {
      playMotion(motion, { line: text });
    } else {
      showBubble(text, 3600);
      startTalk(2200);
    }
  }

  // ================= 身体部位点击(单击时区分摸到哪) =================
  // 台词在 lines.jsonc 的 20~29 编号下维护;动作映射在 partMotions 下维护

  // ================= 表情系统(技术资料 §8.2) =================
  // 嘴 24 槽(每字母一组,1闭合/2半张/3全张)
  const MOUTH_TYPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  // 脸部槽位(faceSlotList,下标 0-32;R 侧 = L 侧 +11)
  const FACE_SLOTS = [
    'EyeBlowL_A', 'EyeBlowL_B', 'EyeBlowL_C', 'EyeBlowL_D', 'EyeBlowL_E',
    'EyeBlowR_A', 'EyeBlowR_B', 'EyeBlowR_C', 'EyeBlowR_D', 'EyeBlowR_E',
    'EyeL_3', 'EyeL_4', 'EyeLashesL_1', 'EyeLashesL_2', 'EyeLeftHi',
    'EyeLeft', 'EyeLeftWhite', 'EyeLashesL_Alpha_1', 'EyeLeftMask', 'EyeL_5',
    'EyeLeft_Kira', 'EyeR_3', 'EyeR_4', 'EyeLashesR_1', 'EyeLashesR_2',
    'EyeRightHi', 'EyeRight', 'EyeRightWhite', 'EyeLashesR_Alpha_1', 'EyeRightMask',
    'EyeR_5', 'EyeRight_Kira', 'FaceCheek',
  ];
  // 眼组合(L 侧下标;R = +11)
  const EYE_COMBOS = {
    eye1:  [12, 17, 18, 16, 14, 15],
    eye4:  [11],
    eye3:  [10],
    half:  [13, 18, 16, 14, 15],
    eye5:  [19],
    kira:  [12, 17, 18, 16, 20, 14, 15],
  };
  // 22 种表情(已移除 Anger_L / Anger_Luna: 源图集缺失其嘴H/眉E贴图): [眉字母, 嘴字母, 眼组合]
  const EMOTIONS = [
    ['A', 'A', 'eye1'], ['A', 'A', 'eye4'], ['B', 'B', 'eye1'], ['C', 'C', 'eye1'],
    ['A', 'B', 'eye1'], ['C', 'B', 'eye4'], ['A', 'A', 'eye3'], ['C', 'A', 'eye4'],
    ['C', 'B', 'eye1'], ['A', 'D', 'half'], ['B', 'D', 'half'], ['C', 'D', 'half'],
    ['B', 'A', 'eye1'], ['C', 'D', 'eye1'], ['A', 'B', 'eye3'], ['A', 'C', 'eye1'],
    ['D', 'E', 'eye1'], ['D', 'F', 'eye1'], ['C', 'G', 'eye1'], ['A', 'A', 'kira'],
    ['B', 'E', 'eye1'], ['B', 'G', 'eye1'],
  ];
  const EMOTION_NAMES = [
    'Normal', 'Smile', 'Anger', 'Sad', 'Surprise', 'Pain', 'Sleep', 'Shy',
    'Trouble', 'HalfEye_Normal', 'HalfEye_Anger', 'HalfEye_Sad', 'Strong', 'Ennui',
    'Close', 'Serious', 'Smile_L', 'Surprise_L', 'Trouble_L', 'Excite',
    'Smile_Luna', 'Surprise_Luna',
  ];

  // 预设动作(技术资料 §8.1): 动画序列 + 联动表情
  const MOTIONS = {
    base:     { anims: [], emotion: 0 },
    fun:      { anims: ['02Fun', '02FunLoop', '02FunEnd'], emotion: 1 },
    anger:    { anims: ['03Anger', '03AngerLoop', '03AngerEnd'], emotion: 2 },
    shy:      { anims: ['04Shy', '04ShyLoop', '04ShyEnd'], emotion: 7 },
    surprise: { anims: ['05Surprise', '05SurpriseLoop', '05SurpriseEnd'], emotion: 4 },
    think:    { anims: ['S_01Think', 'S_01ThinkLoop', 'S_01ThinkEnd'], emotion: 15 },
    positive: { anims: ['S_02Positive'], emotion: 12 },
    S_03:     { anims: ['S_03PoseChange', 'S_03PoseChangeLoop', 'S_03PoseChangeEnd'], emotion: 0 },
    S_04:     { anims: ['S_04PoseChange', 'S_04PoseChangeLoop', 'S_04PoseChangeEnd'], emotion: 0 },
    S_05:     { anims: ['S_05PoseChange', 'S_05PoseChangeLoop', 'S_05PoseChangeEnd'], emotion: 0 },
    negative: { anims: ['S_06Negative'], emotion: 8 },
    U_01:     { anims: ['U_01PoseChange', 'U_01PoseChangeLoop', 'U_01PoseChangeEnd'], emotion: 0 },
    U_02:     { anims: ['U_02PoseChange', 'U_02PoseChangeLoop', 'U_02PoseChangeEnd'], emotion: 0 },
  };
  const REACT_POOL = ['fun', 'anger', 'shy', 'surprise', 'think', 'positive', 'negative'];
  const EMOTE_POOL = ['fun', 'shy', 'surprise', 'think', 'positive'];

  // ================= 附件切换 =================
  function setSlotAttachment(slotName, attachmentName) {
    try {
      lilySpine.skeleton.setAttachment(slotName, attachmentName);
    } catch (e) {
      dlog('[setAttachment 异常] ' + slotName + ' ' + e.message);
    }
  }
  function showSlot(slot) { setSlotAttachment(slot, slot); }
  function hideSlot(slot) { setSlotAttachment(slot, null); }
  function allNull(list) { list.forEach((s) => hideSlot(s)); }

  // 表情组合
  function setMouth(type, id) {
    allNull(['Mouth01_A', 'Mouth01_B', 'Mouth01_C', 'Mouth01_D', 'Mouth01_E', 'Mouth01_F', 'Mouth01_G', 'Mouth01_H',
             'Mouth02_A', 'Mouth02_B', 'Mouth02_C', 'Mouth02_D', 'Mouth02_E', 'Mouth02_F', 'Mouth02_G', 'Mouth02_H',
             'Mouth03_A', 'Mouth03_B', 'Mouth03_C', 'Mouth03_D', 'Mouth03_E', 'Mouth03_F', 'Mouth03_G', 'Mouth03_H']);
    if (id > 0) showSlot(`Mouth0${id}_${type}`);
  }
  function setEyebrow(type) {
    allNull(FACE_SLOTS.slice(0, 10)); // 10 个眉槽
    showSlot(`EyeBlowL_${type}`);
    showSlot(`EyeBlowR_${type}`);
  }
  function setEyeCombo(combo) {
    const idx = EYE_COMBOS[combo];
    if (!idx) return;
    // 全灭眼睛相关槽位(下标 10-31,不含眉与 FaceCheek)
    allNull(FACE_SLOTS.slice(10, 32));
    idx.forEach((i) => showSlot(FACE_SLOTS[i]));      // L 侧
    idx.forEach((i) => showSlot(FACE_SLOTS[i + 11])); // R 侧
  }
  function setEmotion(i) {
    if (i < 0 || i >= EMOTIONS.length) i = 0;
    currentEmotion = i;
    const [eyebrow, mouth, eye] = EMOTIONS[i];
    setMouth(mouth, 1);
    setEyebrow(eyebrow);
    setEyeCombo(eye);
  }

  // 说话(技术资料 §8.3): 每 180ms 循环嘴部 1→2→3→1→2
  function startTalk(duration) {
    if (talking) return;
    talking = true;
    let i = 0;
    if (talkTimer) clearInterval(talkTimer);
    talkTimer = setInterval(() => {
      const seq = [1, 2, 3, 1, 2];
      setMouth(EMOTIONS[currentEmotion][1], seq[i % 5]);
      i++;
    }, 180);
    setTimeout(() => {
      clearInterval(talkTimer);
      talkTimer = null;
      talking = false;
      setEmotion(currentEmotion); // 恢复当前表情的嘴形
    }, duration || 2500);
  }

  // 眨眼(技术资料 §8.3): 每 5s±2s, 序列 [current, half, eye3, half, current], 40ms/帧
  function scheduleBlink() {
    if (blinkTimer) clearTimeout(blinkTimer);
    const delay = 5000 + Math.random() * 2000;
    blinkTimer = setTimeout(() => {
      const cur = EMOTIONS[currentEmotion][2];
      if (cur === 'eye3' || cur === 'eye4') { scheduleBlink(); return; }
      const seq = [cur, 'half', 'eye3', 'half', cur];
      let i = 0;
      const iv = setInterval(() => {
        setEyeCombo(seq[i]);
        i++;
        if (i >= seq.length) { clearInterval(iv); scheduleBlink(); }
      }, 40);
    }, delay);
  }

  // ================= 动画控制 =================
  // 播放动作。队列规则:跳过 5 秒长的 *Loop 保持动画(那是"后摇"的主要来源——
  // 动作主拍(≈2 秒)+ 收尾(≈0.7 秒)≈ 3 秒就回到待机,节奏更利落),
  // 只排 [主拍, 收尾, 01BaseLoop]。
  function playMotion(motionName, opts) {
    opts = opts || {};
    const motion = MOTIONS[motionName];
    if (!motion) return;
    mode = opts.keepMode || MODE.REACT;
    const st = lilySpine.state;
    st.clearTracks();
    const seq = motion.anims.filter((a) => !a.endsWith('Loop'));
    for (const anim of seq) {
      st.addAnimation(0, anim, false, 0);
    }
    st.addAnimation(0, '01BaseLoop', true, 0);
    currentAnim = seq[0] || '01BaseLoop';
    if (!opts.lockEmotion) setEmotion(motion.emotion);
    if (opts.line) showBubble(opts.line);
    // 交互锁只覆盖动作主拍(主拍时长 + 过渡缓冲),主拍播完即可点击/被打断
    let durMs = 2200;
    const first = seq[0];
    if (first && ANIM_DUR[first] > 0) durMs = ANIM_DUR[first] * 1000;
    reactLockUntil = Date.now() + Math.round(durMs) + 450;
  }

  function playAnimation(name, loop) {
    currentAnim = name;
    mode = MODE.REACT;
    lilySpine.state.clearTracks();
    lilySpine.state.setAnimation(0, name, !!loop);
    if (!loop) lilySpine.state.addAnimation(0, '01BaseLoop', true, 0);
    // 菜单动画只给短暂保护(防误点打断),不给长锁:loop 动画不再永久锁死点击
    reactLockUntil = Date.now() + 1200;
  }

  // ================= 气泡 =================
  function showBubble(text, duration) {
    const wrap = $('bubble-wrap');
    $('bubble-text').textContent = text;
    wrap.classList.add('show');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => wrap.classList.remove('show'), duration || 3200);
  }

  // ================= 行为引擎 =================
  function scheduleEmote() {
    if (emoteTimer) clearTimeout(emoteTimer);
    const delay = rand(15, 30) * 1000;
    emoteTimer = setTimeout(() => {
      if (mode === MODE.IDLE) {
        if (Math.random() < 0.4) {
          playMotion(pick(EMOTE_POOL), { line: Math.random() < 0.5 ? line('02_random') : null });
          setTimeout(() => { if (mode === MODE.REACT) { mode = MODE.IDLE; } }, 6000);
        } else if (Math.random() < 0.3) {
          showBubble(line('02_random') || '……');
          startTalk(2000);
        }
      }
      scheduleEmote();
    }, delay);
  }

  function enterSleep() {
    mode = MODE.SLEEP;
    setEmotion(6); // Sleep 表情
    showBubble(line('06_sleep') || 'Zzz……', 2500);
  }
  function wakeUp() {
    if (mode !== MODE.SLEEP) return;
    mode = MODE.IDLE;
    setEmotion(0);
    showBubble(line('04_wakeUp') || '啊！我睡着了吗！');
  }

  function onPetClick(cx, cy) {
    const now = Date.now();
    if (now - lastClickTime < 350) {
      // 双击:随机表情
      lastClickTime = 0;
      const idx = Math.floor(Math.random() * EMOTIONS.length);
      setEmotion(idx);
      showBubble(line('03_doubleClick') || '嘻嘻～');
      return;
    }
    lastClickTime = now;
    if (mode === MODE.SLEEP) { wakeUp(); return; }
    // 待机时正常响应;反应(REACT)中只要动作主拍已播完,允许点击打断(不再等整个队列播完)
    if (mode !== MODE.IDLE && (mode !== MODE.REACT || Date.now() < reactLockUntil)) return;
    // 身体部位区分:摸头/左右胳膊/肚子/腿 → 专属台词与反应(lines.jsonc 20~29)
    const part = classifyBodyPart(cx, cy);
    if (part) {
      const pk = PART_KEY[part];
      // 部位冷却(_settings.cooldowns,毫秒;0/未配置 = 不限制):同部位冷却期内忽略重复点击
      const cd = Number(sceneSettings.cooldowns[pk]) || 0;
      if (cd > 0 && partLastTime[pk] && now - partLastTime[pk] < cd) return;
      partLastTime[pk] = now;
      const text = pk && line(pk);
      if (text) playMotion(PART_MOTION[pk], { line: text });
      return;
    }
    playMotion(pick(REACT_POOL), { line: Math.random() < 0.7 ? line('02_random') : null });
  }

  // 用模型像素包围盒粗略分区:顶部 ~22% 为头部,中部按左右三分区分双臂/躯干,下部为腿
  function classifyBodyPart(cx, cy) {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null; // 无坐标(如调试调用)→ 通用反应
    ensurePixelSample();
    const pb = modelPixelBounds();
    if (!pb || pb.count < 50) return null;
    const cv = app.view.getBoundingClientRect();
    if (!cv.width || !cv.height) return null;
    const px = (cx - cv.left) / cv.width * dbgPixW;
    const py = (cy - cv.top) / cv.height * dbgPixH;
    if (px < pb.minX || px > pb.maxX || py < pb.minY || py > pb.maxY) return null;
    const w = Math.max(1, pb.maxX - pb.minX);
    const h = Math.max(1, pb.maxY - pb.minY);
    const relY = (py - pb.minY) / h;
    if (relY < 0.22) return 'head';
    const relX = (px - pb.minX) / w;
    if (relY < 0.62) {
      if (relX < 0.38) return 'armL';
      if (relX > 0.62) return 'armR';
      return 'torso';
    }
    return 'legs';
  }

  // ================= 舞台尺寸 =================
  // 按附件实际世界顶点计算渲染边界(getBounds 会包含 orig 虚影,导致贴底不准)
  function computeRenderBounds() {
    const s37 = PIXI.spine.spine37;
    const sk = lilySpine.skeleton;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    const verts = new Float32Array(16);
    for (const slot of sk.drawOrder) {
      const att = slot.attachment;
      if (!att) continue;
      try {
        if (att instanceof s37.RegionAttachment) {
          att.computeWorldVertices(slot.bone, verts, 0, 2);
          for (let i = 0; i < 8; i += 2) {
            if (verts[i] < minX) minX = verts[i];
            if (verts[i] > maxX) maxX = verts[i];
            if (verts[i + 1] < minY) minY = verts[i + 1];
            if (verts[i + 1] > maxY) maxY = verts[i + 1];
          }
        } else if (att instanceof s37.MeshAttachment) {
          const n = att.worldVerticesLength;
          if (!n) continue;
          const wv = new Float32Array(n);
          att.computeWorldVertices(slot, 0, n, wv, 0, 2);
          for (let i = 0; i < n; i += 2) {
            if (wv[i] < minX) minX = wv[i];
            if (wv[i] > maxX) maxX = wv[i];
            if (wv[i + 1] < minY) minY = wv[i + 1];
            if (wv[i + 1] > maxY) maxY = wv[i + 1];
          }
        }
      } catch (e) { /* 跳过异常附件 */ }
    }
    if (minX === 1e9) return null;
    return { minX, minY, maxX, maxY };
  }

  async function applyFit() {
    const wa = await API.getWorkArea();
    // 清晰度修复:基础显示比例 0.55 → 0.70,让 2048 高清贴图少被下采样,细节损失更小
    const targetH = clamp(wa.height * 0.70 * userScale, 220, 1200);
    // 骨架 1400x2400
    charScale = targetH / 2400;
    canvasW = Math.round(1400 * charScale);
    canvasH = Math.round(2400 * charScale);

    app.renderer.resize(canvasW, canvasH);
    // 锚点容器与画布同尺寸:气泡/调试线框都锚定角色,
    // 窗口被系统 ±1px 取整或意外变化时不会跟着漂移
    const anchor = $('stage-anchor');
    anchor.style.width = canvasW + 'px';
    anchor.style.height = canvasH + 'px';
    // 气泡向上生长预留空间:窗口顶部多出透明区(锚点容器保持画布尺寸、底部对齐),
    // 长台词气泡向上长时不会被窗口上边缘裁剪;透明区在描边模式下点击穿透,不影响使用
    const bubbleSpace = Math.max(0, Math.min(200, Math.round(wa.height * 0.15), wa.height - canvasH));
    lilySpine.scale.set(charScale);
    lilySpine.x = canvasW / 2;
    lilySpine.y = 0;

    // 骨骼原点不在几何中心:按附件真实顶点边界平移,让脚底贴窗口底
    // computeWorldVertices 已应用 yDown 翻转(PIXI y 向下),脚底=最大 y(maxY)
    lilySpine.update(0.05);
    lilySpine.updateTransform();
    const rb = computeRenderBounds();
    if (rb) {
      const footPix = rb.maxY * charScale; // 脚底在 PIXI 坐标系的位置(lilySpine.y=0 时)
      lilySpine.y += (canvasH - footPix);
      if (DEBUG) dlog('[fit] 真实边界 y[' + rb.minY.toFixed(1) + ',' + rb.maxY.toFixed(1) + '] 脚底px=' + footPix.toFixed(1) + ' y=' + lilySpine.y.toFixed(1));
    } else {
      if (DEBUG) dlog('[fit] 边界计算失败,使用原点');
    }

    const bounds = await API.resize(canvasW, canvasH + bubbleSpace, 'bottom-center');
    if (DEBUG) dlog('[fit] 窗口 ' + JSON.stringify(bounds) + ' scale=' + charScale.toFixed(3) + ' bubbleSpace=' + bubbleSpace);

    // 气泡尾巴跟随角色缩放:待机姿势头部顶点距画布顶 ≈118.8 骨架单位(实测,头顶在 minY=-808.9,
    // 脚底 maxY=1472.3 贴画布底,画布高 2400 → 2400-1472.3-808.9=118.8)。
    // 尾巴放在头顶上方 10px,气泡主体向上生长 —— 任何缩放档位都不遮挡面部。
    const bubbleWrap = $('bubble-wrap');
    if (bubbleWrap) {
      const headTopPx = 118.8 * charScale;
      bubbleWrap.style.top = Math.max(4, Math.round(headTopPx - 10)) + 'px';
      if (DEBUG) dlog('[fit] 气泡尾巴 top=' + bubbleWrap.style.top + ' 头部顶=' + headTopPx.toFixed(1) + 'px');
    }
  }

  // ================= 菜单(独立窗口,右键时由主进程在角色旁边弹出) =================

  // 组装菜单状态并请求主进程弹出独立菜单窗口
  function openMenu() {
    menuOpen = true;
    const state = {
      animNow: currentAnim,
      currentEmotion,
      config: {
        alwaysOnTop: config.alwaysOnTop,
        clickThrough: config.clickThrough,
        autoLaunch: config.autoLaunch,
        scale: userScale,
        sceneInteract: config.sceneInteract !== false,
      },
      debug: {
        bounds: boundsDebug,
        outline: outlineMode,
      },
      animations: (spineData ? spineData.animations : []).map((a) => ({ name: a.name, duration: a.duration || 0 })),
      emotions: EMOTION_NAMES,
      motions: Object.keys(MOTIONS).map((k) => ({ key: k, name: k })),
    };
    API.openMenu(state);
  }

  function closeMenu() {
    menuOpen = false;
    API.closeMenu();
  }

  // 接收菜单窗口转发来的动作并执行
  function setupMenuBridge() {
    API.onMenuAction((action) => {
      if (!action || !action.type) return;
      switch (action.type) {
        case 'emotion':
          setEmotion(action.value);
          break;
        case 'motion':
          playMotion(action.value);
          break;
        case 'animation':
          playAnimation(action.value.name, action.value.loop);
          break;
        case 'size':
          applySize(action.value);
          break;
        case 'toggle':
          applyToggle(action.value.key, action.value.value);
          break;
        case 'counterPeriod':
          // 菜单设置:切换独立记数窗口的统计周期(今日/本周/本月/总计),主进程校验并持久化
          API.setCounter({ period: action.value });
          break;
        case 'open-menu':
          // 托盘"功能菜单":全穿透模式下无法右键宠物,由此打开菜单窗口
          openMenu();
          break;
        case 'temp-interactive':
          // 托盘"移动宠物":临时回到像素级交互(本体可拖动),倒计时后恢复全穿透
          tempInteractive = !!action.value;
          showBubble(tempInteractive ? '🖱 临时交互开启:现在可以拖动宠物啦(15 秒后恢复穿透)' : '🖱 鼠标穿透已恢复', 2800);
          break;
      }
    });
    // 菜单窗口失焦/关闭时同步状态
    API.onMenuClosed(() => { menuOpen = false; });
    // 内置"设置 → 台词与场景"保存台词文件后:热重载配置,无需重启桌宠
    API.onLinesSaved(async () => {
      try {
        await loadLines();
        dlog('[lines] 台词配置已热重载(内置场景编辑器保存)');
        showBubble('📝 台词配置已更新!', 2400);
      } catch (e) {
        dlog('[lines] 台词热重载失败: ' + (e && e.message));
      }
    });
  }

  async function applySize(v) {
    userScale = v;
    config.scale = v;
    await API.setConfig({ scale: v });
    await applyFit();
  }

  async function applyToggle(key, value) {
    if (key === 'alwaysOnTop') {
      config.alwaysOnTop = value;
      await API.setConfig({ alwaysOnTop: value });
    } else if (key === 'clickThrough') {
      config.clickThrough = value;
      await API.setConfig({ clickThrough: value });
      // 鼠标穿透 = 全窗口穿透(含本体)。开启时提示用户如何移动宠物。
      if (value) showBubble('🖱 鼠标穿透已开启:整个宠物不再挡鼠标(托盘可临时移动)', 3200);
      // 立即同步像素级穿透(透明区穿透/本体交互由 mousemove 实时驱动)
      syncPixelInteractive();
    } else if (key === 'autoLaunch') {
      config.autoLaunch = value;
      await API.setConfig({ autoLaunch: value });
    } else if (key === 'bounds') {
      // 确保状态与开关一致
      if (value && !boundsDebug) toggleBoundsDebug();
      else if (!value && boundsDebug) toggleBoundsDebug();
    } else if (key === 'outline') {
      // 保持渲染侧配置与主进程持久化一致(持久化写在 toggleOutlineMode 内)
      config.outline = value;
      if (value && !outlineMode) toggleOutlineMode();
      else if (!value && outlineMode) toggleOutlineMode();
    } else if (key === 'sceneInteract') {
      config.sceneInteract = value;
      await API.setConfig({ sceneInteract: value });
      showBubble(value ? '🎭 场景互动已开启:梨璃会回应你的操作哦' : '🎭 场景互动已关闭', 2600);
    } else if (key === 'counterShow') {
      // 独立记数窗口:显示/隐藏(统计继续,隐藏不丢数据;主进程负责窗口显隐)
      await API.setCounter({ enabled: value });
    }
  }

  // ================= 交互 =================
  // 结束拖动(统一清理:正常松开 / 窗口外松手兜底 / 失焦取消共用)。
  // 若不统一收尾,missed mouseup(快速拖动时在窗口外松手)会让 downPos 残留,
  // 桌宠会"粘"在光标上一路跟走(每次 mousemove 都在计算绝对目标)。
  function endDrag(doClick, cx, cy) {
    $('pet').classList.remove('dragging');
    // 松开前把最后的绝对目标立即发出去(不等下一帧),窗口精确停在光标处
    if (pendingTarget) {
      API.dragMove(pendingTarget.x, pendingTarget.y);
      pendingTarget = null;
      lastDragSent = null;
    }
    downPos = null;
    dragBase = null;
    if (doClick) onPetClick(cx, cy);
  }

  function setupInteraction() {
    const el = $('pet');
    el.addEventListener('mousedown', async (e) => {
      if (e.button !== 0) return;
      if (menuOpen) {
        // 菜单是独立窗口:点击角色窗口任意处即关闭
        closeMenu();
        return;
      }
      // 像素级穿透(鼠标穿透/描边模式):仅角色本体像素可交互。
      // 兜底:ignore 状态切换存在毫秒级竞态,落在透明区的点击直接丢弃,
      // 不触发反应/拖动,也不让窗口把它吞掉后无法穿透到下层窗口。
      if (pixelThroughActive() && !outlineHitTest(e.clientX, e.clientY)) return;
      downPos = { x: e.screenX, y: e.screenY };
      downTime = performance.now();
      lastDragMove = downTime;
      wasDrag = false;
      el.classList.add('dragging');
      pendingTarget = null;
      lastDragSent = null;
      // 记录拖动基准(起始窗口位置 + 起始光标位置),拖动期间按"绝对目标"跟随光标
      try {
        const [wx, wy] = await API.getPosition();
        if (!downPos) return; // 按下后已松开/已开始新的操作,丢弃过期基准
        dragBase = { winX: wx, winY: wy, curX: e.screenX, curY: e.screenY };
      } catch (_err) {
        dragBase = null;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!downPos) return;
      // 兜底:按钮已松开(如快速拖动时在窗口外松手,mouseup 事件会丢失)→
      // 立即结束拖动,防止桌宠一直跟在光标后面
      if (e.buttons === 0) { endDrag(false); return; }
      lastDragMove = performance.now();
      // 单位说明(Electron 35 + Windows 125% 缩放实测):
      // MouseEvent.screenX/screenY 与 window 坐标、screen.getCursorScreenPoint()
      // 同为 DIP(逻辑像素),直接相减即可,不要再除 devicePixelRatio ——
      // 否则窗口只按 1/dpr 比例移动,永远追不上光标(典型"不跟手")。
      const dx = e.screenX - downPos.x;
      const dy = e.screenY - downPos.y;
      if (!wasDrag && Math.hypot(dx, dy) > 4) wasDrag = true;
      if (wasDrag && dragBase) {
        // 计算"绝对目标":起始窗口位置 + 光标位移,而不是逐事件增量。
        // 每帧由 frame() 节流发送一次,窗口始终追到光标最新位置。
        pendingTarget = {
          x: dragBase.winX + (e.screenX - dragBase.curX),
          y: dragBase.winY + (e.screenY - dragBase.curY),
        };
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !downPos) return;
      const moved = Math.hypot(e.screenX - downPos.x, e.screenY - downPos.y);
      endDrag(!wasDrag && moved < 4, e.clientX, e.clientY);
    });
    // 拖动中窗口失焦(alt-tab / 点击其他窗口 / 右键菜单弹出)→ 取消拖动,防止状态卡死
    window.addEventListener('blur', () => {
      if (downPos) endDrag(false);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 菜单开着时:再次右键 = 关闭(注意 mousedown 已先关闭并记录时刻,
      // 紧随其后的 contextmenu 不能再把菜单重开)
      if (menuOpen || Date.now() - menuCloseByClickAt < 250) {
        closeMenu();
        return;
      }
      // 像素级穿透(鼠标穿透/描边模式):仅角色本体像素可打开菜单
      if (pixelThroughActive() && !outlineHitTest(e.clientX, e.clientY)) return;
      openMenu();
    });
    // 菜单是独立窗口,点击角色窗口任意处 = 关闭菜单(主进程菜单窗口失焦也会关)
    window.addEventListener('mousedown', () => {
      if (menuOpen) {
        menuCloseByClickAt = Date.now();
        closeMenu();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuOpen) closeMenu();
      if (e.key === 'F9') toggleBoundsDebug();
      if (e.key === 'F10') toggleOutlineMode();
    });
    // 调试边界模式:点击时记录命中标记
    el.addEventListener('mouseup', (e) => {
      if ((boundsDebug || outlineMode) && e.button === 0) {
        const hit = dbgHitTest(e.clientX, e.clientY);
        dbgHitMark = { x: e.clientX, y: e.clientY, hit };
      }
    });
    // 像素级穿透(鼠标穿透/描边模式):用 mousemove 实时判定鼠标是否落在角色本体上。
    // 注意:窗口 setIgnoreMouseEvents(true, {forward:true}) 时 mouseenter/mouseleave 不可靠,
    // 统一改用 mousemove 驱动(forward 会持续转发 mousemove 到页面)。
    window.addEventListener('mousemove', (e) => {
      if (testCursorLock) return; // 调试测试期间忽略真实鼠标,避免干扰断言
      lastCursor = { x: e.clientX, y: e.clientY };
      if (pixelThroughActive()) syncPixelInteractive();
    });
    document.addEventListener('mouseleave', () => {
      if (pixelThroughActive()) {
        lastCursor = null;
        syncPixelInteractive();
      }
    });
    // 主进程轮询兜底:Electron 在 Windows 上 forward 转发的 mousemove 不可靠
    // (electron#33281/#30808,某些窗口聚焦时收不到转发),主进程每 100ms 轮询
    // 真实光标位置并换算为窗口内坐标发过来,这里复用同一套像素命中判定,
    // 保证鼠标穿透/描边模式的交互状态始终跟随真实光标。
    API.onCursorPoll((pos) => {
      if (testCursorLock) return; // 调试测试期间锁定,避免干扰断言
      if (!pixelThroughActive()) return;
      lastCursor = { x: pos.x, y: pos.y };
      syncPixelInteractive();
    });
    // 场景互动(打字/点击/滑鼠/CPU/媒体):由主进程传感器聚合后送入
    API.onSceneEvent(onSceneEvent);
  }

  // ================= 加载(技术资料 §7 管线) =================
  async function loadTextureFromBlob(blob) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // 图集 Body 区域底部越界 1px(1148+901=2049 > 2048),扩展画布 2px 容纳
        const pad = 2;
        const c = document.createElement('canvas');
        c.width = img.width + pad;
        c.height = img.height + pad;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        resolve(PIXI.BaseTexture.from(c));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(new Blob([blob], { type: 'image/png' }));
    });
  }

  async function loadSpine() {
    const [skelBuf, atlasText, pngBuf] = await Promise.all([
      API.readAsset('assets-v1/CharacterJobSpine010001001.skel'),
      API.readAsset('assets-v1/CharacterJobSpine010001001.atlas').then((b) => new TextDecoder().decode(b)),
      API.readAsset('assets-v1/CharacterJobSpine010001001.png'),
    ]);

    // ① 二进制 → JSON(原版转换器)
    const converter = new spine.SkeletonJsonConverter(new Uint8Array(skelBuf), 1);
    converter.convertToJson();
    const rawData = converter.json;
    dlog('[load] 转换完成: ' + rawData.bones.length + ' 骨骼, ' + rawData.slots.length + ' 槽位, ' +
      Object.keys(rawData.animations).length + ' 动画');

    // 预计算动画时长(秒):遍历各动画关键帧的最大 time,供"交互锁"(后摇)使用
    ANIM_DUR = {};
    for (const animName of Object.keys(rawData.animations)) {
      let max = 0;
      const walk = (o) => {
        for (const k in o) {
          const v = o[k];
          if (Array.isArray(v)) {
            for (const f of v) {
              if (f && typeof f === 'object' && typeof f.time === 'number' && f.time > max) max = f.time;
            }
          } else if (v && typeof v === 'object') walk(v);
        }
      };
      walk(rawData.animations[animName]);
      ANIM_DUR[animName] = max;
    }

    // ② PIXI 应用
    // 清晰度修复:开启 devicePixelRatio 感知渲染(autoDensity+resolution)。
    // Windows 125%/150% 缩放下,画布后台缓冲按物理像素栅格化(resolution=dpr),
    // 元素 CSS 尺寸不变(autoDensity),避免"逻辑像素画布被 OS 拉大"导致的模糊。
    // canvasW/canvasH 始终按 CSS(逻辑)像素计算,由 renderer 统一换算后台缓冲。
    const dpr = window.devicePixelRatio || 1;
    app = new PIXI.Application({
      width: 480, height: 640,
      transparent: true,
      antialias: true,
      preserveDrawingBuffer: true,
      autoStart: true,
      resolution: dpr,
      autoDensity: true,
    });
    $('stage-anchor').appendChild(app.view); // 画布放进锚点容器(与画布同尺寸,底部居中)
    if (DEBUG) dlog('[load] devicePixelRatio=' + dpr + ' rendererRes=' + app.renderer.resolution);

    // ③ 图集
    const atlasLoaded = new Promise((resolve) => {
      window.__spineAtlas = new PIXI.spine.TextureAtlas(atlasText, (pageName, callback) => {
        loadTextureFromBlob(pngBuf).then((bt) => callback(bt));
      }, resolve);
    });
    await atlasLoaded;
    const spineAtlas = window.__spineAtlas;

    // ④ spine37 运行时解析
    const loader = new PIXI.spine.spine37.AtlasAttachmentLoader(spineAtlas);
    const parser = new PIXI.spine.spine37.SkeletonJson(loader);
    spineData = parser.readSkeletonData(rawData);
    dlog('[load] 解析完成: ' + spineData.animations.length + ' 个动画');

    // 修复:SkeletonJson 路径不会调用 updateRegion()/updateOffset(),region 附件 offset 全 0,
    // 导致 computeWorldVertices 顶点塌缩(SkeletonBinary 路径会自动做)。手动补齐。
    try {
      const s37 = PIXI.spine.spine37;
      let fixed = 0;
      for (const skin of spineData.skins) {
        for (const dict of skin.attachments || []) {
          if (!dict) continue;
          for (const name in dict) {
            const att = dict[name];
            if (!att) continue;
            if (att.updateRegion || att.updateOffset) {
              try {
                if (att.updateRegion) att.updateRegion();
                else att.updateOffset();
                fixed++;
              } catch (e) { /* 占位区域无 region,跳过 */ }
            }
          }
        }
      }
      dlog('[load] region offset 补齐: ' + fixed + ' 个附件');
    } catch (e) { dlog('[load] region offset 补齐异常: ' + e.message); }

    // ⑤ Spine 显示对象
    lilySpine = new PIXI.spine.Spine(spineData);
    app.stage.addChild(lilySpine);
    if (DEBUG) window.__lilySpine = lilySpine; // 调试:主进程可查询

    // ⑥ 先播待机动画,再按动画姿态对齐脚底(避免 setup pose 与动画姿态差异)
    lilySpine.state.setAnimation(0, '01BaseLoop', true);
    lilySpine.state.update(0.05);
    lilySpine.skeleton.updateWorldTransform();

    await applyFit();

    setEmotion(0);
    scheduleBlink();
  }

  // ================= 主循环 =================
  let lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    if (!lilySpine) return;
    const dt = clamp((t - lastT) / 1000, 0, 0.1);
    lastT = t;

    // 拖动节流:每帧至多发送一次窗口目标位置(绝对坐标,自纠正;位置没变则跳过)。
    // 鼠标事件频率(可达 1000Hz)远高于帧率,逐事件 IPC 会让主进程消息积压,
    // 造成"光标停下窗口还在滑"的滞后;按帧合并只发最新位置即可完全跟手。
    if (pendingTarget) {
      const pt = pendingTarget;
      pendingTarget = null;
      if (!lastDragSent || lastDragSent[0] !== pt.x || lastDragSent[1] !== pt.y) {
        lastDragSent = [pt.x, pt.y];
        API.dragMove(pt.x, pt.y);
      }
    }

    if (mode === MODE.IDLE) {
      idleElapsed += dt;
      if (idleElapsed > 120 && !menuOpen) { idleElapsed = 0; enterSleep(); }
    } else if (mode === MODE.REACT) {
      // 队列回到 01BaseLoop 后恢复待机
      const track = lilySpine.state.getCurrent(0);
      if (track && track.animation.name === '01BaseLoop') {
        mode = MODE.IDLE;
        idleElapsed = 0;
      }
    }

    if (boundsDebug) updateBoundsOverlay();
    // 卡死拖动兜底:若 mouseup 丢失且 mousemove 不再到达(穿透状态下转发不可靠),
    // downPos 会残留并强制窗口保持可交互("鼠标穿透失效")。按时间强制收尾:
    // 拖动中 2 秒无移动事件 / 按下后 4 秒未移动 → 结束拖动。
    if (downPos) {
      const now = performance.now();
      if (wasDrag && now - lastDragMove > 2000) endDrag(false);
      else if (!wasDrag && now - downTime > 4000) endDrag(false);
    }
    // 像素级穿透:实时按鼠标位置开关窗口交互(透明区穿透,角色本体可交互)
    if (pixelThroughActive()) syncPixelInteractive();
  }

  // ================= 调试边界覆盖层(F9 / --debug-shot bounds) =================
  // 用途:可视化模型整体范围与可触控区域,点击测试命中
  let boundsDebug = false;
  let dbgCanvas = null, dbgCtx = null, dbgInfo = null;
  let dbgRawBuf = null;      // readPixels 原始缓冲(专用,避免与翻转缓冲互相覆盖)
  let dbgPixBuf = null;      // 翻转后缓冲(左上角原点,供显示/命中测试)
  let dbgPixW = 0, dbgPixH = 0;
  let dbgHitMark = null;     // {x, y, hit}
  let dbgLastSample = 0;

  function toggleBoundsDebug() {
    boundsDebug = !boundsDebug;
    const ov = $('debug-overlay');
    ov.classList.toggle('hidden', !boundsDebug);
    if (boundsDebug && !dbgCanvas) {
      dbgCanvas = $('debug-canvas');
      dbgCtx = dbgCanvas.getContext('2d');
      dbgInfo = $('debug-info');
    }
    if (boundsDebug) {
      dlog('[bounds] 调试边界已开启,点击角色可测试命中');
      showBubble('🔍 边界调试已开启(按 F9 关闭)', 2600);
    }
  }

  // 后台缓冲实际像素数:renderer.width/height 在 pixi v5 中返回 view.width/height,
  // 即画布后台缓冲尺寸(已含 resolution 缩放),不要再乘 resolution,否则双重放大。
  function rendererBackPixW() { return app.renderer.width; }
  function rendererBackPixH() { return app.renderer.height; }

  function sampleModelPixels() {
    try {
      const gl = app.renderer.gl;
      const w = rendererBackPixW(), h = rendererBackPixH();
      // 原始缓冲与翻转缓冲必须分离:readPixels 直接写入 dbgRawBuf,
      // 翻转时从 dbgRawBuf 读到 dbgPixBuf,两者绝不共用同一块内存,
      // 否则 set(subarray) 自覆盖会污染后半段(表现为上下镜像/偏移)。
      if (!dbgRawBuf || dbgRawBuf.length !== w * h * 4) dbgRawBuf = new Uint8Array(w * h * 4);
      if (!dbgPixBuf || dbgPixW !== w || dbgPixH !== h) {
        dbgPixBuf = new Uint8Array(w * h * 4);
        dbgPixW = w; dbgPixH = h;
      }
      // 先渲染当前帧再读取,保证拿到最新画面
      app.renderer.render(app.stage);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, dbgRawBuf);
      // WebGL 原点在左下角,翻转为左上角(y 向下),与画布坐标一致
      const raw = dbgRawBuf, out = dbgPixBuf;
      for (let y = 0; y < h; y++) {
        const srcRow = (h - 1 - y) * w * 4;
        const dstRow = y * w * 4;
        out.set(raw.subarray(srcRow, srcRow + w * 4), dstRow);
      }
      return true;
    } catch (e) {
      dlog('[bounds] 像素采样失败: ' + e.message);
      return false;
    }
  }

  // 计算模型实际像素包围盒(不透明像素)与可视形状
  function modelPixelBounds() {
    if (!dbgPixBuf) return null;
    const w = dbgPixW, h = dbgPixH, buf = dbgPixBuf;
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (buf[row + x * 4 + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (!count) return null;
    return { minX, minY, maxX, maxY, count };
  }

  // 命中测试:某点(窗口坐标)是否落在模型可见像素上
  function dbgHitTest(cx, cy) {
    if (!dbgPixBuf) return false;
    const cv = app.view;
    const r = cv.getBoundingClientRect();
    const px = Math.round((cx - r.left) / r.width * dbgPixW);
    const py = Math.round((cy - r.top) / r.height * dbgPixH);
    if (px < 0 || py < 0 || px >= dbgPixW || py >= dbgPixH) return false;
    return dbgPixBuf[(py * dbgPixW + px) * 4 + 3] > 20;
  }

  // 找模型上的一个可靠点(后台坐标):取包围盒中心列,取该列模型跨度的中点。
  // 不要用包围盒中心/质心/顶部像素:前两者可能落在身体与武器间的透明缝隙,
  // 顶部像素在边界上,取整误差会落到透明像素上。
  function modelCenterHit() {
    if (!dbgPixBuf) return null;
    const w = dbgPixW, h = dbgPixH, buf = dbgPixBuf;
    const pb = modelPixelBounds();
    if (!pb) return null;
    const cx = Math.round((pb.minX + pb.maxX) / 2);
    let top = -1, bottom = -1;
    for (let y = 0; y < h; y++) {
      if (buf[(y * w + cx) * 4 + 3] > 20) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) return null;
    return { x: cx, y: Math.round((top + bottom) / 2) };
  }

  // 画网格标尺(可选,当前未启用)
  function drawGrid(cw, ch) {
    const ctx = dbgCtx;
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.18)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= cw; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
    }
    for (let gy = 0; gy <= ch; gy += 40) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
    }
  }

  function updateBoundsOverlay() {
    if (!boundsDebug || !dbgCtx) return;
    const now = performance.now();
    // 每 200ms 重新采样像素(动画中角色在动)
    ensurePixelSample();
    const cw = canvasW, ch = canvasH;
    dbgCanvas.width = cw;
    dbgCanvas.height = ch;
    // 覆盖层画布固定为逻辑尺寸;位置由 #stage-anchor 锚定(与画布同尺寸、底部居中),
    // 窗口尺寸被系统 ±1px 取整时线框仍与模型对齐,不会被放大/漂移
    dbgCanvas.style.width = cw + 'px';
    dbgCanvas.style.height = ch + 'px';
    const ctx = dbgCtx;
    ctx.clearRect(0, 0, cw, ch);

    // 1) 模型像素包围盒(绿色实线)+ 形状蒙版(半透明绿)
    const pb = modelPixelBounds();
    if (pb) {
      // 后台缓冲坐标 → 逻辑画布坐标(÷resolution),否则 DPI>1 时框会比模型大
      const res = app.renderer.resolution || 1;
      const bx = pb.minX / res, by = pb.minY / res;
      const bw = (pb.maxX - pb.minX) / res, bh = (pb.maxY - pb.minY) / res;
      // 蒙版:一次构建 ImageData(alpha>20 → 半透明绿)
      const imgData = ctx.createImageData(cw, ch);
      const src = dbgPixBuf;
      const kx = dbgPixW / cw, ky = dbgPixH / ch;
      for (let y = 0; y < ch; y++) {
        const sy = Math.min(dbgPixH - 1, Math.floor((y + 0.5) * ky));
        const sRow = sy * dbgPixW * 4;
        const dRow = y * cw * 4;
        for (let x = 0; x < cw; x++) {
          const sx = Math.min(dbgPixW - 1, Math.floor((x + 0.5) * kx));
          if (src[sRow + sx * 4 + 3] > 20) {
            const di = dRow + x * 4;
            imgData.data[di] = 90;
            imgData.data[di + 1] = 255;
            imgData.data[di + 2] = 130;
            imgData.data[di + 3] = 70;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      // 包围盒(逻辑坐标)
      ctx.strokeStyle = 'rgba(90, 255, 130, 0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(90, 255, 130, 0.95)';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(`像素范围 ${Math.round(bw)}×${Math.round(bh)} px(可触控)`, bx, Math.max(14, by - 6));
    }

    // 3) 附件/骨骼边界(红色虚线,模型理论范围)—— 加上 lilySpine 的屏幕偏移
    const rb = computeRenderBounds();
    if (rb) {
      const rx = lilySpine.x + rb.minX * charScale;
      const ry = lilySpine.y + rb.minY * charScale;
      const rw = (rb.maxX - rb.minX) * charScale;
      const rh = (rb.maxY - rb.minY) * charScale;
      ctx.setLineDash([8, 5]);
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 90, 90, 0.95)';
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(`附件范围 ${Math.round(rw)}×${Math.round(rh)} px(理论)`, Math.max(2, rx), Math.max(14, ry - 6));
      if (DEBUG && now - dbgLastSample > 200 && Math.random() < 0.05) dlog('[bounds] 附件框 px=(' + Math.round(rx) + ',' + Math.round(ry) + ') ' + Math.round(rw) + 'x' + Math.round(rh) + ' 超出画布=' + (rx < 0 || ry < 0 || rx + rw > cw || ry + rh > ch));
    }

    // 4) 点击命中标记
    if (dbgHitMark) drawHitMark(ctx);

    // 5) 信息面板(F9 边界调试专用;描边模式不显示)
    if (dbgInfo) {
      const res = app.renderer.resolution || 1;
      dbgInfo.style.display = ''; // 恢复可见(可能被描边模式隐藏过)
      dbgInfo.innerHTML =
        '<b>⚙ 边界调试 (F9 关闭)</b>\n' +
        `窗口(可交互区域): <b>${cw} × ${ch}</b> px\n` +
        `像素范围(绿框): <b>${pb ? Math.round((pb.maxX - pb.minX) / res) + ' × ' + Math.round((pb.maxY - pb.minY) / res) : '—'}</b> px\n` +
        `附件范围(红框): <b>${rb ? Math.round((rb.maxX - rb.minX) * charScale) + ' × ' + Math.round((rb.maxY - rb.minY) * charScale) : '—'}</b> px\n` +
        '\n🖱 点击角色:黄圈 = 命中(点中模型本身)\n' +
        '红圈 = 透明区域(仍会触发窗口交互)\n' +
        '整个窗口都可点击/拖动,但只有绿色区域\n' +
        '才是“真正点到角色模型”的范围\n' +
        '\n💡 按 F10 可切换到“仅本体可交互、透明区穿透”的描边模式';
    }
  }

  // ================= 描边交互模式(F10 / --debug-shot outline) =================
  // 仅角色本体像素可交互,透明区域点击穿透到下方窗口(无任何视觉元素显示)。
  // 默认开启(配置 outline:true,首次启动即生效,关闭后重启沿用上次选择)
  let outlineMode = false;

  function toggleOutlineMode() {
    outlineMode = !outlineMode;
    const ov = $('debug-overlay');
    // 描边模式本身不显示任何覆盖层(无描边/无弹窗);覆盖层只属于 F9 边界调试
    ov.classList.toggle('hidden', !boundsDebug);
    if (outlineMode && !dbgCanvas) {
      dbgCanvas = $('debug-canvas');
      dbgCtx = dbgCanvas.getContext('2d');
      dbgInfo = $('debug-info');
    }
    // 通知主进程:描边模式下透明区域点击穿透到下方窗口
    API.setOutline(outlineMode);
    // 持久化开关状态(F10 / 菜单切换后重启沿用)
    API.setConfig({ outline: outlineMode });
    if (outlineMode) {
      dlog('[outline] 描边模式已开启:仅角色本体可交互,透明区域点击穿透(按 F10 关闭)');
    } else {
      dlog('[outline] 描边模式已关闭');
    }
    syncPixelInteractive();
  }

  // 命中测试:某点(窗口坐标)是否落在角色本体像素上
  // 供描边模式的交互过滤使用
  function outlineHitTest(cx, cy) {
    // 确保有最新像素采样(200ms 节流)
    ensurePixelSample();
    return dbgHitTest(cx, cy);
  }

  // ================= 像素级穿透(鼠标穿透 / 描边模式共用) =================
  // 让透明区域的点击真正穿透到下方窗口:
  //   - 鼠标落在透明像素 → 窗口忽略鼠标事件(forward 转发 mousemove)→ 点击直达下层窗口
  //   - 鼠标落在角色本体像素 → 窗口恢复交互(可点击/拖动/开菜单)
  // 用 mousemove 驱动而非 mouseenter/mouseleave(忽略鼠标事件期间 enter/leave 不可靠)
  let lastCursor = null;           // 最近一次鼠标位置(窗口坐标)
  let lastInteractiveSent = null;  // 最近一次上报给主进程的交互状态
  let lastInteractiveSync = 0;     // 上次同步时间(周期性强制上报,防状态漂移)
  let testCursorLock = false;      // 调试测试:锁定真实鼠标,改用直接赋值驱动

  function pixelThroughActive() {
    return config.clickThrough || outlineMode;
  }

  // 节流采样模型像素(动画中角色在动,200ms 内只采一次)
  function ensurePixelSample() {
    const now = performance.now();
    if (!dbgPixBuf || now - dbgLastSample > 200) {
      if (sampleModelPixels()) dbgLastSample = now;
    }
  }

  // 根据最近鼠标位置计算"是否落在可交互区域"(角色本体)并同步给主进程
  function syncPixelInteractive() {
    if (!pixelThroughActive()) return;
    // 全穿透模式(鼠标穿透开启):窗口恒忽略鼠标,本体也穿透,无需像素同步。
    // 托盘"移动宠物"临时交互(tempInteractive)期间恢复像素级交互。
    if (config.clickThrough && !tempInteractive) return;
    let hit = false;
    if (lastCursor) hit = outlineHitTest(lastCursor.x, lastCursor.y);
    if (downPos) hit = true; // 拖动过程中保持窗口可交互,避免拖飞时断交互
    const now = performance.now();
    const stale = now - lastInteractiveSync > 500; // 周期性强制上报,防止状态漂移
    if (hit !== lastInteractiveSent || stale) {
      lastInteractiveSent = hit;
      lastInteractiveSync = now;
      API.setInteractive(hit);
    }
  }

  // 绘制点击命中标记(黄圈=命中,红圈=未命中)
  function drawHitMark(ctx) {
    if (!dbgHitMark) return;
    const { x, y, hit } = dbgHitMark;
    ctx.strokeStyle = hit ? 'rgba(255, 230, 80, 1)' : 'rgba(255, 120, 120, 1)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y);
    ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16);
    ctx.stroke();
    ctx.fillStyle = hit ? 'rgba(255, 230, 80, 0.95)' : 'rgba(255, 120, 120, 0.95)';
    ctx.font = '12px Consolas, monospace';
    ctx.fillText((hit ? '✔ 命中角色' : '✘ 未命中(透明区)') + ` (${x}, ${y})`, x + 16, y - 10);
  }

  // ================= 初始化 =================
  async function init() {
    try {
      const di = await API.debugInfo();
      DEBUG = di.isDebug;
      DEBUG_TARGET = di.target;
      dlog('[init] 开始 debug=' + DEBUG + ' target=' + DEBUG_TARGET);

      config = Object.assign(config, await API.getConfig());
      userScale = config.scale || 1;
      dlog('[init] 配置 OK scale=' + userScale);

      // 描边模式默认开启:启动时按持久化配置激活(仅角色本体可交互,透明区点击穿透)
      if (config.outline && !outlineMode) toggleOutlineMode();

      if (!window.PIXI) throw new Error('PixiJS 未加载');
      dlog('[init] PIXI版本=' + (PIXI.VERSION || '?') + ' spine键=' + (PIXI.spine ? Object.keys(PIXI.spine).slice(0, 15).join(',') : '无') + ' pixi_spine键=' + (window.pixi_spine ? Object.keys(window.pixi_spine).slice(0, 15).join(',') : '无'));
      if (!window.spine || !window.spine.SkeletonJsonConverter) throw new Error('SkeletonJsonConverter 未加载');
      if (!PIXI.spine || !PIXI.spine.spine37) throw new Error('pixi-spine 未加载');

      await loadLines(); // 加载外部台词配置(lines.jsonc,缺失回退内置)
      await loadSpine();
      dlog('[init] 渲染就绪');

      setupMenuBridge();
      setupInteraction();
      syncPixelInteractive(); // 启动即同步一次穿透状态(持久化配置生效)

      $('loading').classList.add('hidden');
      lastT = performance.now();
      requestAnimationFrame(frame);

      const greeting = line('01_greeting');
      if (greeting) setTimeout(() => showBubble(greeting, 3800), 1200);
      scheduleEmote();

      if (DEBUG) {
        dlog('[debug] target = ' + DEBUG_TARGET);
        setTimeout(async () => {
          // 渲染稳定后复查实际边界,验证贴底
          try {
            const b2 = lilySpine.getBounds();
            dlog('[debug] 运行中 bounds y=' + b2.y.toFixed(1) + ' h=' + b2.height.toFixed(1) + ' 底部=' + (b2.y + b2.height).toFixed(1) + ' canvasH=' + canvasH);
          } catch (e2) { dlog('[debug] bounds 复查失败 ' + e2.message); }
        }, 1500);
        setTimeout(async () => {
          if (DEBUG_TARGET === 'menu') openMenu();
          else if (DEBUG_TARGET === 'menutest') { /* 菜单由主进程右键触发 */ }
          else if (DEBUG_TARGET === 'react') { onPetClick(); }
          else if (DEBUG_TARGET === 'attack') { lastClickTime = 0; onPetClick(); }
          else if (DEBUG_TARGET === 'sleep') enterSleep();
          else if (DEBUG_TARGET === 'talk') startTalk(4000);
          else if (DEBUG_TARGET === 'emotion') { setEmotion(2); showBubble('Anger 表情测试'); }
          else if (DEBUG_TARGET === 'motion') { playMotion('fun'); showBubble('Fun 动作测试'); }
          else if (DEBUG_TARGET === 'bounds') {
            if (!boundsDebug) toggleBoundsDebug();
            setTimeout(() => {
              // 模拟一次命中与一次未命中,方便截图验证
              sampleModelPixels();
              const pb = modelPixelBounds();
              if (pb) {
                const hitX = (pb.minX + pb.maxX) / 2, hitY = (pb.minY + pb.maxY) / 2;
                const cv = app.view.getBoundingClientRect();
                dbgHitMark = { x: cv.left + hitX / dbgPixW * cv.width, y: cv.top + hitY / dbgPixH * cv.height, hit: true };
                dlog('[bounds] 命中点 (' + Math.round(dbgHitMark.x) + ',' + Math.round(dbgHitMark.y) + ') 像素范围 ' + (pb.maxX - pb.minX) + 'x' + (pb.maxY - pb.minY) + ' 像素 ' + pb.count);
              }
            }, 500);
          }
          else if (DEBUG_TARGET === 'outline' || DEBUG_TARGET === 'outlinetest') {
            if (!outlineMode) toggleOutlineMode();
            setTimeout(() => {
              // 模拟命中测试:模型命中点(命中)与角落(未命中)
              sampleModelPixels();
              const pb = modelPixelBounds();
              const ct = modelCenterHit();
              if (pb && ct) {
                const cv = app.view.getBoundingClientRect();
                const hx = cv.left + ct.x / dbgPixW * cv.width, hy = cv.top + ct.y / dbgPixH * cv.height;
                const h1 = dbgHitTest(hx, hy);
                const m1 = dbgHitTest(cv.left + 2, cv.top + 2);
                dbgHitMark = { x: hx, y: hy, hit: h1 };
                dlog('[outline] 本体命中=' + h1 + ' 透明区域命中=' + m1 + ' 像素范围 ' + (pb.maxX - pb.minX) + 'x' + (pb.maxY - pb.minY) + ' 命中点=(' + Math.round(hx) + ',' + Math.round(hy) + ')');
              }
              // 暴露给主进程测试用:每次访问实时重采样,避免动画中旧点失效
              Object.defineProperty(window, '__outlineHitPoint', {
                configurable: true,
                get() {
                  sampleModelPixels();
                  const c2 = modelCenterHit();
                  const cv = app.view.getBoundingClientRect();
                  if (!c2) return { x: Math.round(cv.left + cv.width / 2), y: Math.round(cv.top + 50), w: cv.width, h: cv.height };
                  return { x: Math.round(cv.left + c2.x / dbgPixW * cv.width), y: Math.round(cv.top + c2.y / dbgPixH * cv.height), w: cv.width, h: cv.height };
                },
              });
            }, 500);
          }
          else if (DEBUG_TARGET === 'throughtest') {
            // 自动验证穿透状态机:
            //  - 鼠标穿透(clickThrough)= 全窗口穿透,透明区和本体都忽略鼠标
            //  - 描边模式(outline)= 像素级:透明区穿透,本体可交互
            // 通过主进程 ignoreState(win.isIgnoringMouseEvents 镜像)验证。
            await (async () => {
              const ignore = async (label) => {
                const v = await API.debugIgnore();
                dlog('[throughtest] ' + label + ' isIgnoringMouseEvents=' + v);
                return v;
              };
              testCursorLock = true; // 锁定真实鼠标,直接驱动 lastCursor,保证确定性
              await sleep(200);
              // 1) 通过配置路径开启鼠标穿透(与菜单开关同一代码路径)
              //    鼠标穿透 = 全窗口穿透:透明区和角色本体都穿透
              config.clickThrough = true;
              await API.setConfig({ clickThrough: true });
              lastCursor = null;
              syncPixelInteractive();
              await sleep(400);
              await ignore('开启穿透后(期望 true)');
              // 2) 模拟鼠标悬停在透明区域(左上角)
              lastCursor = { x: 4, y: 4 };
              syncPixelInteractive();
              await sleep(400);
              await ignore('透明区悬停(期望 true,点击应穿透到下方窗口)');
              // 3) 模拟鼠标移到角色本体(用模型命中点,保证点在模型上)
              //    全穿透模式下本体同样穿透 → 期望仍为 true
              sampleModelPixels();
              const pb = modelPixelBounds();
              const ct = modelCenterHit();
              let cx = -1, cy = -1;
              if (pb && ct) {
                const res = app.renderer.resolution || 1;
                cx = Math.round(ct.x / res);
                cy = Math.round(ct.y / res);
                dlog('[throughtest] 本体命中点=(' + cx + ',' + cy + ') 像素范围 ' + (pb.maxX - pb.minX) + 'x' + (pb.maxY - pb.minY));
                lastCursor = { x: cx, y: cy };
                syncPixelInteractive();
                await sleep(400);
                await ignore('本体悬停(期望 true —— 鼠标穿透=全穿透,本体也穿透)');
              }
              // 4) 关闭鼠标穿透(描边模式仍开启)→ 回到像素级交互:透明区穿透,本体可交互
              config.clickThrough = false;
              await API.setConfig({ clickThrough: false });
              lastCursor = null;
              syncPixelInteractive();
              await sleep(400);
              await ignore('关闭穿透后(期望 true,描边模式整体先穿透)');
              if (pb && ct) {
                lastCursor = { x: cx, y: cy };
                syncPixelInteractive();
                await sleep(400);
                await ignore('描边模式本体悬停(期望 false,可点击/拖动)');
                // 4b) 回到透明区
                lastCursor = { x: 4, y: 4 };
                syncPixelInteractive();
                await sleep(400);
                await ignore('描边模式透明区(期望 true)');
              }
              // 5) 关闭描边模式 → 完全可交互;测试结束恢复描边开关,不改持久化配置
              const outlineWasOn = outlineMode;
              if (outlineWasOn) toggleOutlineMode();
              lastCursor = null;
              syncPixelInteractive();
              await sleep(400);
              await ignore('全关后(期望 false)');
              if (outlineWasOn) toggleOutlineMode();
              testCursorLock = false;
              API.debugDone(); // 通知主进程自测完成,触发退出
            })();
          }
          else if (DEBUG_TARGET === 'dragbounds') {
            // 验证:拖动过程中边界框不应放大。用真实 DOM 事件(带 screenX/screenY)
            // 模拟与真人一致的拖动路径,逐步采样模型像素范围。
            if (!boundsDebug) toggleBoundsDebug();
            setTimeout(async () => {
              const report = async (label) => {
                sampleModelPixels();
                const p = modelPixelBounds();
                const pos = await API.getPosition();
                const bnd = await API.getBounds();
                const res = app.renderer.resolution || 1;
                dlog('[dragbounds] ' + label + ' 窗口=' + JSON.stringify(pos) + ' 尺寸=' + bnd.width + 'x' + bnd.height + ' 逻辑范围=' +
                  (p ? Math.round((p.maxX - p.minX) / res) + 'x' + Math.round((p.maxY - p.minY) / res) : 'null') +
                  ' 后台=' + dbgPixW + 'x' + dbgPixH + ' res=' + res);
              };
              sampleModelPixels();
              const pb0 = modelPixelBounds();
              const ct0 = modelCenterHit();
              if (!pb0 || !ct0) { dlog('[dragbounds] 采样失败'); return; }
              const res = app.renderer.resolution || 1;
              const cx = Math.round(ct0.x / res);
              const cy = Math.round(ct0.y / res);
              const pos0 = await API.getPosition();
              // 合成事件必须带 buttons(按下/拖动=1,松开=0),与真实鼠标一致
              const fire = (type, x, y, sx, sy) => window.dispatchEvent(new MouseEvent(type, { button: 0, buttons: type === 'mouseup' ? 0 : 1, clientX: x, clientY: y, screenX: sx, screenY: sy, bubbles: true }));
              await report('拖动前');
              // mousedown 需要派发到 #pet(监听器在其上)
              $('pet').dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: cx, clientY: cy, screenX: pos0[0] + cx, screenY: pos0[1] + cy, bubbles: true }));
              await sleep(100);
              // 快速拖动(近似真人拖动频率):16 步 × 40ms,每 4 步报告一次
              let sx = pos0[0] + cx, sy = pos0[1] + cy;
              for (let i = 1; i <= 16; i++) {
                sx += 10; sy += 5;
                fire('mousemove', cx + i * 10, cy + i * 5, sx, sy);
                if (i % 4 === 0) {
                  await sleep(60);
                  await report('拖动中#' + i);
                } else {
                  await sleep(40);
                }
              }
              fire('mouseup', cx + 160, cy + 80, sx, sy);
              await sleep(300);
              await report('拖动后');
            }, 400);
          }
          else if (DEBUG_TARGET === 'realdrag') {
            // 真实拖动诊断:开启边界调试后连续测量窗口尺寸/画布尺寸/采样范围,
            // 供外部(真实鼠标)拖拽时观察是否有任何一项在变大。
            if (!boundsDebug) toggleBoundsDebug();
            setTimeout(async () => {
              const res = app.renderer.resolution || 1;
              sampleModelPixels();
              const ct = modelCenterHit();
              const pos = await API.getPosition();
              // 输出模型命中点的屏幕物理坐标,供外部脚本驱动真实鼠标
              if (ct) {
                const px = Math.round((pos[0] + ct.x / res) * (window.devicePixelRatio || 1));
                const py = Math.round((pos[1] + ct.y / res) * (window.devicePixelRatio || 1));
                dlog('[realdrag] 目标屏幕物理坐标=(' + px + ',' + py + ') 窗口=' + JSON.stringify(pos) + ' client=' + Math.round(ct.x / res) + ',' + Math.round(ct.y / res));
              }
              const t0 = Date.now();
              while (Date.now() - t0 < 6000) {
                sampleModelPixels();
                const p = modelPixelBounds();
                const b = await API.getBounds();
                const cv = app.view.getBoundingClientRect();
                const ov = dbgCanvas.getBoundingClientRect();
                dlog('[realdrag] t=' + (Date.now() - t0) + 'ms 窗口=' + JSON.stringify(b) + ' winInner=' + window.innerWidth + 'x' + window.innerHeight +
                  ' cssRect=' + Math.round(cv.width) + 'x' + Math.round(cv.height) + ' overlay=' + Math.round(ov.width) + 'x' + Math.round(ov.height) +
                  ' 采样=' + (p ? (p.maxX - p.minX) + 'x' + (p.maxY - p.minY) : 'null') + ' 逻辑=' + (p ? Math.round((p.maxX - p.minX) / res) + 'x' + Math.round((p.maxY - p.minY) / res) : 'null'));
                await sleep(200);
              }
            }, 1500);
          }
          else if (DEBUG_TARGET === 'dpidiag') {            // 诊断:测量采样缓冲与模型实际渲染位置的映射关系(镜像/偏移/尺寸)
            setTimeout(async () => {
              const res = app.renderer.resolution || 1;
              const rowProfile = (label, buf, w, h) => {
                const parts = [];
                for (const y of [10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 990]) {
                  if (y >= h) continue;
                  let minX = -1, maxX = -1, cnt = 0;
                  const row = y * w * 4;
                  for (let x = 0; x < w; x++) {
                    if (buf[row + x * 4 + 3] > 20) { if (minX < 0) minX = x; maxX = x; cnt++; }
                  }
                  parts.push(y + ':' + (cnt ? minX + '-' + maxX + '(' + cnt + ')' : '空'));
                }
                dlog('[dpidiag]   ' + label + ' 行分布: ' + parts.join(' | '));
              };
              const report = (label) => {
                const rb = computeRenderBounds();
                sampleModelPixels();
                const p = modelPixelBounds();
                const cv = app.view.getBoundingClientRect();
                let exp = null;
                if (rb) {
                  exp = {
                    top: (lilySpine.y + rb.minY * charScale) * res,
                    bottom: (lilySpine.y + rb.maxY * charScale) * res,
                    left: (lilySpine.x + rb.minX * charScale) * res,
                    right: (lilySpine.x + rb.maxX * charScale) * res,
                  };
                }
                dlog('[dpidiag] ' + label);
                dlog('[dpidiag]   环境 renderer=' + app.renderer.width + 'x' + app.renderer.height + ' res=' + res +
                  ' view=' + app.view.width + 'x' + app.view.height + ' cssRect=' + Math.round(cv.width) + 'x' + Math.round(cv.height) +
                  ' win=' + window.innerWidth + 'x' + window.innerHeight + ' dpr=' + window.devicePixelRatio);
                dlog('[dpidiag]   期望(理论→后台): ' + (exp ? JSON.stringify({ top: Math.round(exp.top), bottom: Math.round(exp.bottom), left: Math.round(exp.left), right: Math.round(exp.right) }) : 'null'));
                dlog('[dpidiag]   采样(翻转后): ' + (p ? JSON.stringify({ top: p.minY, bottom: p.maxY, left: p.minX, right: p.maxX, w: p.maxX - p.minX, h: p.maxY - p.minY }) : 'null') + ' buf=' + dbgPixW + 'x' + dbgPixH);
                rowProfile('缓冲', dbgPixBuf, dbgPixW, dbgPixH);
                // 覆盖层画布实际像素(如果 bounds 调试已开启)
                if (dbgCtx && boundsDebug) {
                  const od = dbgCtx.getImageData(0, 0, dbgCanvas.width, dbgCanvas.height).data;
                  rowProfile('覆盖层', od, dbgCanvas.width, dbgCanvas.height);
                } else {
                  dlog('[dpidiag]   覆盖层未开启(boundsDebug=' + boundsDebug + ')');
                }
                // 原始未翻转采样,验证翻转方向
                try {
                  const gl = app.renderer.gl;
                  const raw = new Uint8Array(dbgPixW * dbgPixH * 4);
                  app.renderer.render(app.stage);
                  gl.readPixels(0, 0, dbgPixW, dbgPixH, gl.RGBA, gl.UNSIGNED_BYTE, raw);
                  rowProfile('原始GL', raw, dbgPixW, dbgPixH);
                } catch (e) { dlog('[dpidiag]   原始采样失败 ' + e.message); }
              };
              if (!boundsDebug) toggleBoundsDebug();
              await sleep(600);
              report('开启覆盖层后');
              await sleep(600);
              report('再采样');
            }, 500);
          }
        }, 1600);
      }
    } catch (e) {
      console.error('[init 失败]', e);
      dlog('[init 失败] ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e));
      const loading = $('loading');
      loading.innerHTML = '<div class="loading-text" style="color:#ffb3b3">初始化失败: ' + (e && e.message) + '</div>';
    }
  }

  init();
})();
