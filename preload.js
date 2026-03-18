const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  onData: (callback) => ipcRenderer.on('terminal-data', (_event, data) => callback(data)),
  sendInput: (data) => ipcRenderer.send('terminal-input', data),
  sendResize: (cols, rows) => ipcRenderer.send('terminal-resize', { cols, rows }),
  onBannerUpdate: (callback) => ipcRenderer.on('update-banner', (_event, data) => callback(data)),
  setTitle: (title) => ipcRenderer.send('set-title', title),
  ready: () => ipcRenderer.send('terminal-ready'),
  onMenuCopy: (callback) => ipcRenderer.on('menu-copy', () => callback()),
  onMenuPaste: (callback) => ipcRenderer.on('menu-paste', () => callback()),
  onMenuSelectAll: (callback) => ipcRenderer.on('menu-select-all', () => callback()),
  onMenuClear: (callback) => ipcRenderer.on('menu-clear', () => callback()),
  onMenuZoom: (callback) => ipcRenderer.on('menu-zoom', (_event, direction) => callback(direction)),
});
