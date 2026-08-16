// 菜单窗口预加载脚本 - 与主进程通信
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('menuAPI', {
  // 发送动作到主进程(转发给角色窗口)
  action: (type, value) => ipcRenderer.send('menu:action', { type, value }),
  // 播放完关闭动画后请求主进程隐藏菜单窗口
  close: () => ipcRenderer.send('menu:close'),
  // 按内容自适应窗口尺寸(主进程按工作区夹取)
  resize: (w, h) => ipcRenderer.send('menu:resize', w, h),
  // 接收主进程注入的菜单状态(每次打开都会注入一次)
  onState: (cb) => ipcRenderer.on('menu:state', (_e, state) => cb(state)),
  // 主动拉取当前菜单状态(冷启动页面加载完成后调用,防止推送在监听器注册前到达而丢失)
  getState: () => ipcRenderer.invoke('menu:get-state'),
  // 主进程请求关闭(失焦/点击角色/再次右键)→ 由渲染进程播放关闭动画
  onCloseRequest: (cb) => ipcRenderer.on('menu:close-request', () => cb()),
  // 读取 renderer 目录内的资产(主题 CSS/目录等,与角色窗口同一安全通道)
  readAsset: (name) => ipcRenderer.invoke('pet:read-asset', name),
  // 保存台词文件(内置"台词与场景"编辑器):主进程写入外部台词文件并通知角色窗口热重载
  saveLines: (text) => ipcRenderer.invoke('pet:save-lines', text),
});
