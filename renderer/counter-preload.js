// 独立记数窗口预加载脚本 - 与主进程通信
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('counterAPI', {
  // 冷启动拉取最新快照(推送可能早于监听器注册而丢失)
  getState: () => ipcRenderer.invoke('counter:get-state'),
  // 主进程实时推送(每次击键/周期切换)
  onUpdate: (cb) => ipcRenderer.on('counter:update', (_e, s) => cb(s)),
  // 内容尺寸变化上报(窗口按内容自适应)
  resize: (w, h) => ipcRenderer.send('counter:resize', w, h),
  // 读取 renderer 目录内的资产(主题 CSS 等,与角色窗口同一安全通道)
  readAsset: (name) => ipcRenderer.invoke('pet:read-asset', name),
});
