// 梨璃功能菜单 - 注册表驱动的模块化实现
// 结构:主菜单 → 二级列表 / 功能面板;增删功能只需维护 MENU_ITEMS 注册表
'use strict';
(() => {
  const API = window.menuAPI;
  const $ = (id) => document.getElementById(id);

  let state = null;              // 主进程注入的最新状态
  let history = [{ type: 'root' }]; // 导航栈:root / {type:'list',...} / {type:'panel',...}
  let closing = false;           // 关闭动画进行中(防重复触发)
  let closeTimer = null;         // 关闭动画结束后的隐藏请求(重开时需取消)
  let quitArmed = false;         // 退出二次确认
  let quitTimer = null;

  // ---------- 文案映射(菜单更可爱,未知键回退原名) ----------
  const EMOTION_CN = {
    Normal: '平常', Smile: '微笑', Anger: '生气', Sad: '难过', Surprise: '惊讶',
    Pain: '疼痛', Sleep: '睡觉', Shy: '害羞', Trouble: '困扰',
    HalfEye_Normal: '半眼·平常', HalfEye_Anger: '半眼·生气', HalfEye_Sad: '半眼·难过',
    Strong: '坚定', Ennui: '无聊', Close: '闭眼', Serious: '认真',
    Smile_L: '微笑·L', Surprise_L: '惊讶·L', Trouble_L: '困扰·L', Excite: '兴奋',
    Smile_Luna: '微笑·Luna', Surprise_Luna: '惊讶·Luna',
  };
  const MOTION_CN = {
    base: '待机', fun: '开心', anger: '生气', shy: '害羞', surprise: '惊讶',
    think: '思考', positive: '积极', negative: '消极',
    S_03: '姿势变化·S3', S_04: '姿势变化·S4', S_05: '姿势变化·S5',
    U_01: '动作·U1', U_02: '动作·U2',
  };
  // 动画翻译:基础名 → 中文(Loop/End 后缀在 animCN 中追加"循环/结束")
  const ANIM_BASE_CN = {
    '01Base': '待机',
    '02Fun': '开心', '03Anger': '生气', '04Shy': '害羞', '05Surprise': '惊讶',
    'S_01Think': '思考', 'S_02Positive': '积极', 'S_06Negative': '消极',
    'S_03PoseChange': '姿势变化·S3', 'S_04PoseChange': '姿势变化·S4', 'S_05PoseChange': '姿势变化·S5',
    'U_01PoseChange': '动作·U1', 'U_02PoseChange': '动作·U2',
  };
  // 动画名 → 中文(未知动画返回 null,界面回退显示原名)
  function animCN(name) {
    const base = name.replace(/(Loop|End)$/, '');
    const cn = ANIM_BASE_CN[base] || ANIM_BASE_CN[name];
    if (!cn) return null;
    const suf = /Loop$/.test(name) ? '循环' : (/End$/.test(name) ? '结束' : '');
    return cn + (suf ? ' ' + suf : '');
  }
  const SIZES = [
    { label: '小', value: 0.512 },
    { label: '中', value: 0.64 },
    { label: '大', value: 0.8 },
  ];

  // ---------- 通用工具 ----------
  function send(type, value) { API.action(type, value); }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // 播放关闭动画后请求主进程隐藏窗口
  function closeMenu() {
    if (closing) return;
    closing = true;
    const m = $('menu');
    m.classList.remove('open');
    m.classList.add('closing');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => API.close(), 130);
  }

  function emoName(i) {
    if (!state || !state.emotions || !state.emotions[i]) return '—';
    return EMOTION_CN[state.emotions[i]] || state.emotions[i];
  }

  // ---------- 菜单注册表(核心:增删功能只改这里) ----------
  // type:
  //   list   → children 渲染为二级列表(如 动作 → 表情/动作/动画)
  //   panel  → build(wrap) 渲染内容面板
  //   action → run() 直接执行(发指令 + 关闭)
  const MENU_ITEMS = [
    {
      id: 'actions', icon: '🎭', label: '动作',
      desc: '表情 / 动作 / 动画',
      type: 'list', children: [
        { id: 'emotion', icon: '😊', label: '表情', desc: '22 种表情实时切换', type: 'panel', build: buildEmotionPanel },
        { id: 'motion', icon: '💃', label: '动作', desc: '预设动作表演', type: 'panel', build: buildMotionPanel },
        { id: 'animation', icon: '📽️', label: '动画', desc: '全部 33 个游戏动画', type: 'panel', build: buildAnimationPanel },
      ],
    },
    { id: 'status', icon: '✨', label: '状态', desc: '当前表情·动画 / 描边·边界', type: 'panel', build: buildStatusPanel },
    { id: 'interact', icon: '💬', label: '交互', desc: '场景互动 / 鼠标穿透 / 置顶', type: 'panel', build: buildInteractPanel },
    { id: 'settings', icon: '⚙️', label: '设置', desc: '大小 / 自启 / 记数 / 台词', type: 'list', children: [
      { id: 'general', icon: '🛠️', label: '常规设置', desc: '角色大小 / 开机自启 / 记数模块', type: 'panel', build: buildSettingsPanel },
      { id: 'scenes', icon: '📝', label: '台词与场景', desc: '场景发言 / 互动冷却时长', type: 'panel', build: buildScenesPanel },
    ] },
    { id: 'theme', icon: '🎨', label: '主题', desc: '菜单与记数模块皮肤 / 动效强度', type: 'panel', build: buildThemePanel },
    { id: 'rest', icon: '🌙', label: '休息', desc: '隐藏到系统托盘', type: 'action', run: () => { send('hide'); closeMenu(); } },
    { id: 'quit', icon: '🚪', label: '退出', desc: '关闭桌宠程序', type: 'action', danger: true, run: confirmQuit },
  ];

  // ---------- 面板构建 ----------
  function panelHead(text) {
    const h = el('div', 'panel-head');
    h.appendChild(el('span', '', text));
    h.appendChild(el('span', 'ph-line'));
    return h;
  }

  // 表情:chips(中文名,英文名放悬停提示),点击实时切换且保持菜单打开(可连续预览)
  function buildEmotionPanel(wrap) {
    wrap.appendChild(panelHead('😊 选择表情'));
    const chips = el('div', 'chips');
    const list = (state && state.emotions) || [];
    list.forEach((name, i) => {
      const cn = EMOTION_CN[name];
      const c = el('div', 'chip' + (state && i === state.currentEmotion ? ' active' : ''), cn || name);
      c.title = name + (cn ? ' · ' + cn : '');
      c.onclick = () => {
        send('emotion', i);
        if (state) state.currentEmotion = i;
        chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
        updateStatus();
      };
      chips.appendChild(c);
    });
    wrap.appendChild(chips);
  }

  // 预设动作:chips,点击播放并关闭菜单
  function buildMotionPanel(wrap) {
    wrap.appendChild(panelHead('💃 预设动作'));
    const chips = el('div', 'chips');
    const list = (state && state.motions) || [];
    list.forEach((m) => {
      const c = el('div', 'chip', MOTION_CN[m.key] || m.name);
      c.title = m.key;
      c.onclick = () => { send('motion', m.key); closeMenu(); };
      chips.appendChild(c);
    });
    wrap.appendChild(chips);
  }

  // 动画:搜索(中英文均可) + 可滚动列表,行内显示「中文名 + 原名」,点击播放并关闭菜单
  function buildAnimationPanel(wrap) {
    wrap.appendChild(panelHead('📽️ 动画列表'));
    const search = el('div', 'search');
    const ico = el('span', 's-ico', '🔍');
    const input = el('input');
    input.type = 'text';
    input.placeholder = '搜索动画(中文/原名)…';
    search.appendChild(ico);
    search.appendChild(input);
    wrap.appendChild(search);
    const count = el('div', 'anim-count');
    const list = el('div', 'anim-list');
    wrap.appendChild(count);
    wrap.appendChild(list);
    const anims = (state && state.animations)
      ? state.animations.slice().sort((a, b) => a.name.localeCompare(b.name))
      : [];
    function renderList() {
      const kw = input.value.trim().toLowerCase();
      const hit = anims.filter((a) => {
        if (!kw) return true;
        const cn = animCN(a.name);
        return a.name.toLowerCase().includes(kw) || (cn && cn.toLowerCase().includes(kw));
      });
      count.textContent = '共 ' + hit.length + ' / ' + anims.length + ' 个动画';
      list.innerHTML = '';
      hit.forEach((a) => {
        const row = el('div', 'anim-row');
        const left = el('span', 'anim-name');
        const cn = animCN(a.name);
        if (cn) {
          left.appendChild(el('span', 'anim-cn', cn));
          left.appendChild(el('span', 'anim-en', a.name));
        } else {
          left.appendChild(el('span', '', a.name));
        }
        row.appendChild(left);
        row.appendChild(el('span', 'dur', (a.duration || 0).toFixed(2) + 's'));
        row.onclick = () => {
          send('animation', { name: a.name, loop: /Loop|Base/.test(a.name) });
          closeMenu();
        };
        list.appendChild(row);
      });
    }
    input.addEventListener('input', renderList);
    renderList();
  }

  // 状态:当前表情/动画 + 描边模式/边界调试
  function buildStatusPanel(wrap) {
    wrap.appendChild(panelHead('✨ 当前状态'));
    const info = el('div', 'chips');
    info.appendChild(el('span', 'chip', '表情 ' + emoName(state ? state.currentEmotion : 0)));
    info.appendChild(el('span', 'chip', '动画 ' + ((state && state.animNow) || '待机')));
    wrap.appendChild(info);
    wrap.appendChild(el('div', 'menu-sep'));
    const dbg = (state && state.debug) || {};
    wrap.appendChild(optRow('✏️ 描边模式', '仅本体可交互,透明区穿透 (F10)', 'outline', !!dbg.outline));
    wrap.appendChild(optRow('🔍 边界调试', '显示角色像素范围 (F9)', 'bounds', !!dbg.bounds));
  }

  // 交互:场景互动 / 鼠标穿透 / 总在最前
  function buildInteractPanel(wrap) {
    wrap.appendChild(panelHead('💬 交互设置'));
    const cfg = (state && state.config) || {};
    wrap.appendChild(optRow('🎭 场景互动', '感知打字/点击/滑鼠/CPU/媒体', 'sceneInteract', cfg.sceneInteract !== false));
    wrap.appendChild(optRow('🖱 鼠标穿透', '整个宠物不再挡鼠标', 'clickThrough', !!cfg.clickThrough));
    wrap.appendChild(optRow('📌 总在最前', '宠物始终置顶显示', 'alwaysOnTop', !!cfg.alwaysOnTop));
  }

  // ---------- 主题系统(作用于本菜单窗口 + 记数模块;角色窗口不参与) ----------
  // 主题目录从 renderer/themes/index.json 自行加载(主进程 state 只注入当前 theme/motionTier)
  let themeCatalog = [];        // [{id,name,desc,preview,layout}]
  let menuThemeApplied = null;  // 当前已注入的主题(null = 尚未应用过,首次含 default 也要注入)
  let menuTierApplied = 'light';

  async function loadThemeCatalog() {
    try {
      const buf = await API.readAsset('themes/index.json');
      const list = JSON.parse(new TextDecoder().decode(buf));
      if (Array.isArray(list)) themeCatalog = list;
    } catch (e) { /* 目录缺失 → 面板为空,不影响使用 */ }
  }

  // 应用主题皮肤:注入 themes/<id>.css 为 <style id="menu-theme">(id 白名单防路径穿越)
  async function applyMenuTheme(id) {
    if (!id || !/^[a-z0-9-]+$/.test(id)) id = 'default';
    if (id === menuThemeApplied) return;
    let css = '';
    const load = async (tid) => new TextDecoder().decode(await API.readAsset('themes/' + tid + '.css'));
    try {
      css = await load(id);
      menuThemeApplied = id;
    } catch (e) {
      try { css = await load('default'); menuThemeApplied = 'default'; } catch (e2) { /* 忽略 */ }
    }
    let style = document.getElementById('menu-theme');
    if (!style) {
      style = document.createElement('style');
      style.id = 'menu-theme';
      document.head.appendChild(style);
    }
    style.textContent = css;
    document.documentElement.dataset.theme = id;
    resizeWindow(); // 主题可能改变卡片观感,按内容校正窗口尺寸
  }

  // 动效强度:轻量(默认)/ 完整(主题 CSS 在 body.motion-full 下开启持续动画)
  function applyMenuTier(tier) {
    menuTierApplied = tier === 'full' ? 'full' : 'light';
    document.body.classList.toggle('motion-full', menuTierApplied === 'full');
    document.body.classList.toggle('motion-light', menuTierApplied !== 'full');
  }

  // 主题面板:皮肤列表(名称前带主色圆点) + 动效强度
  function buildThemePanel(wrap) {
    wrap.appendChild(panelHead('🎨 主题皮肤'));
    const chips = el('div', 'chips theme-chips');
    themeCatalog.forEach((t) => {
      const c = el('div', 'chip' + (state && state.theme === t.id ? ' active' : ''), t.name);
      c.title = (t.desc || '') + ' · ' + t.id;
      if (t.preview) c.style.setProperty('--swatch', t.preview);
      c.onclick = () => {
        applyMenuTheme(t.id);
        if (state) state.theme = t.id;
        chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
        send('theme', t.id); // 主进程持久化 + 记数模块换肤
      };
      chips.appendChild(c);
    });
    wrap.appendChild(chips);
    wrap.appendChild(el('div', 'menu-sep'));
    const tierRow = el('div', 'opt-row');
    const tinfo = el('div', 'opt-info');
    tinfo.appendChild(el('div', 'opt-label', '💨 动效强度'));
    tinfo.appendChild(el('div', 'opt-desc', '轻量:省电安静 / 完整:高表现力'));
    tierRow.appendChild(tinfo);
    wrap.appendChild(tierRow);
    const seg = el('div', 'seg');
    const curTier = (state && state.motionTier) || 'light';
    [['轻量', 'light'], ['完整', 'full']].forEach((pair) => {
      const b = el('button', 'seg-btn' + (pair[1] === curTier ? ' active' : ''), pair[0]);
      b.onclick = () => {
        applyMenuTier(pair[1]);
        if (state) state.motionTier = pair[1];
        seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
        send('motionTier', pair[1]);
      };
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    wrap.appendChild(el('div', 'theme-tip', '💡 主题只换皮肤:组件尺寸/行数/窗口大小保持不变,角色外观不变'));
  }

  // 设置:角色大小(小/中/大) + 开机自启 + 记数模块
  function buildSettingsPanel(wrap) {
    wrap.appendChild(panelHead('⚙️ 设置'));
    const sizeRow = el('div', 'opt-row');
    const info = el('div', 'opt-info');
    info.appendChild(el('div', 'opt-label', '角色大小'));
    info.appendChild(el('div', 'opt-desc', '窗口与角色同步缩放'));
    sizeRow.appendChild(info);
    wrap.appendChild(sizeRow);
    const seg = el('div', 'seg');
    const cur = (state && state.config.scale) || 0.64;
    SIZES.forEach((s) => {
      const b = el('button', 'seg-btn' + (s.value === cur ? ' active' : ''), s.label);
      b.onclick = () => {
        send('size', s.value);
        if (state) state.config.scale = s.value;
        seg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      };
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    const cfg = (state && state.config) || {};
    wrap.appendChild(optRow('🔄 开机自启', '随 Windows 启动', 'autoLaunch', !!cfg.autoLaunch));
    const cnt = (state && state.counter) || {};
    wrap.appendChild(optRow('📊 记数模块', '脚边显示键盘击键计数', 'counterShow', cnt.enabled !== false));
    // 记数周期:今日/本周/本月/总计
    const periodRow = el('div', 'opt-row');
    const pinfo = el('div', 'opt-info');
    pinfo.appendChild(el('div', 'opt-label', '📅 记数周期'));
    pinfo.appendChild(el('div', 'opt-desc', '模块显示哪个周期的击键数'));
    periodRow.appendChild(pinfo);
    wrap.appendChild(periodRow);
    const pseg = el('div', 'seg');
    const PERIODS = [
      { label: '今日', value: 'today' },
      { label: '本周', value: 'week' },
      { label: '本月', value: 'month' },
      { label: '总计', value: 'total' },
    ];
    const curPeriod = cnt.period || 'today';
    PERIODS.forEach((p) => {
      const b = el('button', 'seg-btn' + (p.value === curPeriod ? ' active' : ''), p.label);
      b.onclick = () => {
        send('counterPeriod', p.value);
        if (state) {
          if (!state.counter) state.counter = {};
          state.counter.period = p.value;
        }
        pseg.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      };
      pseg.appendChild(b);
    });
    wrap.appendChild(pseg);
  }

  // 台词与场景(内置场景编辑器):数据与 UI 见 scene-editor.js / scene-panel.js
  function buildScenesPanel(wrap) {
    if (window.ScenePanel) window.ScenePanel.build(wrap);
    else wrap.appendChild(el('div', 'theme-tip', '⚠ 场景编辑器未加载'));
  }

  // 开关行:点击切换并发送动作,本地状态同步
  function optRow(iconLabel, desc, key, value) {
    const row = el('div', 'opt-row');
    const info = el('div', 'opt-info');
    info.appendChild(el('div', 'opt-label', iconLabel));
    info.appendChild(el('div', 'opt-desc', desc));
    const sw = el('div', 'switch' + (value ? ' on' : ''));
    row.appendChild(info);
    row.appendChild(sw);
    row.onclick = () => {
      const next = !sw.classList.contains('on');
      sw.classList.toggle('on', next);
      send('toggle', { key, value: next });
      if (state) {
        if (key === 'counterShow') {
          if (!state.counter) state.counter = {};
          state.counter.enabled = next;
        } else if (key === 'outline' || key === 'bounds') state.debug[key] = next;
        else state.config[key] = next;
      }
    };
    return row;
  }

  // 退出:两次点击确认,防止误触
  function confirmQuit() {
    if (!quitArmed) {
      quitArmed = true;
      const lab = document.querySelector('.menu-item.danger .item-label');
      const span = lab && lab.querySelector('span');
      if (span) span.textContent = '再点一次确认退出?';
      clearTimeout(quitTimer);
      quitTimer = setTimeout(() => { quitArmed = false; render(); }, 2600);
      return;
    }
    send('quit');
    closeMenu();
  }

  // ---------- 列表 / 根视图 ----------
  function buildItem(item, isRoot) {
    const btn = el('button', 'menu-item' + (item.danger ? ' danger' : ''));
    btn.appendChild(el('span', 'item-icon', item.icon));
    const lab = el('span', 'item-label');
    lab.appendChild(el('span', '', item.label));
    if (item.desc && isRoot) lab.appendChild(el('div', 'item-desc', item.desc));
    btn.appendChild(lab);
    if (item.type !== 'action') btn.appendChild(el('span', 'item-chev', '›'));
    btn.onclick = () => {
      if (item.type === 'action') item.run();
      else if (item.type === 'list') push({ type: 'list', title: item.icon + ' ' + item.label, items: item.children });
      else push({ type: 'panel', title: item.icon + ' ' + item.label, build: item.build });
    };
    return btn;
  }

  function buildRootList(wrap) {
    const list = el('div');
    MENU_ITEMS.forEach((item, i) => {
      if (i === 5) list.appendChild(el('div', 'menu-sep')); // 休息/退出前分隔
      list.appendChild(buildItem(item, true));
    });
    wrap.appendChild(list);
  }

  function buildList(wrap, items) {
    const list = el('div');
    items.forEach((item) => list.appendChild(buildItem(item, false)));
    wrap.appendChild(list);
  }

  // ---------- 导航 ----------
  function push(entry) { history.push(entry); render(); }
  function pop() { if (history.length > 1) { history.pop(); render(); } }

  // ---------- 渲染 ----------
  function render() {
    const view = $('menu-view');
    const back = $('btn-back');
    const titleEl = $('menu-title');
    const cur = history[history.length - 1];
    back.classList.toggle('hidden', history.length <= 1);
    titleEl.textContent = cur.title || '🍀 梨璃的功能菜单';
    view.innerHTML = '';
    const wrap = el('div', 'view');
    if (cur.type === 'root') buildRootList(wrap);
    else if (cur.type === 'list') buildList(wrap, cur.items);
    else cur.build(wrap);
    view.appendChild(wrap);
    updateStatus();
    resizeWindow();
  }

  function updateStatus() {
    $('status-emotion').innerHTML = '表情 <b>' + emoName(state ? state.currentEmotion : 0) + '</b>';
    $('status-anim').innerHTML = '动画 <b>' + ((state && state.animNow) || '待机') + '</b>';
  }

  // 窗口自适应内容:卡片尺寸 + 实际 body 透明边距(贴脸侧边距更小,需按计算值精确上报)
  function resizeWindow() {
    const card = $('menu');
    requestAnimationFrame(() => {
      const bs = getComputedStyle(document.body);
      const pl = parseFloat(bs.paddingLeft) || 0;
      const pr = parseFloat(bs.paddingRight) || 0;
      const pt = parseFloat(bs.paddingTop) || 0;
      const pb = parseFloat(bs.paddingBottom) || 0;
      const w = Math.ceil(card.offsetWidth + pl + pr);
      const h = Math.ceil(card.offsetHeight + pt + pb);
      API.resize(w, h);
    });
  }
  // 异步面板(台词与场景)加载完成后需要校正窗口尺寸,暴露给 scene-panel.js
  window.__menuResize = resizeWindow;

  // ---------- 事件 ----------
  $('btn-close').onclick = closeMenu;
  $('btn-back').onclick = pop;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
  // 菜单内右键不弹出系统菜单
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 主进程请求关闭(失焦 / 点击角色 / 再次右键 / Esc) → 播放关闭动画
  API.onCloseRequest(() => { closeMenu(); });

  // 状态注入:每次打开菜单都会收到 → 重建界面并重放弹出动画
  function applyState(st) {
    state = st;
    // 取消上一次关闭流程的残留(重开时旧的关闭动画/隐藏请求必须作废)
    clearTimeout(closeTimer);
    closeTimer = null;
    closing = false;
    history = [{ type: 'root' }];
    quitArmed = false;
    // 同步主题皮肤与动效强度(由主进程注入 state.theme / state.motionTier)
    applyMenuTheme((st && st.theme) || 'default');
    applyMenuTier((st && st.motionTier) || 'light');
    // 贴脸侧:菜单在角色左侧 → 右缘贴近;在右侧 → 左缘贴近
    document.body.classList.toggle('side-left', st && st.side === 'left');
    document.body.classList.toggle('side-right', st && st.side === 'right');
    const m = $('menu');
    m.classList.remove('closing');
    render();
    // 重启弹出动画(窗口每次显示都弹一次)
    m.classList.remove('open');
    void m.offsetWidth;
    m.classList.add('open');
  }

  // 打开时主进程推送状态;冷启动时推送可能早于监听器注册而丢失,主动拉取兜底。
  // 页面已加载后的再次打开:推送先到,拉取(早已解析)不会重复应用。
  let pushReceived = false;
  API.onState((st) => { pushReceived = true; applyState(st); });
  API.getState().then((st) => {
    if (st && !pushReceived) applyState(st);
  }).catch(() => { /* 拉取不可用时忽略 */ });

  // 初始骨架(状态到达前)
  render();
  loadThemeCatalog(); // 主题目录异步加载(主题面板构建时读取)
})();
