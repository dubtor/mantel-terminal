const { app, BrowserWindow, ipcMain, nativeImage, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const sharp = require('sharp');
const { execSync, spawn } = require('child_process');

app.setName('Mantel');
app.setAboutPanelOptions({
  applicationName: 'Mantel',
  applicationVersion: require('./package.json').version,
  copyright: '© 2026 Robert Clemens (@dubtor), 83 Ventures\nhttps://www.83ventures.io',
  iconPath: path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'icon.png'),
});

// Track all open terminal windows: windowId -> { window, tabs, activeTabId, startDir }
// Each tab: tabId -> { ptyProcess, pollInterval, startDir, lastCwd, lastSSHHost }
const windows = new Map();
let nextTabId = 1;

const TERMINAL_DIR = '.mantel';
const MANTEL_HOME = path.join(process.env.HOME || '', '.mantel');
const RECENT_DIRS_PATH = path.join(MANTEL_HOME, 'recent_dirs.json');
const MAX_RECENT_DIRS = 20;

function loadRecentDirs() {
  try {
    if (fs.existsSync(RECENT_DIRS_PATH)) {
      return JSON.parse(fs.readFileSync(RECENT_DIRS_PATH, 'utf8'));
    }
  } catch (_e) { /* ignore */ }
  return [];
}

function saveRecentDirs(dirs) {
  try {
    if (!fs.existsSync(MANTEL_HOME)) fs.mkdirSync(MANTEL_HOME, { recursive: true });
    fs.writeFileSync(RECENT_DIRS_PATH, JSON.stringify(dirs));
  } catch (_e) { /* ignore */ }
}

function addRecentDir(dir) {
  const home = process.env.HOME || '';
  // Skip home directory itself — not useful as a "recent" entry
  if (dir === home) return;
  let dirs = loadRecentDirs();
  dirs = dirs.filter(d => d !== dir);
  dirs.unshift(dir);
  if (dirs.length > MAX_RECENT_DIRS) dirs = dirs.slice(0, MAX_RECENT_DIRS);
  saveRecentDirs(dirs);
  rebuildMenuWithRecent();
}

