// 突击莉莉桌宠 - Electron 主进程
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const IS_DEBUG = process.argv.includes('--debug-shot');
const DEBUG_TARGET = (() => {
  const i = process.argv.indexOf('--debug-shot');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
})();

const ASSETS = path.join(__dirname, 'renderer', 'assets');
const RENDERER_DIR = path.join(__dirname, 'renderer');
const CONFIG_PATH = path.join(app.getPath('userData'), 'pet-config.json');

const DEFAULT_CONFIG = {
  scale: 0.64,              // 倍率(按钮 小/中/大 = 0.512 / 0.64 / 0.8,角色高度 = 工作区高×0.70×倍率)
  alwaysOnTop: true,
  clickThrough: false,
  autoLaunch: false,
  outline: true,            // 描边模式(默认开启):仅角色本体可交互,透明区域点击穿透
  sceneInteract: true,      // 场景互动(感知打字/点击/滑鼠/CPU/媒体 → 台词反应)
  theme: 'default',         // 主题皮肤(作用于右键功能菜单窗口 + 记数模块): default / academy-01 / tactical-02 / garden-03 / holo-05 / taisho-06
  motionTier: 'light',      // 动效强度(菜单窗口): light 轻量(默认) / full 完整
  x: null,                  // 窗口位置(屏幕坐标)
  y: null,
};

let config = loadConfig();
let win = null;
let tray = null;
let quitting = false;
let outlineMode = false; // 主进程侧描边模式镜像(像素级穿透:透明区点击透传到下层窗口)

function loadConfig() {
  let cfg;
  try {
    cfg = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    cfg = { ...DEFAULT_CONFIG };
  }
  // 尺寸档位迁移:旧档位 小/中/大 = 0.8 / 1 / 1.25,
  // 新档位 小/中/大 = 0.512 / 0.64 / 0.8(新的最大档 = 原来的最小档 0.8)。
  // 0.8 本来就是新档位的"大",无需迁移;旧"中"(1)落到新"中"(0.64),
  // 旧"大"(1.25)落到新"大"(0.8)。
  const legacy = { 1: 0.64, 1.25: 0.8 };
  if (Object.prototype.hasOwnProperty.call(legacy, cfg.scale)) cfg.scale = legacy[cfg.scale];
  return cfg;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('保存配置失败:', e);
  }
}

function clampToWorkArea(x, y, w, h) {
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - h));
  return { x, y };
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 480,
    height: 560,
    x: config.x ?? Math.round(sw - 480 - 60),
    y: config.y ?? Math.round(sh - 560 - 40),
    transparent: true,
    frame: false,
    resizable: false,
    movable: false, // 我们用 IPC 移动,避免系统拖拽
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
  // 无边框窗口失焦时 Windows 会自动补画蓝色标题栏(WM_NCACTIVATE)。
  // setBackgroundColor 只改客户区,无法清除系统在非客户区绘制的标题栏,
  // 必须用 setOpacity 微调强制 DWM 重新合成窗口(0.0001 透明度变化视觉不可见)。
  win.setTitle(' ');

  // 强制 DWM 重绘当前窗口(清除系统补画的非活动标题栏)
  const forceRepaint = () => {
    if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
    win.setOpacity(0.9999);
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.setOpacity(1);
    }, 5);
  };
  const resetTransparentBg = () => {
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      win.setBackgroundColor('#00000000');
    }
  };
  const clearTitleBar = () => {
    resetTransparentBg();
    forceRepaint();
  };
  // WndProc 层:收到 WM_NCACTIVATE(非客户区激活状态变化)时同步重置透明背景
  // (此处只做轻量操作;opacity 强制重绘在 blur 事件中做,避免消息上下文复杂操作)
  try {
    win.hookWindowMessage(0x0086, () => resetTransparentBg());
  } catch (e) { /* 非 Windows 或 API 不可用时忽略 */ }
  win.on('blur', () => {
    clearTitleBar();
    // 双保险:系统绘制标题栏有延迟,补两次清除
    setTimeout(clearTitleBar, 60);
    setTimeout(clearTitleBar, 200);
  });
  win.on('focus', clearTitleBar);

  // 恢复持久化的像素级穿透配置(鼠标穿透 / 描边模式默认开启,否则重启后设置不生效)
  outlineMode = !!config.outline;
  if (pixelThroughActive()) applyClickThrough();

  win.once('ready-to-show', () => {
    win.show();
    syncThroughPoll(); // 窗口可见后启动穿透轮询兜底
  });

  win.on('show', () => {
    syncThroughPoll();
    syncCounterWindow(); // 角色恢复显示时记数窗口同步显示并刷新
  });
  win.on('hide', () => {
    syncThroughPoll();
    syncCounterWindow(); // 角色隐藏到托盘时记数窗口一起隐藏
  });

  win.on('closed', () => {
    win = null;
    syncThroughPoll(); // 停止轮询
  });

  // 屏幕分辨率变化时把宠物拉回可见区域
  screen.on('display-metrics-changed', () => {
    if (!win) return;
    const [x, y] = win.getPosition();
    movePetWindow(x, y);
  });

  // 渲染进程报错/日志转发
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[renderer:${level}] ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('渲染进程崩溃:', details.reason);
  });
}

function createTray() {
  const iconPath = path.join(ASSETS, 'CharacterJobIconM0001001.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  const trayIcon = icon.resize({ width: 20, height: 20 });

  tray = new Tray(trayIcon);
  tray.setToolTip('突击莉莉桌宠');
  tray.on('click', () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 隐藏桌宠', click: () => {
        if (!win) return;
        win.isVisible() ? win.hide() : (win.show(), win.focus());
      } },
    { label: '⚙ 功能菜单', click: () => {
        // 全穿透模式下无法右键宠物,从托盘打开完整功能菜单
        if (win && !win.isDestroyed()) win.webContents.send('pet:menu-action', { type: 'open-menu' });
      } },
    { label: '🖱 移动宠物(临时交互 15 秒)', click: () => enableTempInteractive(15) },
    { label: '🎭 场景互动(感知打字/点击/滑鼠/CPU/媒体)', type: 'checkbox', checked: config.sceneInteract !== false, click: (item) => {
        config.sceneInteract = item.checked;
        saveConfig();
      } },
    { label: '开机自启', type: 'checkbox', checked: config.autoLaunch, click: (item) => setAutoLaunch(item.checked) },
    { type: 'separator' },
    { label: '退出桌宠', click: () => { quitting = true; app.quit(); } },
  ]);
}

function setAutoLaunch(enabled) {
  config.autoLaunch = enabled;
  saveConfig();
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
}

// ---------- IPC ----------
ipcMain.handle('pet:get-config', () => config);
ipcMain.handle('pet:set-config', (_e, patch) => {
  Object.assign(config, patch);
  saveConfig();
  if (patch.alwaysOnTop !== undefined && win) {
    win.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
  }
  if (patch.autoLaunch !== undefined) setAutoLaunch(config.autoLaunch);
  if (patch.clickThrough !== undefined && win) {
    applyClickThrough();
  }
  return config;
});

// ---- 窗口移动/拖动(尺寸稳定性) ----
// 实测(Electron 35 + Windows 125% 缩放):对"无边框 + 不可调整大小"的透明窗口单独调用
// setPosition 时,窗口每次都会按物理像素取整"长大"约 1 DIP 且可单调累加(创建时已偏,
// 之后每移动一次 +1~2,永不缩回)。后果:对话气泡(锚定窗口顶部)与右键菜单(按窗口
// 位置/尺寸摆放)随拖动次数增加越来越偏,看起来就像"窗口被鼠标越拖越大"。
// 结论:移动必须每次把"应然尺寸"一起传给 setBounds,窗口尺寸才保持稳定
// (实测仅有 ±1 DIP 的有界抖动,由 125% 缩放下物理像素取整造成,视觉不可见)。
let canonicalW = 480, canonicalH = 560; // 窗口应然尺寸(DIP),由 pet:resize 维护

function movePetWindow(x, y) {
  if (!win) return [0, 0];
  const [w, h] = win.getSize(); // 实际占用尺寸(含系统取整),用于工作区夹取
  const clamped = clampToWorkArea(x, y, w, h);
  // 取整 + 显式尺寸:setPosition 不接受小数坐标(DPI 换算产生小数会抛 conversion failure);
  // setBounds 携带应然尺寸,保证拖动过程中窗口尺寸不漂移
  win.setBounds({ x: Math.round(clamped.x), y: Math.round(clamped.y), width: canonicalW, height: canonicalH });
  updateCounterWindow(); // 记数窗口跟随角色移动
  return win.getPosition();
}

