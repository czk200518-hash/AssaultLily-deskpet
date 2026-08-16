// 突击莉莉桌宠 - 预加载脚本(安全桥接)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  setConfig: (patch) => ipcRenderer.invoke('pet:set-config', patch),
  dragMove: (x, y) => ipcRenderer.send('pet:drag-move', x, y),
  setPosition: (x, y) => ipcRenderer.invoke('pet:set-position', x, y),
  getPosition: () => ipcRenderer.invoke('pet:get-position'),
  getBounds: () => ipcRenderer.invoke('pet:get-bounds'),
  resize: (w, h, anchor) => ipcRenderer.invoke('pet:resize', w, h, anchor),
  openMenu: (state) => ipcRenderer.invoke('pet:open-menu', state),
  closeMenu: () => ipcRenderer.invoke('pet:close-menu'),
  onMenuAction: (cb) => ipcRenderer.on('pet:menu-action', (_e, action) => cb(action)),
  onMenuClosed: (cb) => ipcRenderer.on('pet:menu-closed', () => cb()),
  onSceneEvent: (cb) => ipcRenderer.on('pet:scene-event', (_e, ev) => cb(ev)),
  onLinesSaved: (cb) => ipcRenderer.on('pet:lines-saved', () => cb()),
  setSceneSettings: (s) => ipcRenderer.send('pet:set-scene-settings', s),
  setCounter: (patch) => ipcRenderer.invoke('pet:set-counter', patch),
  getWorkArea: () => ipcRenderer.invoke('pet:get-work-area'),
  setInteractive: (v) => ipcRenderer.invoke('pet:set-interactive', v),
  setOutline: (v) => ipcRenderer.invoke('pet:set-outline', v),
  onCursorPoll: (cb) => ipcRenderer.on('pet:cursor-poll', (_e, pos) => cb(pos)),
  hide: () => ipcRenderer.invoke('pet:hide'),
  show: () => ipcRenderer.invoke('pet:show'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  debugCapture: (name) => ipcRenderer.invoke('pet:debug-capture', name),
  readAsset: (name) => ipcRenderer.invoke('pet:read-asset', name),
  debugLog: (msg) => ipcRenderer.invoke('pet:debug-log', msg),
  debugDone: () => ipcRenderer.send('pet:debug-done'),
  debugInfo: () => ipcRenderer.invoke('pet:debug-info'),
  debugIgnore: () => ipcRenderer.invoke('pet:debug-ignore'),
  isDebug: () => process.argv.includes('--debug-shot'),
  debugTarget: (() => {
    const i = process.argv.indexOf('--debug-shot');
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
  })(),
});