// Built-in themes
const THEMES = {
  'Default': {
    background: '#000000', foreground: '#f7fbfc', cursor: '#f7fbfc',
    selectionBackground: '#3e4d5b',
    black: '#000000', red: '#c91b00', green: '#00c200', yellow: '#c7c400',
    blue: '#0225c7', magenta: '#c930c7', cyan: '#00c5c7', white: '#c7c7c7',
    brightBlack: '#686868', brightRed: '#ff6e67', brightGreen: '#5ffa68',
    brightYellow: '#fffc67', brightBlue: '#6871ff', brightMagenta: '#ff76ff',
    brightCyan: '#60fdff', brightWhite: '#ffffff',
  },
  'Homebrew': {
    background: '#000000', foreground: '#28fe14', cursor: '#38fe2c',
    selectionBackground: '#083a9466',
    black: '#000000', red: '#990000', green: '#00a600', yellow: '#999900',
    blue: '#0000b2', magenta: '#b200b2', cyan: '#00a6b2', white: '#bfbfbf',
    brightBlack: '#666666', brightRed: '#e50000', brightGreen: '#00d900',
    brightYellow: '#e5e500', brightBlue: '#0000ff', brightMagenta: '#e500e5',
    brightCyan: '#00e5e5', brightWhite: '#e5e5e5',
  },
  'Pro': {
    background: '#000000', foreground: '#f2f2f2', cursor: '#4d4d4d',
    selectionBackground: '#41414166',
    black: '#000000', red: '#990000', green: '#00a600', yellow: '#999900',
    blue: '#2009db', magenta: '#b200b2', cyan: '#00a6b2', white: '#bfbfbf',
    brightBlack: '#666666', brightRed: '#e50000', brightGreen: '#00d900',
    brightYellow: '#e5e500', brightBlue: '#0000ff', brightMagenta: '#e500e5',
    brightCyan: '#00e5e5', brightWhite: '#e5e5e5',
  },
  'Ocean': {
    background: '#224fbc', foreground: '#ffffff', cursor: '#7f7f7f',
    selectionBackground: '#216dff66',
    black: '#000000', red: '#990000', green: '#00a600', yellow: '#999900',
    blue: '#0000b2', magenta: '#b200b2', cyan: '#00a6b2', white: '#bfbfbf',
    brightBlack: '#666666', brightRed: '#e50000', brightGreen: '#00d900',
    brightYellow: '#e5e500', brightBlue: '#0000ff', brightMagenta: '#e500e5',
    brightCyan: '#00e5e5', brightWhite: '#e5e5e5',
  },
  'Solarized Dark': {
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1',
    selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'Solarized Light': {
    background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75',
    selectionBackground: '#eee8d5',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75',
    brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  'Dracula': {
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
    brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
    brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  'Nord': {
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'Tokyo Night': {
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a',
    brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  },
  'One Dark': {
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
    brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
    brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
  'Catppuccin': {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc',
    selectionBackground: '#585b7066',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#cba6f7', cyan: '#89dceb', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
    brightCyan: '#89dceb', brightWhite: '#a6adc8',
  },
};

function loadTheme() {
  const themePath = path.join(MANTEL_HOME, 'theme.json');
  try {
    if (fs.existsSync(themePath)) {
      const data = JSON.parse(fs.readFileSync(themePath, 'utf8'));
      if (typeof data === 'string') {
        const name = Object.keys(THEMES).find(k => k.toLowerCase() === data.toLowerCase()) || 'Default';
        return { name, theme: THEMES[name] || THEMES['Default'] };
      }
      if (data.preset) {
        const name = Object.keys(THEMES).find(k => k.toLowerCase() === data.preset.toLowerCase()) || 'Default';
        const { preset, ...overrides } = data;
        return { name: null, theme: { ...(THEMES[name] || THEMES['Default']), ...overrides } };
      }
      return { name: null, theme: { ...THEMES['Default'], ...data } };
    }
  } catch (_e) { /* ignore */ }
  return { name: 'Default', theme: THEMES['Default'] };
}

let { name: currentThemeName, theme: terminalTheme } = loadTheme();

function setTheme(name) {
  if (!THEMES[name]) return;
  currentThemeName = name;
  terminalTheme = THEMES[name];
  // Save preference
  try {
    fs.mkdirSync(MANTEL_HOME, { recursive: true });
    fs.writeFileSync(path.join(MANTEL_HOME, 'theme.json'), JSON.stringify(name));
  } catch (_e) { /* ignore */ }
  // Apply to all windows
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('set-theme', terminalTheme);
    win.setBackgroundColor(terminalTheme.background);
  }
  rebuildMenuWithRecent();
}
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

function detectGitInfo(cwd) {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    if (!gitRoot) return null;
    const branch = execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
    let remoteUrl = null;
    try {
      const raw = execSync('git remote get-url origin 2>/dev/null', { cwd, encoding: 'utf8', timeout: 1000 }).trim();
      if (raw) {
        remoteUrl = raw
          .replace(/^git@github\.com:/, 'https://github.com/')
          .replace(/^git@([^:]+):/, 'https://$1/')
          .replace(/\.git$/, '');
      }
    } catch (_e) { /* no remote */ }
    return { branch, remoteUrl };
  } catch (_e) {
    return null;
  }
}

function findProjectConfig(cwd) {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const terminalDir = path.join(dir, TERMINAL_DIR);
    // Skip ~/.mantel — that's the global config, not a project
    if (terminalDir === MANTEL_HOME) { dir = path.dirname(dir); continue; }
    if (fs.existsSync(terminalDir)) {
      let config = {};
      const configPath = path.join(terminalDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (_e) { /* */ }
      }
      let iconPath = null;
      if (config.icon) {
        const resolved = path.isAbsolute(config.icon) ? config.icon : path.resolve(dir, config.icon);
        if (fs.existsSync(resolved)) iconPath = resolved;
      }
      return {
        config,
        iconData: iconPath ? fileToDataURL(iconPath) : null,
        iconPath,
        projectRoot: dir,
      };
    }
    dir = path.dirname(dir);
  }
  return { config: {}, iconData: null, iconPath: null, projectRoot: null };
}

function fileToDataURL(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  const mime = mimeTypes[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

const COLORS = [
  '#f38ba8', '#fab387', '#f9e2af', '#a6e3a1',
  '#89dceb', '#74c7ec', '#89b4fa', '#b4befe',
  '#cba6f7', '#f5c2e7', '#eba0ac', '#94e2d5',
];

function isLightColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function hashColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

const BASE_ICON_PATH = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'icon.png');
const ASSETS_DIR = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'assets');

// Map of process names to custom base dock icons.
// When a matching process is detected running in the active tab,
// the dock icon base is swapped to the program-specific icon.
const PROGRAM_ICONS = {
  claude: path.join(ASSETS_DIR, 'icon-claude.png'),
};

async function updateDockIcon(projectName, config, iconPath, emoji, programBaseIcon) {
  if (process.platform !== 'darwin') return;
  try {
    const baseSize = 512;
    const badgeSize = 200;
    const strokeWidth = 8;
    const overhang = Math.round(badgeSize * 0.3);
    const canvasSize = baseSize + overhang;
    const baseOffset = Math.round(overhang * 0.35);
    const badgeLeft = canvasSize - badgeSize - 8;
    const badgeTop = canvasSize - badgeSize - 8;

    const baseIconPath = programBaseIcon || BASE_ICON_PATH;
    const baseBuffer = await sharp(baseIconPath)
      .resize(baseSize, baseSize)
      .png().toBuffer();

    let badgeBuffer;
    if (iconPath) {
      badgeBuffer = await sharp(iconPath)
        .resize(badgeSize, badgeSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
    } else if (emoji && SPECIAL_DIR_ICONS[emoji]) {
      const bgColor = hashColor(projectName);
      const light = isLightColor(bgColor);
      const iconColor = light ? '#1e1e2e' : '#ffffff';
      const strokeColor = light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
      const r = badgeSize / 2;
      const iconInnerSize = Math.round(badgeSize * 0.65);
      const iconOffset = Math.round((badgeSize - iconInnerSize) / 2);
      const bgSvg = `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
      </svg>`;
      const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
      const iconSvg = buildSpecialDirIconSvg(emoji, iconInnerSize, iconColor);
      const iconSvgBuffer = await sharp(Buffer.from(iconSvg)).png().toBuffer();
      badgeBuffer = await sharp(bgBuffer)
        .composite([{ input: iconSvgBuffer, left: iconOffset, top: iconOffset }])
        .png().toBuffer();
    } else {
      const bgColor = (config && config.backgroundColor) || hashColor(projectName);
      const light = isLightColor(bgColor);
      const textColor = light ? '#1e1e2e' : '#ffffff';
      const initial = projectName.charAt(0).toUpperCase() + (projectName.length > 1 ? projectName.charAt(1).toLowerCase() : '');
      const r = badgeSize / 2;
      const strokeColor = light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
      const badgeSvg = `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
              font-family="SF Pro Display, Helvetica Neue, Arial, sans-serif"
              font-size="95" font-weight="700" fill="${textColor}">${initial}</text>
      </svg>`;
      badgeBuffer = await sharp(Buffer.from(badgeSvg)).png().toBuffer();
    }

    const canvas = sharp({
      create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png();
    const iconBuffer = await canvas
      .composite([
        { input: baseBuffer, left: baseOffset, top: baseOffset },
        { input: badgeBuffer, left: badgeLeft, top: badgeTop },
      ])
      .png().toBuffer();

    const image = nativeImage.createFromBuffer(iconBuffer);
    app.dock.setIcon(image);
  } catch (e) {
    console.error('Failed to set dock icon:', e);
  }
}

// Count all tabs with unread bell notifications and update the dock badge
function updateBellBadge() {
  let total = 0;
  for (const [, entry] of windows) {
    for (const [, tab] of entry.tabs) {
      if (tab.hasBell) total++;
    }
  }
  app.dock.setBadge(total > 0 ? String(total) : '');
}

// Clear bell for a specific tab and update badge
function clearTabBell(windowId, tabId) {
  const entry = windows.get(windowId);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  if (tab && tab.hasBell) {
    tab.hasBell = false;
    entry.window.webContents.send('tab-bell-clear', tabId);
    updateBellBadge();
  }
}

const SPECIAL_DIR_ICONS = {
  home: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  desktop: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  downloads: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  documents: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  ssh: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`,
};

const SPECIAL_DIRS = {};

function initSpecialDirs() {
  const home = process.env.HOME;
  if (home) {
    SPECIAL_DIRS[home] = { icon: 'home', name: 'Home' };
    SPECIAL_DIRS[path.join(home, 'Desktop')] = { icon: 'desktop', name: 'Desktop' };
    SPECIAL_DIRS[path.join(home, 'Downloads')] = { icon: 'downloads', name: 'Downloads' };
    SPECIAL_DIRS[path.join(home, 'Documents')] = { icon: 'documents', name: 'Documents' };
  }
}

function getSpecialDir(cwd) { return SPECIAL_DIRS[cwd] || null; }

const SSH_COLOR = '#e06c75';

function detectSSH(shellPid) {
  try {
    const result = execSync(`ps -o pid=,command= -p $(pgrep -P ${shellPid} ssh 2>/dev/null || echo 0) 2>/dev/null`, {
      encoding: 'utf8', timeout: 1000,
    }).trim();
    if (!result) return null;
    const match = result.match(/ssh\s+(?:.*?\s+)?(?:(\S+)@)?(\S+)\s*$/);
    if (match) return { user: match[1] || null, host: match[2] };
    return null;
  } catch (_e) { return null; }
}

function getRunningChildren(shellPid) {
  try {
    const result = execSync(`ps -e -o pid,ppid,comm | awk -v p=${shellPid} '$2==p && $1!=p {print $3}'`, {
      encoding: 'utf8', timeout: 1000,
    }).trim();
    if (!result) return [];
    const names = result.split('\n').map(n => path.basename(n.trim())).filter(Boolean);
    return [...new Set(names)];
  } catch (_e) { return []; }
}

// Detect if a known program (from PROGRAM_ICONS) is running as a child of the shell.
// Returns the base icon path for that program, or null if none matched.
function detectProgramIcon(shellPid) {
  const children = getRunningChildren(shellPid);
  for (const child of children) {
    if (PROGRAM_ICONS[child]) return PROGRAM_ICONS[child];
  }
  return null;
}

function getWindowRunningProcesses(entry) {
  const all = [];
  for (const [, tab] of entry.tabs) {
    all.push(...getRunningChildren(tab.ptyProcess.pid));
  }
  return [...new Set(all)];
}

function buildSpecialDirIconSvg(iconKey, size, color) {
  const svgFn = SPECIAL_DIR_ICONS[iconKey];
  if (!svgFn) return null;
  return svgFn(color).replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
}

function getDirFromArgs(argv) {
  return argv.slice(1).find(arg => {
    try { return !arg.startsWith('-') && !arg.includes('electron') && !arg.endsWith('.js') && !arg.endsWith('.') && fs.existsSync(arg) && fs.statSync(arg).isDirectory(); }
    catch (_e) { return false; }
  });
}

function getStartDir() {
  return getDirFromArgs(process.argv) || process.env.HOME || process.cwd();
}

// Build project info payload for a given cwd
function buildProjectPayload(cwd) {
  const { config, iconData, iconPath, projectRoot } = findProjectConfig(cwd);
  const special = getSpecialDir(cwd);
  const displayRoot = projectRoot || cwd;
  const projectName = (special && !projectRoot) ? special.name : (config.name || path.basename(displayRoot));
  const specialIcon = (!projectRoot && special) ? special.icon : null;
  let finalIconData = iconData;
  if (specialIcon && !iconData) {
    const color = isLightColor(hashColor(projectName)) ? '#1e1e2e' : '#ffffff';
    const svg = buildSpecialDirIconSvg(specialIcon, 24, color);
    if (svg) finalIconData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  const gitInfo = detectGitInfo(cwd);
  return { cwd, iconData: finalIconData, projectName, config, gitInfo, iconPath, specialIcon };
}

// Get cwd of a tab's PTY
function getTabCwd(tab) {
  try {
    const pid = tab.ptyProcess.pid;
    const result = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | grep 'cwd' || lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | tail -1 | sed 's/^n//'`, {
      encoding: 'utf8', timeout: 1000,
    }).trim().replace(/^n/, '');
    return result || null;
  } catch (_e) { return null; }
}

// Create a new tab in a window
function createTab(windowId, cwd, opts = {}) {
  const entry = windows.get(windowId);
  if (!entry || entry.window.isDestroyed()) return null;

  const tabId = nextTabId++;
  const shellBin = process.env.SHELL || '/bin/zsh';
  const ptyProc = pty.spawn(shellBin, ['--login'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });

  ptyProc.onData((data) => {
    if (!entry.window.isDestroyed()) {
      entry.window.webContents.send('terminal-data', tabId, data);
      // Bell notification: ignore if this is the active tab of the focused window
      if (data.includes('\x07')) {
        const isActiveInFocusedWindow = entry.activeTabId === tabId && entry.window.isFocused();
        if (!isActiveInFocusedWindow) {
          const tab = entry.tabs.get(tabId);
          if (tab && !tab.hasBell) {
            tab.hasBell = true;
            entry.window.webContents.send('tab-bell', tabId);
            if (!entry.window.isFocused()) {
              app.dock.bounce('informational');
            }
            updateBellBadge();
          }
        }
      }
    }
  });

  ptyProc.onExit(() => {
    closeTab(windowId, tabId);
  });

  // Poll for directory changes, SSH, config changes, and running programs
  let lastCwd = cwd;
  let lastSSHHost = null;
  let lastConfigMtime = 0;
  let lastPkgMtime = 0;
  let lastProgramIcon = null;
  const pollInterval = setInterval(() => {
    try {
      const pid = ptyProc.pid;
      const isActiveTab = entry.activeTabId === tabId;
      const sshInfo = detectSSH(pid);
      const sshHost = sshInfo ? sshInfo.host : null;

      // Check for program icon changes only on the active tab
      let programIcon = null;
      let programIconChanged = false;
      if (isActiveTab) {
        programIcon = detectProgramIcon(pid);
        programIconChanged = programIcon !== lastProgramIcon;
        lastProgramIcon = programIcon;
      }

      if (sshHost !== lastSSHHost) {
        lastSSHHost = sshHost;
        if (sshInfo) {
          const displayName = sshInfo.user ? `${sshInfo.user}@${sshInfo.host}` : sshInfo.host;
          const sshConfig = { backgroundColor: SSH_COLOR };
          const light = isLightColor(SSH_COLOR);
          const iconColor = light ? '#1e1e2e' : '#ffffff';
          const svg = buildSpecialDirIconSvg('ssh', 24, iconColor);
          const sshIconData = svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : null;
          entry.window.webContents.send('update-project', tabId, {
            cwd: displayName, iconData: sshIconData,
            projectName: sshInfo.host, config: sshConfig, gitInfo: null,
          });
          if (isActiveTab && entry.window.isFocused()) {
            updateDockIcon(sshInfo.host, sshConfig, null, 'ssh', programIcon);
          }
          return;
        }
        lastCwd = null; // force refresh
      } else if (sshHost) return;

      const currentTab = entry.tabs.get(tabId);
      if (!currentTab) return;
      const detectedCwd = getTabCwd(currentTab);
      if (!detectedCwd) return;

      // Check if .mantel/config.json or package.json has been modified
      let configChanged = false;
      if (detectedCwd === lastCwd) {
        const { projectRoot } = findProjectConfig(detectedCwd);
        if (projectRoot) {
          const configPath = path.join(projectRoot, TERMINAL_DIR, 'config.json');
          try {
            const mtime = fs.statSync(configPath).mtimeMs;
            if (mtime !== lastConfigMtime) {
              lastConfigMtime = mtime;
              configChanged = true;
            }
          } catch (_e) { /* no config file */ }
        }
        const pkg = findPackageScripts(detectedCwd);
        if (pkg) {
          const pkgPath = path.join(pkg.root, 'package.json');
          try {
            const mtime = fs.statSync(pkgPath).mtimeMs;
            if (mtime !== lastPkgMtime) {
              lastPkgMtime = mtime;
              configChanged = true;
            }
          } catch (_e) { /* */ }
        }
      }

      const cwdChanged = detectedCwd !== lastCwd && fs.existsSync(detectedCwd);
      if (cwdChanged || configChanged) {
        lastCwd = detectedCwd;
        if (cwdChanged) addRecentDir(detectedCwd);
        const payload = buildProjectPayload(detectedCwd);
        entry.window.webContents.send('update-project', tabId, {
          cwd: payload.cwd, iconData: payload.iconData,
          projectName: payload.projectName, config: payload.config, gitInfo: payload.gitInfo,
        });
        entry.window.webContents.send('tab-title', tabId, path.basename(detectedCwd));
        if (isActiveTab) {
          updateDockIcon(payload.projectName, payload.config, payload.iconPath, payload.specialIcon, programIcon);
          updateMenuForDirectory(detectedCwd);
        }
      } else if (programIconChanged && isActiveTab) {
        // Only the running program changed — update dock icon without resending project info
        const payload = buildProjectPayload(detectedCwd || lastCwd);
        updateDockIcon(payload.projectName, payload.config, payload.iconPath, payload.specialIcon, programIcon);
      }
    } catch (_e) { /* ignore */ }
  }, 2000);

  const tab = { ptyProcess: ptyProc, pollInterval, startDir: cwd, lastCwd, lastSSHHost };
  entry.tabs.set(tabId, tab);
  addRecentDir(cwd);

  // If this is the first tab or not background, make it active
  if (!opts.background || entry.tabs.size === 1) {
    entry.activeTabId = tabId;
  }

  // Send initial project info
  const payload = buildProjectPayload(cwd);
  entry.window.webContents.send('tab-created', {
    tabId, cwd, background: !!opts.background,
    project: {
      cwd: payload.cwd, iconData: payload.iconData,
      projectName: payload.projectName, config: payload.config, gitInfo: payload.gitInfo,
    },
  });

  if (entry.activeTabId === tabId) {
    const initProgramIcon = detectProgramIcon(ptyProc.pid);
    updateDockIcon(payload.projectName, payload.config, payload.iconPath, payload.specialIcon, initProgramIcon);
    updateMenuForDirectory(cwd);
  }

  // If a command should be run in this tab
  if (opts.command) {
    setTimeout(() => ptyProc.write(opts.command + '\n'), 300);
  }

  return tabId;
}

function closeTab(windowId, tabId) {
  const entry = windows.get(windowId);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  if (!tab) return;

  clearInterval(tab.pollInterval);
  try { tab.ptyProcess.kill(); } catch (_e) { /* */ }
  entry.tabs.delete(tabId);

  if (!entry.window.isDestroyed()) {
    entry.window.webContents.send('tab-closed', tabId);
  }

  if (entry.tabs.size === 0) {
    if (!entry.window.isDestroyed()) entry.window.close();
  } else if (entry.activeTabId === tabId) {
    // Switch to nearest tab
    entry.activeTabId = entry.tabs.keys().next().value;
  }
}

function createWindow(startDir) {
  startDir = startDir || getStartDir();

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 7 },
    backgroundColor: terminalTheme.background,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
  windows.set(win.id, { window: win, tabs: new Map(), activeTabId: null, startDir });

  win.on('close', (e) => {
    const entry = windows.get(win.id);
    if (entry && !entry.forceClose) {
      const procs = getWindowRunningProcesses(entry);
      if (procs.length > 0) {
        e.preventDefault();
        dialog.showMessageBox(win, {
          buttons: ['Terminate', 'Cancel'],
          defaultId: 1,
          icon: nativeImage.createFromPath(BASE_ICON_PATH),
          message: 'Do you want to terminate running processes in this window?',
          detail: `Closing this window will terminate these running processes: ${procs.join(', ')}`,
        }).then(({ response }) => {
          if (response === 0) {
            entry.forceClose = true;
            win.close();
          }
        });
      }
    }
  });

  win.on('closed', () => {
    const entry = windows.get(win.id);
    if (entry) {
      for (const [, tab] of entry.tabs) {
        clearInterval(tab.pollInterval);
        try { tab.ptyProcess.kill(); } catch (_e) { /* */ }
      }
    }
    windows.delete(win.id);
  });

  // Clear bell for active tab when window regains focus
  win.on('focus', () => {
    const entry = windows.get(win.id);
    if (entry && entry.activeTabId) {
      clearTabBell(win.id, entry.activeTabId);
    }
  });

  return win;
}

// === IPC Handlers ===

ipcMain.on('terminal-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  // Send theme before creating the first tab
  win.webContents.send('set-theme', terminalTheme);
  createTab(win.id, entry.startDir);
});

ipcMain.on('terminal-input', (event, tabId, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  if (tab) tab.ptyProcess.write(data);
});

ipcMain.on('terminal-resize', (event, tabId, cols, rows) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  if (tab) { try { tab.ptyProcess.resize(cols, rows); } catch (_e) { /* */ } }
});