// 拖动:渲染进程按帧节流上报"绝对目标位置"(窗口坐标 DIP),主进程直接移动窗口。
// 相比旧的 pet:move-by(每次 mousemove 一次 invoke 增量移动):
//   ① ipcRenderer.send 单向发送,去掉应答往返与 Promise 开销;
//   ② 绝对坐标自纠正:即使某帧消息被延迟/合并,下一帧目标仍是光标真实位置,
//      不会累积误差,也不会出现"光标停手后窗口还在滑行"的橡皮筋式滞后。
ipcMain.on('pet:drag-move', (_e, x, y) => {
  if (!win) return;
  movePetWindow(x, y);
});

ipcMain.handle('pet:set-position', (_e, x, y) => {
  if (!win) return [0, 0];
  return movePetWindow(x, y);
});

ipcMain.handle('pet:get-position', () => (win ? win.getPosition() : [0, 0]));

ipcMain.handle('pet:get-bounds', () => (win ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 }));

ipcMain.handle('pet:resize', (_e, w, h, anchor) => {
  if (!win) return;
  w = Math.max(120, Math.round(w));
  h = Math.max(120, Math.round(h));
  const [cx, cy] = win.getPosition();
  const [cw, ch] = win.getSize();
  let x = cx, y = cy;
  if (anchor === 'bottom-center') {
    x = Math.round(cx + (cw - w) / 2);
    y = cy + ch - h;
  } else if (anchor === 'center') {
    x = Math.round(cx + (cw - w) / 2);
    y = Math.round(cy + (ch - h) / 2);
  }
  canonicalW = w; canonicalH = h; // 记录应然尺寸:后续拖动/移动都回传该尺寸,防止系统放大窗口
  // 夹取回工作区:显示器布局变化后重启时,持久化的位置可能已在屏外
  const clamped = clampToWorkArea(x, y, w, h);
  win.setBounds({ x: clamped.x, y: clamped.y, width: w, height: h });
  updateCounterWindow(); // 角色缩放后记数窗口重新对齐
  return win.getBounds();
});

// 独立菜单窗口(右键时显示在角色旁边,角色窗口完全不动)
let menuWin = null;
let menuState = null; // 最近一次注入菜单的状态(供刷新)

// 菜单窗口几何常量(与 renderer/menu.css 保持一致):
//   卡片宽度 320;非贴脸侧透明边距 12(容纳投影),贴脸侧 5(朝向角色的一侧更小);
//   窗口宽度 = 320 + 12 + 5 = 337;高度由内容经 menu:resize 自适应
const MENU_W = 320;
const MENU_PAD = 12;     // 非贴脸侧透明边距(容纳投影阴影)
const MENU_PAD_FACE = 5; // 贴脸侧透明边距(朝向角色的一侧,让卡片贴近角色)
const MENU_GAP = 5;      // 卡片边缘与角色窗口边缘的视觉间距
const MENU_MARGIN = 8;   // 菜单与工作区边缘的最小间距
const MENU_OFFSET_X = 16;  // 位置微调:整体向右偏移(DIP)
const MENU_OFFSET_Y = 105; // 位置微调:整体向下偏移(DIP)

function getMenuState() {
  return menuState;
}

function createMenuWindow() {
  if (menuWin) return menuWin;
  menuWin = new BrowserWindow({
    width: MENU_W + MENU_PAD + MENU_PAD_FACE,
    height: 480,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'menu-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  menuWin.loadFile(path.join(__dirname, 'renderer', 'menu.html'));
  menuWin.setTitle(' '); // 避免失焦时显示标题横幅
  const resetMenuBg = () => {
    if (process.platform === 'win32' && menuWin && !menuWin.isDestroyed()) {
      menuWin.setBackgroundColor('#00000000');
    }
  };
  const forceMenuRepaint = () => {
    if (process.platform !== 'win32' || !menuWin || menuWin.isDestroyed()) return;
    menuWin.setOpacity(0.9999);
    setTimeout(() => {
      if (menuWin && !menuWin.isDestroyed()) menuWin.setOpacity(1);
    }, 5);
  };
  const clearMenuTitleBar = () => {
    resetMenuBg();
    forceMenuRepaint();
  };
  try {
    menuWin.hookWindowMessage(0x0086, () => resetMenuBg());
  } catch (e) { /* 忽略 */ }
  // 失焦(点击窗口外 / 切换到其他程序)→ 播放关闭动画后隐藏。
  // 打开/重开瞬间的短暂失焦(Windows 焦点交接、页面加载、重开竞态)不立即关闭:
  // 延迟观察 250ms,期间若窗口重新聚焦则作废,否则执行关闭。
  menuWin.on('blur', () => {
    clearMenuTitleBar();
    setTimeout(clearMenuTitleBar, 60);
    const age = Date.now() - menuOpenedAt;
    if (age < 250) {
      setTimeout(() => {
        if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()
            && !menuWin.isFocused() && Date.now() - menuOpenedAt >= 250) {
          requestMenuClose();
        }
      }, 250 - age);
      return;
    }
    requestMenuClose();
  });
  menuWin.on('closed', () => { menuWin = null; });
  menuWin.webContents.on('console-message', (_e, level, message) => {
    console.log(`[menu:${level}] ${message}`);
  });
  return menuWin;
}

// 隐藏菜单窗口并通知角色窗口(所有关闭路径的最终收敛点)
function hideMenuWindow() {
  if (!menuWin || menuWin.isDestroyed()) return;
  const wasVisible = menuWin.isVisible();
  menuWin.hide();
  if (!wasVisible) return;
  // 菜单窗口隐藏时,Windows 会把焦点先跳回角色窗口再交给目标程序,
  // 角色窗口经历 focus→blur 会补画标题栏,这里同步强制清除
  if (process.platform === 'win32' && win && !win.isDestroyed()) {
    const clearPet = () => {
      win.setBackgroundColor('#00000000');
      win.setOpacity(0.9999);
      setTimeout(() => { if (win && !win.isDestroyed()) win.setOpacity(1); }, 5);
    };
    setTimeout(clearPet, 80);
    setTimeout(clearPet, 250);
  }
  // 通知角色窗口菜单已关闭(同步 menuOpen 状态)
  if (win && !win.isDestroyed()) win.webContents.send('pet:menu-closed');
}

// 请求菜单窗口播放关闭动画后自行隐藏(500ms 兜底,防止渲染进程异常导致菜单残留)
function requestMenuClose() {
  if (!menuWin || menuWin.isDestroyed() || !menuWin.isVisible()) return;
  menuWin.webContents.send('menu:close-request');
  setTimeout(() => { hideMenuWindow(); }, 500);
}

// 角色窗口请求打开菜单:角色窗口位置不动,菜单窗口出现在角色旁边。
// 定位策略:默认在角色左侧;左侧放不下则翻到右侧;两侧都不够则夹取进工作区。
// 垂直方向与角色顶部对齐,超出工作区底部时上移夹取。按角色所在显示器计算(多屏支持)。
let menuOpenedAt = 0; // 最近一次打开菜单的时间戳(blur 防抖用)
let menuSide = 'left'; // 最近一次弹出方位(供渲染进程拉取,调整弹出动画生长方向)
ipcMain.handle('pet:open-menu', (_e, state) => {
  if (!win) return null;
  if (state) state.counter = { enabled: counterData.settings.enabled !== false, period: counterData.settings.period || 'today' };
  // 主题状态注入:菜单窗口据此换肤(theme / motionTier 由主进程配置持有)
  if (state) { state.theme = config.theme; state.motionTier = config.motionTier; }
  menuState = state || null;
  const mw = createMenuWindow();
  menuOpenedAt = Date.now();
  const [cw, ch] = win.getSize();
  const [cx, cy] = win.getPosition();
  const wa = screen.getDisplayNearestPoint({ x: cx, y: cy }).workArea;
  const menuW = MENU_W + MENU_PAD + MENU_PAD_FACE; // 337
  const menuH = 480; // 初始高度,加载后由菜单窗口 menu:resize 按内容校正
  let side = 'left';
  // 默认左侧:卡片右缘(窗口 x + 非贴脸边距 12 + 卡片宽 320)与角色窗口左缘保持 MENU_GAP 间距
  let mx = cx - (MENU_PAD + MENU_W + MENU_GAP);
  if (mx < wa.x + MENU_MARGIN) {
    side = 'right';
    mx = cx + cw + MENU_GAP - MENU_PAD_FACE;
    if (mx + menuW > wa.x + wa.width - MENU_MARGIN) {
      // 两侧都不够(极端情况):夹取,尽量保持左侧
      side = 'left';
      mx = Math.max(wa.x + MENU_MARGIN, wa.x + wa.width - MENU_MARGIN - menuW);
    }
  }
  let my = cy;
  if (my + menuH > wa.y + wa.height - MENU_MARGIN) my = wa.y + wa.height - MENU_MARGIN - menuH;
  my = Math.max(wa.y + MENU_MARGIN, my);
  // 位置微调(向右 3 / 向下 20),偏移后再次夹取回工作区,保证不越界
  mx += MENU_OFFSET_X;
  my += MENU_OFFSET_Y;
  mx = Math.max(wa.x + MENU_MARGIN, Math.min(mx, wa.x + wa.width - menuW - MENU_MARGIN));
  my = Math.max(wa.y + MENU_MARGIN, Math.min(my, wa.y + wa.height - menuH - MENU_MARGIN));
  mw.setBounds({ x: Math.round(mx), y: Math.round(my), width: menuW, height: menuH });
  mw.show();
  mw.focus();
  menuSide = side;
  // 附带弹出方位,菜单据此调整弹出动画的生长方向
  mw.webContents.send('menu:state', Object.assign({ side }, state || {}));
  return { side, x: Math.round(mx), y: Math.round(my) };
});

// 菜单渲染进程冷启动时主动拉取状态(推送可能早于监听器注册而丢失)
ipcMain.handle('menu:get-state', () => {
  if (!menuState) return null;
  return Object.assign({ side: menuSide }, menuState);
});

// 菜单窗口按内容自适应尺寸(保持卡片左上角不动,超出工作区时夹取)
ipcMain.on('menu:resize', (_e, w, h) => {
  if (!menuWin || menuWin.isDestroyed()) return;
  w = Math.max(200, Math.min(Math.round(w), 460));
  h = Math.max(200, Math.min(Math.round(h), 720));
  const [x, y] = menuWin.getPosition();
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
  const nx = Math.max(wa.x + MENU_MARGIN, Math.min(x, wa.x + wa.width - w - MENU_MARGIN));
  const ny = Math.max(wa.y + MENU_MARGIN, Math.min(y, wa.y + wa.height - h - MENU_MARGIN));
  menuWin.setBounds({ x: nx, y: ny, width: w, height: h });
});

// 菜单窗口播放完关闭动画后请求隐藏
ipcMain.on('menu:close', () => {
  hideMenuWindow();
});

// 角色窗口请求关闭菜单(点击角色 / 再次右键 / Esc)
ipcMain.handle('pet:close-menu', () => {
  requestMenuClose();
  return true;
});

// 菜单动作 → 转发给角色窗口执行
ipcMain.on('menu:action', (_e, action) => {
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet:menu-action', action);
  }
  // 主题/动效强度:由主进程持久化(主题同时推送记数窗口即时换肤)
  if (action && action.type === 'theme' && /^[a-z0-9-]+$/.test(action.value)) {
    config.theme = action.value;
    saveConfig();
    pushCounterNow(); // counter:update 快照附带 theme,记数模块即时换肤
  }
  if (action && action.type === 'motionTier') {
    config.motionTier = action.value === 'full' ? 'full' : 'light';
    saveConfig();
  }
  // 部分动作需要主进程直接处理
  if (action && action.type === 'quit') {
    quitting = true;
    app.quit();
  }
  if (action && action.type === 'hide' && win) {
    win.hide();
  }
});

