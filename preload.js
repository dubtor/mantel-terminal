const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminalAPI', {
  // Tab lifecycle
  ready: () => ipcRenderer.send('terminal-ready'),
  createTab: (opts) => ipcRenderer.send('create-tab', opts),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
  setActiveTab: (tabId) => ipcRenderer.send('set-active-tab', tabId),
  onTabCreated: (cb) => ipcRenderer.on('tab-created', (_e, payload) => cb(payload)),
  onTabClosed: (cb) => ipcRenderer.on('tab-closed', (_e, tabId) => cb(tabId)),
  onTabTitle: (cb) => ipcRenderer.on('tab-title', (_e, tabId, title) => cb(tabId, title)),
  onTabBell: (cb) => ipcRenderer.on('tab-bell', (_e, tabId) => cb(tabId)),
  onTabBellClear: (cb) => ipcRenderer.on('tab-bell-clear', (_e, tabId) => cb(tabId)),

  // Terminal I/O (per tab)
  onData: (cb) => ipcRenderer.on('terminal-data', (_e, tabId, data) => cb(tabId, data)),
  sendInput: (tabId, data) => ipcRenderer.send('terminal-input', tabId, data),
  sendResize: (tabId, cols, rows) => ipcRenderer.send('terminal-resize', tabId, cols, rows),

  // Project info (per tab)
  onProjectUpdate: (cb) => ipcRenderer.on('update-project', (_e, tabId, payload) => cb(tabId, payload)),

  // Window-level
  setTitle: (title) => ipcRenderer.send('set-title', title),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openInFinder: (dirPath) => ipcRenderer.send('open-in-finder', dirPath),
  getRecentDirs: () => ipcRenderer.invoke('get-recent-dirs'),
  navigateToDir: (dir) => ipcRenderer.send('navigate-to-dir', dir),
  getScripts: (cwd) => ipcRenderer.invoke('get-scripts', cwd),
  runScript: (command) => ipcRenderer.send('run-script', command),

  // Theme
  onSetTheme: (cb) => ipcRenderer.on('set-theme', (_e, theme) => cb(theme)),

  // Menu actions
  onMenuCopy: (cb) => ipcRenderer.on('menu-copy', () => cb()),
  onMenuPaste: (cb) => ipcRenderer.on('menu-paste', () => cb()),
  onMenuSelectAll: (cb) => ipcRenderer.on('menu-select-all', () => cb()),
  onMenuClear: (cb) => ipcRenderer.on('menu-clear', () => cb()),
  onMenuZoom: (cb) => ipcRenderer.on('menu-zoom', (_e, direction) => cb(direction)),

  // Tab navigation from menu
  onSwitchTab: (cb) => ipcRenderer.on('switch-tab', (_e, target) => cb(target)),
  onRequestNewTab: (cb) => ipcRenderer.on('request-new-tab', () => cb()),
  onRequestCloseTab: (cb) => ipcRenderer.on('request-close-tab', () => cb()),
});