ipcMain.on('create-tab', (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  let cwd = opts.cwd;
  if (!cwd && entry.activeTabId) {
    const activeTab = entry.tabs.get(entry.activeTabId);
    if (activeTab) cwd = getTabCwd(activeTab) || activeTab.startDir;
  }
  cwd = cwd || entry.startDir;
  createTab(win.id, cwd, opts);
});

ipcMain.on('close-tab', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const entry = windows.get(win.id);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  const procs = tab ? getRunningChildren(tab.ptyProcess.pid) : [];
  if (procs.length > 0) {
    dialog.showMessageBox(win, {
      buttons: ['Terminate', 'Cancel'],
      defaultId: 1,
      icon: nativeImage.createFromPath(BASE_ICON_PATH),
      message: 'Do you want to terminate running processes in this tab?',
      detail: `Closing this tab will terminate these running processes: ${procs.join(', ')}`,
    }).then(({ response }) => {
      if (response === 0) closeTab(win.id, tabId);
    });
  } else {
    closeTab(win.id, tabId);
  }
});

ipcMain.on('tab-context-menu', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const entry = windows.get(win.id);
  if (!entry) return;
  const tab = entry.tabs.get(tabId);
  if (!tab) return;

  const procs = getRunningChildren(tab.ptyProcess.pid);
  const cwd = getTabCwd(tab) || tab.startDir;

  const menu = Menu.buildFromTemplate([
    {
      label: 'Move to New Terminal',
      enabled: procs.length === 0 && entry.tabs.size > 1,
      click: () => {
        // Close this tab (kills PTY), then open a new terminal process in the same dir
        closeTab(win.id, tabId);
        if (app.isPackaged) {
          const appPath = path.dirname(path.dirname(path.dirname(app.getAppPath())));
          spawn('open', ['-n', appPath, '--args', cwd], { detached: true, stdio: 'ignore' });
        } else {
          spawn(process.execPath, ['.', cwd], { detached: true, stdio: 'ignore', cwd: __dirname });
        }
      },
    },
  ]);
  menu.popup({ window: win });
});