ipcMain.handle('pet:get-work-area', () => {
  if (!win) return screen.getPrimaryDisplay().workArea;
  const p = win.getPosition();
  return screen.getDisplayNearestPoint({ x: p[0], y: p[1] }).workArea;
});

ipcMain.handle('pet:set-interactive', (_e, interactive) => {
  // 像素级穿透(鼠标穿透/描边模式):渲染进程实时上报鼠标是否落在角色本体上。
  // 本体上 → 窗口可交互;透明区域 → 忽略鼠标事件,点击直达下方窗口。
  applyPixelInteractive(interactive);
});

ipcMain.handle('pet:set-outline', (_e, on) => {
  // 描边模式镜像:开启后透明区域同样进入像素级穿透
  outlineMode = !!on;
  applyPixelInteractive(false);
  return outlineMode;
});

ipcMain.handle('pet:hide', () => {
  if (menuWin && !menuWin.isDestroyed()) menuWin.hide();
  win && win.hide();
});
ipcMain.handle('pet:show', () => { if (win) { win.show(); win.focus(); } });
ipcMain.handle('pet:quit', () => { quitting = true; app.quit(); });

ipcMain.handle('pet:debug-capture', async (_e, name) => {
  if (!win) return null;
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', `debug-${name}.png`);
  fs.writeFileSync(out, img.toPNG());
  return out;
});

ipcMain.handle('pet:read-asset', (_e, name) => {
  // 台词配置外部化:打包版(asar 只读)优先读 userData 下的可编辑副本
  // (首次启动已由 ensureExternalLines() 从包内自动复制),开发模式仍读 renderer 目录。
  const clean = String(name).replace(/^[/\\]+/, '');
  if (clean === 'lines.jsonc' && app.isPackaged) {
    const userFile = path.join(app.getPath('userData'), 'lines.jsonc');
    if (fs.existsSync(userFile)) return fs.readFileSync(userFile);
  }
  // 仅允许读取 renderer 目录内的文件(防目录穿越)
  const file = path.join(RENDERER_DIR, clean);
  if (!file.startsWith(RENDERER_DIR)) throw new Error('非法路径');
  return fs.readFileSync(file);
});

// ---------- 台词文件保存(内置"设置 → 台词与场景"编辑器) ----------
// 与 pet:read-asset 同一路径解析:打包版写 userData 外部文件,开发模式写 renderer 目录。
// 保存成功后通知角色窗口热重载台词配置(无需重启)。
function linesFilePath() {
  if (app.isPackaged) return path.join(app.getPath('userData'), 'lines.jsonc');
  return path.join(RENDERER_DIR, 'lines.jsonc');
}

// JSONC 注释剥离(仅用于保存前校验,与 renderer/scene-editor.js 同一实现)
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

