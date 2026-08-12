'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

// 在渲染进程脚本（assets-manifest.js / config.js）执行前注入「运行时素材根目录」。
// 注意：preload 运行在渲染进程上下文，主进程专属的 app 模块在这里不可用，
// 所以不依赖 app.isPackaged，改为按路径存在性判断素材目录：
//   1) 打包后素材在 resources/Material
//   2) 开发期在项目内 Material（随仓库提交，克隆即可用）
//   3) 兼容外层 Material（旧目录布局）
const _candidates = [
  path.join(process.resourcesPath || '', 'Material'), // 打包后
  path.join(__dirname, 'Material'),                   // 项目内（仓库）
  path.join(__dirname, '..', 'Material'),              // 外层兼容
];
var _materialRoot = path.join(__dirname, 'Material');
for (var i = 0; i < _candidates.length; i++) {
  if (_candidates[i] && fs.existsSync(_candidates[i])) { _materialRoot = _candidates[i]; break; }
}
window.ASSET_BASE = _materialRoot.replace(/\\/g, '/');

const api = {
  getMaterialPath: () => ipcRenderer.invoke('get-material-path'),
  getBaseSize: () => ipcRenderer.invoke('get-base-size'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (patch) => ipcRenderer.invoke('save-settings', patch),
  getDisplayInfo: () => ipcRenderer.invoke('get-display-info'),
  onCursor: (cb) => ipcRenderer.on('cursor', (e, p) => cb(p)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (e, s) => cb(s)),
  onKeyboardActivity: (cb) => ipcRenderer.on('keyboard-active', (e, active) => cb(!!active)),
  onSystemEvent: (cb) => ipcRenderer.on('system-event', (e, name) => cb(name)),
  onWindowBlur: (cb) => ipcRenderer.on('window-blur', () => cb()),
  onWindowFocus: (cb) => ipcRenderer.on('window-focus', () => cb()),
  onDragAbort: (cb) => ipcRenderer.on('drag-abort', () => cb()),
  sendPetCommand: (cmd) => ipcRenderer.send('pet-command', cmd),
  // 右键菜单交给主进程弹原生菜单（可超出 360px 小窗、支持多级子菜单）
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  // 待机姿态独立浮层（可连续多选，不受原生菜单「点一个就关」限制）
  onIdlePickerInit: (cb) => ipcRenderer.on('idle-picker-init', (e, d) => cb(d)),
  sendIdlePickerChange: (arr) => ipcRenderer.send('idle-picker-change', arr),
  sendIdlePickerDone: () => ipcRenderer.send('idle-picker-done'),
  onPetCommand: (cb) => ipcRenderer.on('pet-command', (e, cmd) => cb(cmd)),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', dx, dy),
  setIgnoreMouse: (on) => ipcRenderer.send('set-ignore-mouse', !!on),
  // 光标是否落在画布的全透明区域：为 true 时主进程会让点击穿透到桌面
  setHitTransparent: (on) => ipcRenderer.send('set-hit-transparent', !!on),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  openPanel: () => ipcRenderer.send('open-panel'),
  hidePet: () => ipcRenderer.send('hide-pet'),
  // 全屏场景专用隐藏：只隐藏窗口，不改变 manualHidden / petVisible，
  // 否则退出全屏时全屏检测会以为"是用户手动藏起来的"而不再自动显示回来。
  fsHide: () => ipcRenderer.send('hide-for-fullscreen'),
  // 心情系统：宠物把情绪档实时上报给主进程，由主进程转发设置面板
  reportMood: (level) => ipcRenderer.send('report-mood', level),
  // 设置面板监听宠物上报的心情档，刷新心情显示
  onMood: (cb) => ipcRenderer.on('mood', (e, level) => cb(level)),
  showPet: () => ipcRenderer.send('show-pet'),
  togglePet: () => ipcRenderer.send('toggle-pet'),
  quit: () => ipcRenderer.send('quit'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