ipcMain.on('set-active-tab', (event, tabId) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  entry.activeTabId = tabId;
  clearTabBell(win.id, tabId);
  // Update dock icon for the newly active tab
  const tab = entry.tabs.get(tabId);
  if (tab) {
    const cwd = getTabCwd(tab) || tab.startDir;
    const payload = buildProjectPayload(cwd);
    const programIcon = detectProgramIcon(tab.ptyProcess.pid);
    updateDockIcon(payload.projectName, payload.config, payload.iconPath, payload.specialIcon, programIcon);
    updateMenuForDirectory(cwd);
  }
});

ipcMain.on('set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.setTitle(title);
});

ipcMain.on('open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) shell.openExternal(url);
});

ipcMain.on('open-in-finder', (_event, dirPath) => {
  if (typeof dirPath === 'string' && fs.existsSync(dirPath)) shell.openPath(dirPath);
});

ipcMain.on('window-drag-start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    const { screen } = require('electron');
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    win._dragState = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y };
  }
});

ipcMain.on('window-drag-move', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && win._dragState) {
    const { screen } = require('electron');
    const cursor = screen.getCursorScreenPoint();
    win.setBounds({
      x: cursor.x - win._dragState.offsetX,
      y: cursor.y - win._dragState.offsetY,
      width: win.getBounds().width,
      height: win.getBounds().height,
    });
  }
});