ipcMain.handle('pet:save-lines', (_e, text) => {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '内容为空' };
  // 写入前校验:剥离注释后必须能解析成合法 JSON(防写入损坏文件)
  try {
    JSON.parse(stripJsonComments(text));
  } catch (e) {
    return { ok: false, error: '格式错误: ' + ((e && e.message) || e) };
  }
  try {
    const file = linesFilePath();
    fs.writeFileSync(file, text, 'utf8');
    console.log('[lines] 台词文件已保存: ' + file);
    // 通知角色窗口热重载(重新解析台词/冷却并同步主进程)
    if (win && !win.isDestroyed()) win.webContents.send('pet:lines-saved');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle('pet:debug-info', () => {
  const i = process.argv.indexOf('--debug-shot');
  return {
    isDebug: i >= 0,
    target: i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null,
  };
});

ipcMain.handle('pet:debug-ignore', () => ignoreState);

ipcMain.handle('pet:debug-log', (_e, msg) => {
  try {
    fs.appendFileSync(path.join(__dirname, 'debug.log'), new Date().toISOString().slice(11, 19) + ' ' + msg + '\n');
  } catch (e) { /* 忽略 */ }
  return true;
});

// 渲染进程自测(throughtest)完成信号:由渲染进程触发退出,避免主进程定时器抢跑
ipcMain.on('pet:debug-done', () => {
  if (IS_DEBUG) { quitting = true; app.quit(); }
});

function applyClickThrough() {
  if (!win) return;
  if (fullThroughActive()) {
    // 全穿透(鼠标穿透开启):整个窗口含本体都忽略鼠标,点击直达下层窗口。
    // 关键:必须 forward:false —— Electron 的 forward 转发在 Windows 上通过
    // 鼠标钩子在光标悬停时临时清除 WS_EX_TRANSPARENT(否则收不到 mousemove),
    // 这会让本体区域重新可命中,点击又被宠物吃掉(实测 electron#33281 场景)。
    // 全穿透不需要转发(渲染进程无需感知鼠标),用纯 WS_EX_TRANSPARENT 最可靠。
    win.setIgnoreMouseEvents(true, { forward: false });
    ignoreState = true;
  } else if (pixelThroughActive()) {
    // 描边模式(或临时交互):先整体穿透,渲染进程按鼠标位置恢复本体交互
    win.setIgnoreMouseEvents(true, { forward: true });
    ignoreState = true;
  } else {
    win.setIgnoreMouseEvents(false);
    ignoreState = false;
  }
  syncThroughPoll();
}

// 鼠标穿透 / 描边模式任一开启时,窗口进入"像素级穿透":
// 默认忽略鼠标事件(透明区域点击直达下方窗口),渲染进程根据鼠标位置实时恢复本体交互
function pixelThroughActive() {
  return config.clickThrough || outlineMode;
}

// 全穿透(鼠标穿透开启):整个窗口(含角色本体)都忽略鼠标,完全不挡下方窗口。
// 与"描边模式"(仅透明区穿透、本体可交互)语义不同。
// 托盘"移动宠物"会临时置 tempInteractive,期间回到像素级交互以便拖动。
let tempInteractive = false;
let tempInteractiveTimer = null;

function fullThroughActive() {
  return config.clickThrough && !tempInteractive;
}

let ignoreState = false; // 主进程侧实际生效的"忽略鼠标事件"状态(Electron 35 无查询 API,自行跟踪)

function applyPixelInteractive(interactive) {
  if (!win) return;
  if (fullThroughActive()) {
    // 全穿透:始终忽略鼠标(forward:false,见 applyClickThrough 注释),渲染进程上报的交互状态不生效
    win.setIgnoreMouseEvents(true, { forward: false });
    ignoreState = true;
  } else if (pixelThroughActive()) {
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    ignoreState = !interactive;
  } else {
    win.setIgnoreMouseEvents(false);
    ignoreState = false;
  }
  syncThroughPoll();
}

// 托盘"移动宠物":临时关闭全穿透(回到像素级交互,本体可拖动),倒计时后恢复
function enableTempInteractive(secs) {
  if (!win || win.isDestroyed()) return;
  clearTimeout(tempInteractiveTimer);
  tempInteractive = true;
  win.webContents.send('pet:menu-action', { type: 'temp-interactive', value: true });
  applyPixelInteractive(false);
  tempInteractiveTimer = setTimeout(() => {
    tempInteractive = false;
    if (win && !win.isDestroyed()) {
      win.webContents.send('pet:menu-action', { type: 'temp-interactive', value: false });
      applyClickThrough();
    }
  }, (secs || 15) * 1000);
}

// ---- 像素级穿透状态轮询兜底 ----
// Electron 在 Windows 上 setIgnoreMouseEvents(true, {forward:true}) 的 mousemove 转发
// 不可靠(已知问题 electron#33281:某些非 Electron 窗口聚焦时收不到转发;#30808:转发行为
// 本身有 bug),渲染进程可能长时间收不到 mousemove,导致"透明区点击不穿透/本体点不动"。
// 这里由主进程每 100ms 轮询真实光标位置(screen.getCursorScreenPoint,与窗口坐标同为 DIP),
// 换算成窗口内坐标发给渲染进程,由它复用同一套像素命中判定更新交互状态 ——
// 穿透状态不再依赖转发事件,forward 只作为快速路径加速。
let throughPollTimer = null;

function syncThroughPoll() {
  // 全穿透模式下窗口恒忽略鼠标,无需轮询;只有像素级交互(描边/临时交互)才需要
  const active = !!(win && !win.isDestroyed() && win.isVisible() && pixelThroughActive() && !fullThroughActive());
  if (active && !throughPollTimer) {
    throughPollTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible() || !pixelThroughActive() || fullThroughActive()) return;
      const p = screen.getCursorScreenPoint();
      const [wx, wy] = win.getPosition();
      win.webContents.send('pet:cursor-poll', { x: p.x - wx, y: p.y - wy });
    }, 100);
  } else if (!active && throughPollTimer) {
    clearInterval(throughPollTimer);
    throughPollTimer = null;
  }
}

function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- 场景互动(全局输入 / CPU / 媒体传感) ----------
// 通过 tools/sensor.ps1(PowerShell 轮询 GetAsyncKeyState / 内核 CPU / WinRT SMTC)感知用户场景:
//   连续打字 → typing | 连续点击 → clicking | 持续滑动鼠标 → mousemove
//   CPU 高占用 → highcpu | 播放视频/音乐 → media / 停止 → media-stop
// 原始事件在主进程聚合成"场景事件"(带冷却去重),经 pet:scene-event 发给渲染进程,
// 由它决定台词、表情与动作。托盘菜单/功能菜单可整体开关(sceneInteract)。
let sensorProc = null;
let sensorRetries = 0;
let sensorReady = false;

// 各场景事件的最小间隔(ms):防连珠炮式刷屏。
// 默认值可在 lines.jsonc 的 _settings.cooldowns 中按场景覆盖,渲染进程加载后经
// pet:set-scene-settings 同步到这里。
let SCENE_COOLDOWN = { typing: 4000, clicking: 6000, mousemove: 12000, highcpu: 30000, media: 10000, 'media-stop': 10000 };
const sceneLast = {};
const keyHist = [];    // 最近按键时间戳(打字连击判定)
const clickHist = [];  // 最近鼠标点击时间戳(点击连击判定)
let lastCursorPt = null;
let mouseStreak = 0;   // 连续移动毫秒
let cpuHighSince = 0;  // CPU 高占用起始时刻(0=正常, -1=已触发过等回落)
let mediaPlaying = false;

function sceneEnabled() { return config.sceneInteract !== false; }

function emitScene(type, data) {
  if (!sceneEnabled() || !win || win.isDestroyed() || !win.isVisible()) return;
  const cd = SCENE_COOLDOWN[type] || 0;
  const now = Date.now();
  if (sceneLast[type] && now - sceneLast[type] < cd) return;
  sceneLast[type] = now;
  console.log('[scene] ' + type + (data && data.app ? ' app=' + data.app : '') + (data && data.music ? ' music' : ''));
  win.webContents.send('pet:scene-event', Object.assign({ type }, data || {}));
}

// 渲染进程加载台词配置后,把 lines.jsonc 的 _settings.cooldowns 同步到这里
// (场景编号 → 冷却毫秒;非法值忽略,保持当前值)
const SCENE_KEY_TO_TYPE = {
  '10_typing': 'typing', '11_clicking': 'clicking', '12_mousemove': 'mousemove',
  '13_highcpu': 'highcpu', '14_media': 'media', '16_mediaStop': 'media-stop',
};
ipcMain.on('pet:set-scene-settings', (_e, settings) => {
  if (!settings || !settings.cooldowns) return;
  let updated = 0;
  for (const k of Object.keys(SCENE_KEY_TO_TYPE)) {
    const v = Number(settings.cooldowns[k]);
    if (v > 0 && Number.isFinite(v)) {
      SCENE_COOLDOWN[SCENE_KEY_TO_TYPE[k]] = Math.round(v);
      updated++;
    }
  }
  console.log('[scene] 冷却设置已同步(' + updated + ' 项): ' + JSON.stringify(SCENE_COOLDOWN));
});