ipcMain.on('window-drag-end', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win._dragState = null;
});

// === Recent Directories ===

function navigateToDir(dir) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const entry = windows.get(win.id);
  if (!entry || !entry.activeTabId) return;
  const tab = entry.tabs.get(entry.activeTabId);
  if (!tab) return;
  // Send cd command to the active PTY, escaping single quotes in the path
  const escaped = dir.replace(/'/g, "'\\''");
  tab.ptyProcess.write(`cd '${escaped}'\n`);
}

ipcMain.on('navigate-to-dir', (_event, dir) => {
  navigateToDir(dir);
});

ipcMain.handle('get-recent-dirs', () => loadRecentDirs());

ipcMain.handle('get-scripts', (_event, cwd) => {
  const pkg = findPackageScripts(cwd);
  if (!pkg) return null;
  return { scripts: pkg.scripts, manager: pkg.manager };
});

ipcMain.on('run-script', (_event, command) => {
  runScriptInNewTab(command);
});

// === Run Menu ===

function findPackageScripts(cwd) {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
          return { scripts: pkg.scripts, root: dir, manager: fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm' };
        }
      } catch (_e) { /* */ }
      return null;
    }
    dir = path.dirname(dir);
  }
  return null;
}

let currentScripts = null;

function updateMenuForDirectory(cwd) {
  const pkg = findPackageScripts(cwd);
  const scriptsKey = pkg ? JSON.stringify(pkg.scripts) : null;
  const currentKey = currentScripts ? JSON.stringify(currentScripts.scripts) : null;
  if (scriptsKey !== currentKey) {
    currentScripts = pkg;
    Menu.setApplicationMenu(buildMenu(pkg));
  }
}