function handleSensorEvent(ev) {
  if (!ev || !ev.t) return;
  const now = Date.now();
  switch (ev.t) {
    case 'hello':
      sensorReady = true;
      sensorRetries = 0;
      break;
    case 'key': {
      // 打字连击:3 秒内 ≥5 次按键
      keyHist.push(now);
      while (keyHist.length && now - keyHist[0] > 3000) keyHist.shift();
      if (keyHist.length >= 5) { keyHist.length = 0; emitScene('typing', { count: 5 }); }
      break;
    }
    case 'keystroke': {
      // 任意按键(含方向键/功能键等)→ 击键计数(与 'key' 打字事件互不干扰)
      bumpCounter();
      break;
    }
    case 'btn': {
      // 仅用于场景互动(点击连击);鼠标点击不记录到记数模块
      // 点击连击:2 秒内 ≥4 次(左/右键都算)
      if (ev.k === 'left' || ev.k === 'right') {
        clickHist.push(now);
        while (clickHist.length && now - clickHist[0] > 2000) clickHist.shift();
        if (clickHist.length >= 4) { clickHist.length = 0; emitScene('clicking', { count: 4 }); }
      }
      break;
    }
    case 'pos': {
      // 持续滑动鼠标:位移 ≥1.5px 且连续 2.2 秒不停 → mousemove
      const p = { x: ev.x, y: ev.y };
      if (lastCursorPt) {
        const d = Math.hypot(p.x - lastCursorPt.x, p.y - lastCursorPt.y);
        mouseStreak = d >= 1.5 ? mouseStreak + 60 : 0; // 60ms = 传感器 pos 输出节流间隔
        if (mouseStreak >= 2200) {
          mouseStreak = 0;
          emitScene('mousemove', { ms: 2200 });
        }
      }
      lastCursorPt = p;
      break;
    }
    case 'cpu': {
      // CPU 高占用:≥70% 且持续 5 秒以上 → highcpu(触发后等回落到 70% 以下再重置)
      const pct = Number(ev.p);
      if (isNaN(pct)) break;
      if (pct >= 70) {
        if (cpuHighSince === 0) cpuHighSince = now;
        else if (cpuHighSince > 0 && now - cpuHighSince >= 5000) {
          emitScene('highcpu', { pct: Math.round(pct) });
          cpuHighSince = -1;
        }
      } else if (cpuHighSince !== 0) {
        cpuHighSince = 0;
      }
      break;
    }
    case 'media': {
      // 媒体播放:状态翻转时发事件(media 带来源 App 与音乐/视频判别)
      const playing = !!ev.s;
      if (playing && !mediaPlaying) emitScene('media', { app: ev.app || '', music: !!ev.music });
      else if (!playing && mediaPlaying) emitScene('media-stop', {});
      mediaPlaying = playing;
      break;
    }
  }
}

// 启动传感器(PowerShell 进程,失败自动有限重试)
function startSensor() {
  if (process.platform !== 'win32' || IS_DEBUG) return;
  if (sensorProc) return;
  // 打包后(asar)内部文件对 PowerShell 子进程不可见,electron-builder 会把
  // tools/sensor.ps1 放到 resources/tools/ 下(extraResources),优先使用它;
  // 开发模式仍使用 __dirname 下的文件。
  const packedScript = process.resourcesPath ? path.join(process.resourcesPath, 'tools', 'sensor.ps1') : null;
  const script = (packedScript && fs.existsSync(packedScript)) ? packedScript : path.join(__dirname, 'tools', 'sensor.ps1');
  if (!fs.existsSync(script)) return;
  let buf = '';
  sensorProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sensorProc.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try { handleSensorEvent(JSON.parse(line)); }
      catch (e) { /* 忽略坏行 */ }
    }
  });
  sensorProc.stderr.on('data', (chunk) => {
    console.error('[sensor]', String(chunk).trim());
  });
  sensorProc.on('error', (e) => {
    console.error('[sensor] 启动失败:', e.message);
    sensorProc = null;
  });
  sensorProc.on('exit', (code) => {
    console.log('[sensor] 退出 code=' + code);
    sensorProc = null;
    sensorReady = false;
    lastCursorPt = null; mouseStreak = 0; cpuHighSince = 0; mediaPlaying = false;
    // 非退出流程中的异常退出 → 有限重试(退避)
    if (!quitting && sensorRetries < 5) {
      sensorRetries++;
      setTimeout(startSensor, 3000 * sensorRetries);
    }
  });
}

function stopSensor() {
  if (sensorProc) {
    try { sensorProc.kill(); } catch (e) { /* 忽略 */ }
    sensorProc = null;
  }
}

// ---------- 击键记数模块 ----------
// 数据存于 userData/pet-counter.json(本地持久化):
//   { settings: { enabled: 是否显示记数窗口, period: 当前展示周期(today/week/month/total) },
//     days: { 'YYYY-MM-DD': key } }   // 每天一个击键数(旧版本 {key,click} 对象兼容读取)
// 原始事件来自传感器:任意按键 → keystroke(仅统计键盘敲击;鼠标点击不记录)。
// 每周 = 本周一 00:00 起;每月 = 本月 1 日 00:00 起;总计 = 全部历史之和。
const COUNTER_PATH = path.join(app.getPath('userData'), 'pet-counter.json');
const DEFAULT_COUNTER = { settings: { enabled: true, period: 'today' }, days: {} };
const PERIODS = ['today', 'week', 'month', 'total'];
let counterData = loadCounter();
let counterDay = dateKey(new Date()); // 当前记数日期(跨天时切换新桶)
let counterSaveTimer = null;          // 防抖保存(5 秒内最多写一次盘)

function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function loadCounter() {
  let data = { ...DEFAULT_COUNTER, settings: { ...DEFAULT_COUNTER.settings } };
  try {
    const raw = JSON.parse(fs.readFileSync(COUNTER_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      data.settings = Object.assign({}, data.settings, raw.settings || {});
      if (!PERIODS.includes(data.settings.period)) data.settings.period = 'today';
      delete data.settings.countMouse; // 清理旧版字段(鼠标计数已移除)
      data.days = (raw.days && typeof raw.days === 'object') ? raw.days : {};
    }
  } catch (e) { /* 首次启动/文件损坏 → 使用默认值 */ }
  return data;
}

function saveCounterNow() {
  if (counterSaveTimer) { clearTimeout(counterSaveTimer); counterSaveTimer = null; }
  try {
    fs.writeFileSync(COUNTER_PATH, JSON.stringify(counterData, null, 2));
  } catch (e) {
    console.error('保存记数数据失败:', e);
  }
}

// 防抖保存:高频击键时最多每 5 秒落一次盘(退出时还会再保存一次)
function scheduleCounterSave() {
  if (counterSaveTimer) return;
  counterSaveTimer = setTimeout(saveCounterNow, 5000);
}

// 实时推送:每次击键立即推送最新快照到独立记数窗口(点击一次渲染一次)
// 快照附带当前主题(theme),记数窗口据此换肤
function pushCounterNow() {
  if (counterWin && !counterWin.isDestroyed() && counterWin.isVisible()) {
    counterWin.webContents.send('counter:update', Object.assign(counterSnapshot(), { theme: config.theme }));
  }
}

// 累加一次击键计数(仅键盘)
function bumpCounter() {
  const today = dateKey(new Date());
  if (today !== counterDay) counterDay = today; // 跨天:后续使用新桶(旧数据保留用于周/月/总计)
  let day = counterData.days[today];
  if (!day) day = counterData.days[today] = 0;
  counterData.days[today] = (typeof day === 'number' ? day : Number(day.key) || 0) + 1;
  scheduleCounterSave();
  pushCounterNow();
}

// 聚合快照:今日 / 本周 / 本月 / 总计 的击键数(供独立记数窗口展示)
function counterSnapshot() {
  const now = new Date();
  const todayKey = dateKey(now);
  // 本周一 00:00(getDay(): 0=周日,1=周一,…,6=周六)
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = { today: 0, week: 0, month: 0, total: 0 };
  for (const [k, v] of Object.entries(counterData.days)) {
    if (v === null || v === undefined) continue;
    const key = typeof v === 'number' ? v : (Number(v.key) || 0); // 兼容旧 {key,click} 格式
    if (!(key > 0)) continue;
    agg.total += key;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (!m) continue;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d >= monthStart) agg.month += key;
    if (d >= weekStart) agg.week += key;
    if (k === todayKey) agg.today = key;
  }
  return {
    enabled: counterData.settings.enabled !== false,
    period: PERIODS.includes(counterData.settings.period) ? counterData.settings.period : 'today',
    day: todayKey,
    today: agg.today, week: agg.week, month: agg.month, total: agg.total,
  };
}