function rebuildMenuWithRecent() {
  Menu.setApplicationMenu(buildMenu(currentScripts));
}

function runScriptInNewTab(command) {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return;
  const entry = windows.get(win.id);
  if (!entry) return;
  let cwd = entry.startDir;
  if (entry.activeTabId) {
    const activeTab = entry.tabs.get(entry.activeTabId);
    if (activeTab) cwd = getTabCwd(activeTab) || activeTab.startDir;
  }
  createTab(win.id, cwd, { command, background: true });
}

function getActiveTabCwdForWindow(win) {
  const entry = windows.get(win.id);
  if (!entry || !entry.activeTabId) return entry ? entry.startDir : null;
  const tab = entry.tabs.get(entry.activeTabId);
  if (!tab) return entry.startDir;
  return getTabCwd(tab) || tab.startDir;
}

function installCLI() {
  const target = '/usr/local/bin/mantel';
  const appPath = app.isPackaged
    ? path.dirname(path.dirname(path.dirname(app.getAppPath()))) // .app bundle
    : null;

  if (!appPath) {
    dialog.showMessageBox({
      icon: nativeImage.createFromPath(BASE_ICON_PATH),
      message: 'CLI install is only available in the packaged app.',
      detail: 'When running in development, use "npm link" instead.',
    });
    return;
  }

  const bundledScript = path.join(appPath, 'Contents', 'Resources', 'mantel');
  const script = [
    '#!/bin/bash',
    '# Mantel CLI — installed by Mantel.app',
    `BUNDLED_SCRIPT="${bundledScript}"`,
    '',
    'if [ "$1" = "init" ]; then',
    '  exec "$BUNDLED_SCRIPT" "$@"',
    'fi',
    '',
    `open -n -a "${appPath}" --args "$@"`,
    '',
  ].join('\n');

  try {
    fs.mkdirSync('/usr/local/bin', { recursive: true });
    fs.writeFileSync(target, script, { mode: 0o755 });
    dialog.showMessageBox({
      icon: nativeImage.createFromPath(BASE_ICON_PATH),
      message: 'CLI command installed successfully.',
      detail: `You can now use "mantel" from any terminal.\n\nInstalled to: ${target}`,
    });
  } catch (_e) {
    // Permission denied — retry with admin privileges via osascript
    const tmpFile = path.join(app.getPath('temp'), 'mantel-cli-install.sh');
    fs.writeFileSync(tmpFile, script, { mode: 0o755 });
    try {
      execSync(`osascript -e 'do shell script "mkdir -p /usr/local/bin && cp ${tmpFile} ${target} && chmod 755 ${target}" with administrator privileges'`, { timeout: 30000 });
      dialog.showMessageBox({
        icon: nativeImage.createFromPath(BASE_ICON_PATH),
        message: 'CLI command installed successfully.',
        detail: `You can now use "mantel" from any terminal.\n\nInstalled to: ${target}`,
      });
    } catch (_e2) {
      dialog.showMessageBox({
        icon: nativeImage.createFromPath(BASE_ICON_PATH),
        message: 'Failed to install CLI command.',
        detail: 'Could not write to /usr/local/bin. You may need to create the symlink manually.',
      });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_e3) { /* */ }
    }
  }
}
function writeFinderActions(appPath) {
  const servicesDir = path.join(process.env.HOME, 'Library', 'Services');
  const mantelHome = path.join(process.env.HOME, '.mantel');
  const actions = [
    { name: 'New Mantel Tab Here', cmd: `mkdir -p "${mantelHome}" && for f in "$@"; do echo "$f" > "${mantelHome}/pending-tab"; open -a "${appPath}"; done` },
    { name: 'New Mantel Terminal Here', cmd: `for f in "$@"; do open -n -a "${appPath}" --args "$f"; done` },
  ];

  for (const action of actions) {
    const workflowDir = path.join(servicesDir, `${action.name}.workflow`, 'Contents');
    fs.mkdirSync(workflowDir, { recursive: true });

    fs.writeFileSync(path.join(workflowDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>NSServices</key>
\t<array>
\t\t<dict>
\t\t\t<key>NSMenuItem</key>
\t\t\t<dict>
\t\t\t\t<key>default</key>
\t\t\t\t<string>${action.name}</string>
\t\t\t</dict>
\t\t\t<key>NSMessage</key>
\t\t\t<string>runWorkflowAsService</string>
\t\t\t<key>NSRequiredContext</key>
\t\t\t<dict>
\t\t\t\t<key>NSTextContent</key>
\t\t\t\t<string>FilePath</string>
\t\t\t</dict>
\t\t\t<key>NSSendFileTypes</key>
\t\t\t<array>
\t\t\t\t<string>public.directory</string>
\t\t\t</array>
\t\t</dict>
\t</array>
</dict>
</plist>`);

    fs.writeFileSync(path.join(workflowDir, 'document.wflow'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>AMBundleVersion</key>
\t<integer>2</integer>
\t<key>actions</key>
\t<array>
\t\t<dict>
\t\t\t<key>action</key>
\t\t\t<dict>
\t\t\t\t<key>AMAccepts</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Optional</key>
\t\t\t\t\t<false/>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.path</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>AMActionVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>AMApplication</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Automator</string>
\t\t\t\t</array>
\t\t\t\t<key>AMBundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>AMName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>AMParameterProperties</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<dict/>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<dict/>
\t\t\t\t</dict>
\t\t\t\t<key>AMProvides</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>Container</key>
\t\t\t\t\t<string>List</string>
\t\t\t\t\t<key>Types</key>
\t\t\t\t\t<array>
\t\t\t\t\t\t<string>com.apple.cocoa.string</string>
\t\t\t\t\t</array>
\t\t\t\t</dict>
\t\t\t\t<key>ActionBundlePath</key>
\t\t\t\t<string>/System/Library/Automator/Run Shell Script.action</string>
\t\t\t\t<key>ActionName</key>
\t\t\t\t<string>Run Shell Script</string>
\t\t\t\t<key>ActionParameters</key>
\t\t\t\t<dict>
\t\t\t\t\t<key>COMMAND_STRING</key>
\t\t\t\t\t<string>${action.cmd.replace(/&/g, '&amp;')}</string>
\t\t\t\t\t<key>CheckedForUserDefaultShell</key>
\t\t\t\t\t<true/>
\t\t\t\t\t<key>inputMethod</key>
\t\t\t\t\t<integer>1</integer>
\t\t\t\t\t<key>shell</key>
\t\t\t\t\t<string>/bin/bash</string>
\t\t\t\t</dict>
\t\t\t\t<key>BundleIdentifier</key>
\t\t\t\t<string>com.apple.RunShellScript</string>
\t\t\t\t<key>CFBundleVersion</key>
\t\t\t\t<string>2.0.3</string>
\t\t\t\t<key>CanShowSelectedItemsWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>CanShowWhenRun</key>
\t\t\t\t<false/>
\t\t\t\t<key>Category</key>
\t\t\t\t<array>
\t\t\t\t\t<string>AMCategoryUtilities</string>
\t\t\t\t</array>
\t\t\t\t<key>Class Name</key>
\t\t\t\t<string>RunShellScriptAction</string>
\t\t\t\t<key>InputUUID</key>
\t\t\t\t<string>0</string>
\t\t\t\t<key>Keywords</key>
\t\t\t\t<array>
\t\t\t\t\t<string>Shell</string>
\t\t\t\t\t<string>Script</string>
\t\t\t\t</array>
\t\t\t\t<key>OutputUUID</key>
\t\t\t\t<string>0</string>
\t\t\t\t<key>UUID</key>
\t\t\t\t<string>0</string>
\t\t\t</dict>
\t\t</dict>
\t</array>
\t<key>connectors</key>
\t<dict/>
\t<key>workflowMetaData</key>
\t<dict>
\t\t<key>workflowTypeIdentifier</key>
\t\t<string>com.apple.Automator.servicesMenu</string>
\t\t<key>serviceInputTypeIdentifier</key>
\t\t<string>com.apple.Automator.fileSystemObject</string>
\t</dict>
</dict>
</plist>`);
  }
}

function buildMenu(pkg) {
  const isMac = process.platform === 'darwin';

  let runMenu = null;
  if (pkg && pkg.scripts) {
    const prefix = pkg.manager === 'yarn' ? 'yarn' : 'npm run';
    const scriptItems = Object.keys(pkg.scripts).map(name => ({
      label: name,
      sublabel: pkg.scripts[name],
      click: () => runScriptInNewTab(`${prefix} ${name}`),
    }));
    runMenu = { label: 'Run', submenu: scriptItems };
  }

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        {
          label: 'About Mantel',
          click: () => app.showAboutPanel(),
        },
        { type: 'separator' },
        {
          label: 'Install CLI Command…',
          click: () => installCLI(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Shell',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+N',
          click: (_item, win) => {
            const cwd = win ? getActiveTabCwdForWindow(win) : null;
            const dir = cwd || getStartDir();
            if (app.isPackaged) {
              // Packaged: launch the .app bundle as a new process
              const appPath = path.dirname(path.dirname(path.dirname(app.getAppPath())));
              spawn('open', ['-n', appPath, '--args', dir], { detached: true, stdio: 'ignore' });
            } else {
              // Dev: launch a new Electron process
              spawn(process.execPath, ['.', dir], { detached: true, stdio: 'ignore', cwd: __dirname });
            }
          },
        },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: (_item, win) => {
            if (!win) return;
            win.webContents.send('request-new-tab');
          },
        },
        { type: 'separator' },
        {
          label: 'Recent Directories',
          submenu: (() => {
            const dirs = loadRecentDirs();
            if (dirs.length === 0) return [{ label: 'No Recent Directories', enabled: false }];
            const home = process.env.HOME || '';
            const items = dirs.map(dir => ({
              label: dir.startsWith(home) ? '~' + dir.slice(home.length) : dir,
              click: () => navigateToDir(dir),
            }));
            items.push({ type: 'separator' });
            items.push({ label: 'Clear Recent Directories', click: () => { saveRecentDirs([]); rebuildMenuWithRecent(); } });
            return items;
          })(),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, win) => {
            if (!win) return;
            win.webContents.send('request-close-tab');
          },
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', click: (_item, win) => { if (win) win.webContents.send('menu-copy'); } },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', click: (_item, win) => { if (win) win.webContents.send('menu-paste'); } },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: (_item, win) => { if (win) win.webContents.send('menu-select-all'); } },
        { type: 'separator' },
        { label: 'Clear', accelerator: 'CmdOrCtrl+K', click: (_item, win) => { if (win) win.webContents.send('menu-clear'); } },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Bigger', accelerator: 'CmdOrCtrl+=', click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'in'); } },
        { label: 'Smaller', accelerator: 'CmdOrCtrl+-', click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'out'); } },
        { label: 'Default Size', accelerator: 'CmdOrCtrl+0', click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'reset'); } },
        { type: 'separator' },
        {
          label: 'Theme',
          submenu: Object.keys(THEMES).map(name => ({
            label: name,
            type: 'radio',
            checked: name === currentThemeName,
            click: () => setTheme(name),
          })),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    ...(runMenu ? [runMenu] : []),
    {
      label: 'Window',
      submenu: [
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: (_item, win) => { if (win) win.webContents.send('switch-tab', 'next'); } },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: (_item, win) => { if (win) win.webContents.send('switch-tab', 'prev'); } },
        { type: 'separator' },
        ...[1,2,3,4,5,6,7,8,9].map(n => ({
          label: `Tab ${n}`,
          accelerator: `CmdOrCtrl+${n}`,
          click: (_item, win) => { if (win) win.webContents.send('switch-tab', n - 1); },
        })),
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : []),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// Handle --new-tab: write dir to pending file for an existing instance, then quit
if (process.argv.includes('--new-tab')) {
  const dir = getDirFromArgs(process.argv) || process.env.HOME || process.cwd();
  const pendingFile = path.join(MANTEL_HOME, 'pending-tab');
  fs.mkdirSync(MANTEL_HOME, { recursive: true });
  fs.writeFileSync(pendingFile, dir);
  app.quit();
} else {
  app.whenReady().then(() => {
    initSpecialDirs();
    Menu.setApplicationMenu(buildMenu(null));
    createWindow(getStartDir());

    // Dock right-click context menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Terminal',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            const cwd = focused ? getActiveTabCwdForWindow(focused) : null;
            const dir = cwd || getStartDir();
            if (app.isPackaged) {
              const appPath = path.dirname(path.dirname(path.dirname(app.getAppPath())));
              spawn('open', ['-n', appPath, '--args', dir], { detached: true, stdio: 'ignore' });
            } else {
              spawn(process.execPath, ['.', dir], { detached: true, stdio: 'ignore', cwd: __dirname });
            }
          },
        },
        {
          label: 'New Tab',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow();
            const targetWin = focused || [...windows.values()][0]?.window;
            if (targetWin) {
              targetWin.webContents.send('request-new-tab');
              targetWin.focus();
            }
          },
        },
      ]);
      app.dock.setMenu(dockMenu);
    }

    // Auto-install Finder Quick Actions when running as packaged app
    if (app.isPackaged) {
      const appPath = path.dirname(path.dirname(path.dirname(app.getAppPath())));
      try { writeFinderActions(appPath); } catch (_e) { /* silent */ }
    }

    // Watch for pending-tab requests from Finder "New Tab Here" action
    const pendingFile = path.join(MANTEL_HOME, 'pending-tab');
    fs.watch(MANTEL_HOME, (_eventType, filename) => {
      if (filename !== 'pending-tab') return;
      try {
        const dir = fs.readFileSync(pendingFile, 'utf8').trim();
        fs.unlinkSync(pendingFile);
        if (!dir) return;
        const focusedWin = BrowserWindow.getFocusedWindow();
        const targetWin = focusedWin || [...windows.values()][0].window;
        if (!targetWin) { createWindow(dir); return; }
        const entry = windows.get(targetWin.id);
        if (entry) createTab(targetWin.id, dir);
        targetWin.focus();
      } catch (_e) { /* file already consumed or not ready */ }
    });
  });

  app.on('activate', () => {
    if (windows.size === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