ipcMain.handle('pet:set-counter', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return counterSnapshot();
  let changed = false;
  if (typeof patch.enabled === 'boolean' && patch.enabled !== counterData.settings.enabled) {
    counterData.settings.enabled = patch.enabled;
    changed = true;
  }
  if (PERIODS.includes(patch.period) && patch.period !== counterData.settings.period) {
    counterData.settings.period = patch.period;
    changed = true;
  }
  saveCounterNow(); // 设置变更立即落盘
  if (changed) {
    if (patch.enabled !== undefined) syncCounterWindow(); // 显示/隐藏独立记数窗口
    if (patch.period !== undefined) pushCounterNow();      // 周期切换立即刷新
  }
  return counterSnapshot();
});

// ---------- 独立记数窗口(模块与角色窗口解耦:数字再长也不遮挡角色) ----------
// 记数模块由主进程创建为独立透明置顶小窗口,贴在角色窗口左下侧(放不下翻右侧),
// 跟随角色移动;整窗鼠标穿透(纯展示,点击直达下层窗口)。
let counterWin = null;
let counterWinW = 150, counterWinH = 46; // 记数窗口应然尺寸(DIP)
// 关键:Windows 对无边框透明窗口 setBounds 移动时尺寸会按物理像素取整漂移(每次 +1~2 且累加,
// 与主窗口同款问题)。拖动跟随必须始终使用应然尺寸,绝不能回读 getSize() 再写回,
// 否则记数窗口会越拖越大、位置越偏越远。
const COUNTER_GAP = 8;     // 记数窗口放在角色右侧时与角色窗口的间距
const COUNTER_OFFSET = 102; // 记数窗口放在左侧时,右缘相对角色窗口左缘的偏移(72 + 再右移 30px);
                            // 窗口右缘锚定不动,数字变长窗口加宽时自动向左伸长
const COUNTER_MIN_W = 64, COUNTER_MIN_H = 30;

function createCounterWindow() {
  if (counterWin && !counterWin.isDestroyed()) return counterWin;
  counterWin = new BrowserWindow({
    width: 150,
    height: 46,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'counter-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  counterWin.loadFile(path.join(__dirname, 'renderer', 'counter.html'));
  counterWin.setTitle(' ');
  counterWin.setAlwaysOnTop(config.alwaysOnTop, 'screen-saver');
  // 纯展示:整个窗口鼠标穿透(含卡片区域,点击直达下层窗口)
  counterWin.setIgnoreMouseEvents(true, { forward: false });
  // 透明窗口失焦时 Windows 会补画蓝色标题栏,与角色/菜单窗口同样的清理手段
  const resetBg = () => {
    if (process.platform === 'win32' && counterWin && !counterWin.isDestroyed()) {
      counterWin.setBackgroundColor('#00000000');
    }
  };
  const forceRepaint = () => {
    if (process.platform !== 'win32' || !counterWin || counterWin.isDestroyed()) return;
    counterWin.setOpacity(0.9999);
    setTimeout(() => { if (counterWin && !counterWin.isDestroyed()) counterWin.setOpacity(1); }, 5);
  };
  try {
    counterWin.hookWindowMessage(0x0086, () => resetBg());
  } catch (e) { /* 非 Windows 忽略 */ }
  counterWin.on('blur', () => {
    resetBg();
    setTimeout(forceRepaint, 60);
    setTimeout(forceRepaint, 200);
  });
  counterWin.on('closed', () => { counterWin = null; });
  counterWin.webContents.on('console-message', (_e, level, message) => {
    console.log(`[counter:${level}] ${message}`);
  });
  return counterWin;
}

// 记数窗口位置:默认贴在角色窗口左下侧(底部对齐、右缘进入角色窗口左缘右侧
// COUNTER_OFFSET px 贴近角色);左侧放不下翻到右侧;两侧都不够则夹取进工作区。
// 右缘锚定不动 —— 数字变长窗口加宽时自动向左伸长。
// 尺寸一律用应然值(counterWinW/H),拖动时防 Windows 取整漂移。
function updateCounterWindow() {
  if (!counterWin || counterWin.isDestroyed() || !win || win.isDestroyed()) return;
  const pw = canonicalW, ph = canonicalH; // 主窗口应然尺寸(防漂移)
  const [px, py] = win.getPosition();
  const cw = counterWinW, chh = counterWinH;
  const wa = screen.getDisplayNearestPoint({ x: px, y: py }).workArea;
  let x = px - cw + COUNTER_OFFSET; // 左放置:右缘在角色窗口左缘右侧 42px
  if (x < wa.x + 4) {
    x = px + pw + COUNTER_GAP; // 翻右侧
    if (x + cw > wa.x + wa.width - 4) {
      x = Math.max(wa.x + 4, wa.x + wa.width - 4 - cw); // 两侧都不够:夹取
    }
  }
  let y = py + ph - chh; // 与角色窗口底部对齐(贴地)
  if (y < wa.y + 4) y = wa.y + 4;
  if (y + chh > wa.y + wa.height - 4) y = wa.y + wa.height - 4 - chh;
  counterWin.setBounds({ x: Math.round(x), y: Math.round(y), width: cw, height: chh });
}

// 显示/隐藏同步:记数模块开关(settings.enabled) + 角色窗口可见性
function syncCounterWindow() {
  const want = counterData.settings.enabled !== false && !!win && !win.isDestroyed() && win.isVisible();
  if (want) {
    createCounterWindow();
    if (!counterWin || counterWin.isDestroyed()) return;
    if (!counterWin.isVisible()) counterWin.showInactive(); // 不抢焦点
    updateCounterWindow();
    pushCounterNow(); // 显示时立即刷新一次
  } else if (counterWin && !counterWin.isDestroyed() && counterWin.isVisible()) {
    counterWin.hide();
  }
}

// 记数窗口渲染进程:冷启动拉取快照 / 内容尺寸变化上报
// 快照附带当前主题(theme),记数窗口冷启动时据此换肤
ipcMain.handle('counter:get-state', () => Object.assign(counterSnapshot(), { theme: config.theme }));
ipcMain.on('counter:resize', (_e, w, h) => {
  if (!counterWin || counterWin.isDestroyed()) return;
  counterWinW = Math.max(COUNTER_MIN_W, Math.round(w)); // 更新应然尺寸(拖动跟随用)
  counterWinH = Math.max(COUNTER_MIN_H, Math.round(h));
  const b = counterWin.getBounds();
  counterWin.setBounds({ x: b.x, y: b.y, width: counterWinW, height: counterWinH });
  updateCounterWindow(); // 尺寸变化后重新对齐锚点
});

// ---------- 台词文件外部化(打包版) ----------
// 安装包内 lines.jsonc 位于只读的 app.asar 中,用户无法直接编辑,
// 也无法用交互编辑器打开。打包版首次启动时把默认台词复制到用户数据目录
// (真实可写文件),之后桌宠与交互编辑器都读写这份外部文件。
// 开发模式(app.isPackaged = false)保持原样,仍直接使用 renderer/lines.jsonc。
function ensureExternalLines() {
  if (!app.isPackaged) return;
  const userFile = path.join(app.getPath('userData'), 'lines.jsonc');
  if (fs.existsSync(userFile)) return;
  try {
    fs.copyFileSync(path.join(RENDERER_DIR, 'lines.jsonc'), userFile);
    console.log('[lines] 已初始化外部台词文件: ' + userFile);
  } catch (e) {
    console.error('[lines] 初始化外部台词文件失败(将继续使用包内默认):', e);
  }
}

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { win.show(); win.focus(); }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.lily.pet');
    ensureExternalLines(); // 打包版:初始化用户可编辑的外部台词文件(开发模式无操作)
    if (config.autoLaunch) app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    createWindow();
    createTray();
    startSensor(); // 场景互动传感器(全局键盘/鼠标/CPU/媒体)
    syncCounterWindow(); // 启动时按持久化设置显示独立记数窗口
    win.webContents.once('did-finish-load', () => {
      if (IS_DEBUG) {
        // 调试模式:等待渲染完成后截图,并把结果写到 stdout 供验证
        const target = DEBUG_TARGET || 'idle';
        setTimeout(async () => {
          try {
            // outlinetest: 验证描边模式交互过滤(透明区域点击无效,本体点击有效)
            if (target === 'outlinetest') {
              await sleepMs(1400); // 等 renderer 暴露 __outlineHitPoint
              // 1) 左键点击左上角透明区域 → 不应触发动作
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 6, y: 6 });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 6, y: 6 });
              await sleepMs(350);
              const s1 = await win.webContents.executeJavaScript(`(() => {
                const s = window.__lilySpine;
                const t = s && s.state && s.state.getCurrent(0);
                return JSON.stringify({ anim: t ? t.animation.name : '?' });
              })()`);
              console.log('OUTLINETEST 透明区左键后:', s1, '(期望 anim=01BaseLoop 未触发)');
              // 2) 右键透明区域 → 不应打开菜单(检查独立菜单窗口是否可见)
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: 6, y: 6 });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: 6, y: 6 });
              await sleepMs(350);
              const s2 = JSON.stringify({ menuOpen: !!(menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) });
              console.log('OUTLINETEST 透明区右键后:', s2, '(期望 menuOpen=false)');
              // 3) 左键点击角色本体(renderer 计算的命中点)→ 应触发动作
              const hp = JSON.parse(await win.webContents.executeJavaScript(`(() => {
                const p = window.__outlineHitPoint;
                return p ? JSON.stringify({ x: p.x, y: p.y }) : '{"x":0,"y":0}';
              })()`));
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: hp.x, y: hp.y });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: hp.x, y: hp.y });
              await sleepMs(450);
              const s3 = await win.webContents.executeJavaScript(`(() => {
                const s = window.__lilySpine;
                const t = s && s.state && s.state.getCurrent(0);
                return JSON.stringify({ anim: t ? t.animation.name : '?' });
              })()`);
              console.log('OUTLINETEST 本体左键后:', s3, '(期望 anim 非 01BaseLoop = 触发动作)');
              // 4) 右键角色本体 → 应打开菜单(先等动作队列回到待机)
              await sleepMs(1800);
              const hp2 = JSON.parse(await win.webContents.executeJavaScript(`(() => {
                const p = window.__outlineHitPoint;
                return p ? JSON.stringify({ x: p.x, y: p.y }) : '{"x":0,"y":0}';
              })()`));
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: hp2.x, y: hp2.y });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: hp2.x, y: hp2.y });
              await sleepMs(450);
              const s4 = JSON.stringify({ menuOpen: !!(menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) });
              console.log('OUTLINETEST 本体右键后:', s4, '(期望 menuOpen=true)');
            }
            // menutest: 验证独立菜单窗口(角色窗口不动 + 菜单出现在角色旁边 + 点击链路)
            if (target === 'menutest') {
              await sleepMs(600);
              // 记录右键前角色窗口的位置与尺寸
              const before = win.getBounds();
              // 右键打开菜单
              const openPos = await win.webContents.executeJavaScript(`(() => {
                const s = window.__lilySpine;
                if (!s) return '{"x":100,"y":200}';
                const b = s.getBounds();
                const cv = document.querySelector('#stage-anchor > canvas').getBoundingClientRect();
                // spine bounds 是画布局部坐标,换算成页面 CSS 坐标(画布 1:1 对应 CSS 像素)
                return JSON.stringify({
                  x: Math.round(cv.left + b.x + b.width / 2),
                  y: Math.round(cv.top + b.y + b.height * 0.3),
                });
              })()`);
              const op = JSON.parse(openPos);
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: op.x, y: op.y });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: op.x, y: op.y });
              await sleepMs(700);
              // 1) 角色窗口必须完全没动
              const after = win.getBounds();
              console.log('MENUTEST 角色窗口: before=', JSON.stringify(before), 'after=', JSON.stringify(after),
                '(期望完全相同 →', before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height, ')');
              // 2) 菜单窗口是否创建且可见
              const mwInfo = await (async () => {
                if (!menuWin || menuWin.isDestroyed()) return 'NO_MENU_WIN';
                const visible = menuWin.isVisible();
                const b = menuWin.getBounds();
                return JSON.stringify({ visible, x: b.x, y: b.y, w: b.width, h: b.height });
              })();
              console.log('MENUTEST 菜单窗口:', mwInfo);
              // 3) 菜单窗口位置应与公式预期一致(默认左侧,含微调偏移;±4 DIP 容差覆盖 125% 缩放取整)
              if (menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) {
                const mc = menuWin.webContents;
                const mb = menuWin.getBounds();
                const wa = screen.getDisplayNearestPoint({ x: before.x, y: before.y }).workArea;
                const expectedSide = (before.x - (MENU_W + MENU_PAD + MENU_GAP)) >= wa.x + MENU_MARGIN ? 'left' : 'right';
                const menuW = MENU_W + MENU_PAD + MENU_PAD_FACE;
                let expX = expectedSide === 'left'
                  ? before.x - (MENU_PAD + MENU_W + MENU_GAP) + MENU_OFFSET_X
                  : before.x + before.width + MENU_GAP - MENU_PAD_FACE + MENU_OFFSET_X;
                let expY = Math.max(wa.y + MENU_MARGIN, before.y);
                if (expY + 480 > wa.y + wa.height - MENU_MARGIN) expY = wa.y + wa.height - MENU_MARGIN - 480;
                expY += MENU_OFFSET_Y;
                expX = Math.max(wa.x + MENU_MARGIN, Math.min(expX, wa.x + wa.width - menuW - MENU_MARGIN));
                expY = Math.max(wa.y + MENU_MARGIN, Math.min(expY, wa.y + wa.height - 480 - MENU_MARGIN));
                const dx = mb.x - expX, dy = mb.y - expY;
                const posOk = Math.abs(dx) <= 4 && Math.abs(dy) <= 4;
                console.log('MENUTEST 菜单位置: 期望', expectedSide, '侧, 偏移差 dx=' + dx + ' dy=' + dy + ' (期望 |dx|,|dy|<=4 → ' + posOk + ')', JSON.stringify(mb));

                // 点击辅助:程序化 .click()(合成输入在刚弹出的透明置顶窗口上偶发丢失,
                // 程序化点击确定性验证菜单逻辑与 IPC 链路)
                const jsClick = async (script) => {
                  await mc.executeJavaScript(script);
                  await sleepMs(350);
                };
                const clickMenuItem = async (label) => {
                  await jsClick(`(() => {
                    const it = [...document.querySelectorAll('.menu-item')].find((x) => {
                      const s = x.querySelector('.item-label span');
                      return s && s.textContent === ${JSON.stringify(label)};
                    });
                    if (it) it.click();
                  })()`);
                };
                const clickChip = async (index) => {
                  await jsClick(`(() => {
                    const chips = document.querySelectorAll('.chips .chip');
                    if (chips[${index}]) chips[${index}].click();
                  })()`);
                };
                const clickBack = async () => {
                  await jsClick(`(() => { const b = document.getElementById('btn-back'); if (b) b.click(); })()`);
                };

                // 4) 导航:动作 → 表情,点第二个表情 chip(Smile)
                await clickMenuItem('动作');
                await clickMenuItem('表情');
                const chip = await mc.executeJavaScript(`(() => {
                  const chips = document.querySelectorAll('.chips .chip');
                  return chips.length ? JSON.stringify({ count: chips.length, names: [...chips].map((c) => c.textContent) }) : 'NO_CHIP';
                })()`);
                console.log('MENUTEST 表情面板:', chip);
                if (chip !== 'NO_CHIP') await clickChip(1);
                // 5) 返回 → 动作面板,点第一个动作 chip → 角色播放动作 + 菜单关闭
                await clickBack();
                await clickMenuItem('动作');
                const motChip = await mc.executeJavaScript(`(() => {
                  const chips = document.querySelectorAll('.chips .chip');
                  return chips.length ? JSON.stringify({ count: chips.length, names: [...chips].map((c) => c.textContent) }) : 'NO_MOTION';
                })()`);
                console.log('MENUTEST 动作面板:', motChip);
                if (motChip !== 'NO_MOTION') await clickChip(0);
                await sleepMs(600);
                const closedAfterMotion = !(menuWin && !menuWin.isDestroyed() && menuWin.isVisible());
                console.log('MENUTEST 点动作后菜单是否关闭:', closedAfterMotion, '(期望 true)');

                // 6) 再次右键打开菜单(此时已关闭,应正常打开),设置 → 常规设置 → 点"大" → 角色窗口变大,再恢复中号
                win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: op.x, y: op.y });
                win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: op.x, y: op.y });
                await sleepMs(700);
                await clickMenuItem('设置');
                await clickMenuItem('常规设置');
                await jsClick(`(() => {
                  const b = [...document.querySelectorAll('.seg-btn')].find((x) => x.textContent === '大');
                  if (b) b.click();
                })()`);
                await sleepMs(700);
                const afterSize = win.getBounds();
                console.log('MENUTEST 点"大"后角色窗口:', JSON.stringify(afterSize), '(期望宽高变大)');
                await jsClick(`(() => {
                  const b = [...document.querySelectorAll('.seg-btn')].find((x) => x.textContent === '中');
                  if (b) b.click();
                })()`);
                await sleepMs(700);
                // 7) 角色动画状态检查(动作是否执行)
                const animNow = await win.webContents.executeJavaScript(`(() => {
                  const s = window.__lilySpine;
                  const t = s && s.state && s.state.getCurrent(0);
                  return t ? t.animation.name : '?';
                })()`);
                console.log('MENUTEST 当前动画:', animNow);
                // 8) 返回根菜单(常规设置 → 设置二级列表 → 根菜单) → 状态 → "边界调试"开关 → 显示调试覆盖层,再点一次关闭
                await clickBack();
                await clickBack();
                await clickMenuItem('状态');
                await jsClick(`(() => {
                  const r = [...document.querySelectorAll('.opt-row')].find((x) => x.textContent.includes('边界调试'));
                  if (r) r.click();
                })()`);
                await sleepMs(500);
                const bndAfter = await win.webContents.executeJavaScript(`(() => {
                  const ov = document.getElementById('debug-overlay');
                  return JSON.stringify({ boundsShown: !ov.classList.contains('hidden') });
                })()`);
                console.log('MENUTEST 边界调试开关后覆盖层:', bndAfter, '(期望 boundsShown=true)');
                await jsClick(`(() => {
                  const r = [...document.querySelectorAll('.opt-row')].find((x) => x.textContent.includes('边界调试'));
                  if (r) r.click();
                })()`);
                await sleepMs(500);
                // 9) Esc 关闭菜单
                await jsClick(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); })()`);
                await sleepMs(500);
                console.log('MENUTEST Esc 后菜单可见:', !!(menuWin && !menuWin.isDestroyed() && menuWin.isVisible()), '(期望 false)');
              }
            }
            // scenetest: 内置"台词与场景"面板(设置 → 台词与场景)自测:
            // 面板渲染(18 场景卡 + 11 冷却输入 + 允许打断开关)→ 修改冷却 → 保存 →
            // 台词文件落盘 + 桌宠热重载(主进程冷却同步)→ 恢复原值(不污染用户文件)
            if (target === 'scenetest') {
              await sleepMs(600);
              const openPos = await win.webContents.executeJavaScript(`(() => {
                const s = window.__lilySpine;
                if (!s) return '{"x":100,"y":200}';
                const b = s.getBounds();
                const cv = document.querySelector('#stage-anchor > canvas').getBoundingClientRect();
                return JSON.stringify({
                  x: Math.round(cv.left + b.x + b.width / 2),
                  y: Math.round(cv.top + b.y + b.height * 0.3),
                });
              })()`);
              const op = JSON.parse(openPos);
              win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: op.x, y: op.y });
              win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: op.x, y: op.y });
              await sleepMs(700);
              if (menuWin && !menuWin.isDestroyed()) {
                const mc = menuWin.webContents;
                const jsClick = async (script) => { await mc.executeJavaScript(script); await sleepMs(300); };
                const clickMenuItem = async (label) => {
                  await jsClick(`(() => {
                    const it = [...document.querySelectorAll('.menu-item')].find((x) => {
                      const s = x.querySelector('.item-label span');
                      return s && s.textContent === ${JSON.stringify(label)};
                    });
                    if (it) it.click();
                  })()`);
                };
                // 1) 导航:设置 → 台词与场景
                await clickMenuItem('设置');
                await clickMenuItem('台词与场景');
                await sleepMs(800); // 面板异步读取台词文件
                // 2) 面板结构检查
                const panelInfo = await mc.executeJavaScript(`(() => {
                  const cards = document.querySelectorAll('.scn-card').length;
                  const cds = document.querySelectorAll('.scn-cd-input').length;
                  const sw = document.querySelector('.opt-row .switch');
                  return JSON.stringify({ cards, cds, switchOn: sw ? sw.classList.contains('on') : null });
                })()`);
                console.log('SCENETEST 面板结构:', panelInfo, '(期望 cards=18 cds=11 switchOn=true)');
                // 面板截图(菜单窗口,供人工核对视觉效果)
                const pout = await mc.capturePage();
                fs.writeFileSync(path.join(__dirname, '..', 'debug-scenetest-panel.png'), pout.toPNG());
                console.log('SCENETEST_PANEL_SHOT_SAVED: debug-scenetest-panel.png');
                // 3) 修改 10_typing 冷却为 7777 → 保存
                await jsClick(`(() => {
                  const input = document.querySelector('.scn-cd-input');
                  input.value = '7777';
                  input.dispatchEvent(new Event('change'));
                  const b = document.querySelector('.scn-btn.primary');
                  if (b) b.click();
                })()`);
                await sleepMs(800);
                // 4) 校验:台词文件已写入 + 主进程冷却已热重载同步(全链路)
                const fileOk = fs.readFileSync(linesFilePath(), 'utf8').includes('"10_typing": 7777');
                console.log('SCENETEST 文件写入 10_typing=7777:', fileOk, '| 主进程冷却 typing=' + SCENE_COOLDOWN.typing, '(期望 7777)');
                // 5) 恢复原值 4000 再保存(不污染用户台词文件)
                await jsClick(`(() => {
                  const input = document.querySelector('.scn-cd-input');
                  input.value = '4000';
                  input.dispatchEvent(new Event('change'));
                  const b = document.querySelector('.scn-btn.primary');
                  if (b) b.click();
                })()`);
                await sleepMs(800);
                console.log('SCENETEST 恢复后 typing=' + SCENE_COOLDOWN.typing, '(期望 4000)');
                // 6) Esc 关闭菜单
                await jsClick(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); })()`);
                await sleepMs(500);
                console.log('SCENETEST 菜单已关闭:', !(menuWin && !menuWin.isDestroyed() && menuWin.isVisible()), '(期望 true)');
              } else {
                console.log('SCENETEST FAIL: 菜单窗口未打开');
              }
            }
            const out = await win.webContents.capturePage();
            const file = path.join(__dirname, '..', `debug-${target}.png`);
            fs.writeFileSync(file, out.toPNG());
            console.log(`DEBUG_SHOT_SAVED: ${file}`);
            // 独立记数窗口截图(若有)
            if (counterWin && !counterWin.isDestroyed() && counterWin.isVisible()) {
              const cimg = await counterWin.webContents.capturePage();
              fs.writeFileSync(path.join(__dirname, '..', `debug-${target}-counter.png`), cimg.toPNG());
              console.log(`DEBUG_COUNTER_SHOT_SAVED: debug-${target}-counter.png`);
            }
            // 菜单相关目标:额外截取菜单窗口
            if ((target === 'menu' || target === 'menutest') && menuWin && !menuWin.isDestroyed() && menuWin.isVisible()) {
              const mout = await menuWin.webContents.capturePage();
              fs.writeFileSync(path.join(__dirname, '..', `debug-${target}-menu.png`), mout.toPNG());
              console.log(`DEBUG_MENU_SHOT_SAVED: debug-${target}-menu.png`);
            }
          } catch (e) {
            console.error('DEBUG_SHOT_FAILED:', e.message);
          }
          // realdrag:渲染进程会连续测量约 6 秒,给外部真实鼠标拖拽留足时间
          // throughtest:由渲染进程发 pet:debug-done 触发退出,这里只留兜底超时
          const quitDelay = target === 'realdrag' ? 12000 : (target === 'throughtest' ? 15000 : 400);
          setTimeout(() => { quitting = true; app.quit(); }, quitDelay);
        }, 3500);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (!quitting) {
      // 关窗=隐藏到托盘
      if (win) win.hide();
    } else {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    quitting = true;
    stopSensor();
    saveCounterNow(); // 记数数据立即落盘(防抖保存可能尚未触发)
    if (menuWin && !menuWin.isDestroyed()) menuWin.destroy();
    if (counterWin && !counterWin.isDestroyed()) counterWin.destroy();
    if (win && config) {
      const [x, y] = win.getPosition();
      config.x = x; config.y = y;
      saveConfig();
    }
  });
}
