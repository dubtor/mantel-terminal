const { app, BrowserWindow, ipcMain, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const sharp = require('sharp');

app.setName('Wrapped Terminal');

// Track all open terminal windows
const windows = new Map(); // BrowserWindow id -> { window, ptyProcess, pollInterval }

const TERMINAL_DIR = '.terminal';
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

function findProjectConfig(cwd) {
  // Walk up from cwd to find the nearest .terminal/ directory
  let dir = cwd;

  while (dir !== path.dirname(dir)) {
    const terminalDir = path.join(dir, TERMINAL_DIR);
    if (fs.existsSync(terminalDir)) {
      // Read config.json if it exists
      let config = {};
      const configPath = path.join(terminalDir, 'config.json');
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (_e) { /* ignore parse errors */ }
      }

      // Check for banner image
      let bannerPath = null;
      for (const ext of IMAGE_EXTENSIONS) {
        const p = path.join(terminalDir, 'banner' + ext);
        if (fs.existsSync(p)) {
          bannerPath = p;
          break;
        }
      }

      // Check for icon image
      let iconPath = null;
      for (const ext of IMAGE_EXTENSIONS) {
        const p = path.join(terminalDir, 'icon' + ext);
        if (fs.existsSync(p)) {
          iconPath = p;
          break;
        }
      }

      return {
        config,
        bannerData: bannerPath ? fileToDataURL(bannerPath) : null,
        iconData: iconPath ? fileToDataURL(iconPath) : null,
        iconPath,
        projectRoot: dir,
      };
    }
    dir = path.dirname(dir);
  }
  return { config: {}, bannerData: null, iconData: null, iconPath: null, projectRoot: null };
}

function fileToDataURL(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  const mime = mimeTypes[ext] || 'application/octet-stream';
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString('base64')}`;
}

// Same hash-to-color logic as the renderer
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
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function buildBaseTerminalSvg(size) {
  // Terminal icon: rounded rect with a ">_" prompt
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" rx="112" ry="112" fill="#1e1e2e"/>
    <rect x="60" y="60" width="${size - 120}" height="${size - 120}" rx="40" ry="40" fill="#313244"/>
    <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
          font-family="SF Mono, Menlo, Monaco, monospace"
          font-size="240" font-weight="700" fill="#ffffff">&gt;</text>
  </svg>`;
}

async function updateDockIcon(projectName, config, iconPath, emoji) {
  if (process.platform !== 'darwin') return;
  try {
    const baseSize = 512;
    const badgeSize = 200;
    const strokeWidth = 8;
    // Canvas is larger so the badge can overhang without clipping
    const overhang = Math.round(badgeSize * 0.3);
    const canvasSize = baseSize + overhang;
    // Base icon is centered in the larger canvas (shifted up-left slightly)
    const baseOffset = Math.round(overhang * 0.35);
    // Badge sits in the lower-right corner, fully within canvas
    const badgeLeft = canvasSize - badgeSize - 8;
    const badgeTop = canvasSize - badgeSize - 8;

    // Build base terminal icon
    const baseSvg = buildBaseTerminalSvg(baseSize);
    const baseBuffer = await sharp(Buffer.from(baseSvg)).png().toBuffer();

    // Build the badge overlay
    let badgeBuffer;
    if (iconPath) {
      const bgColor = (config && config.color) || hashColor(projectName);
      const r = badgeSize / 2;
      const iconPadding = Math.round(badgeSize * 0.15);
      const iconInnerSize = badgeSize - iconPadding * 2;
      // Colored circle background
      const bgSvg = `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${bgColor}" stroke="rgba(255,255,255,0.15)" stroke-width="${strokeWidth}"/>
      </svg>`;
      const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
      // Resize the project icon smaller to sit inside the circle
      const iconResized = await sharp(iconPath)
        .resize(iconInnerSize, iconInnerSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      // Composite: colored circle + icon centered on top
      badgeBuffer = await sharp(bgBuffer)
        .composite([{ input: iconResized, left: iconPadding, top: iconPadding }])
        .png()
        .toBuffer();
    } else if (emoji && SPECIAL_DIR_ICONS[emoji]) {
      // Render SVG icon badge for special directories
      const bgColor = hashColor(projectName);
      const light = isLightColor(bgColor);
      const iconColor = light ? '#1e1e2e' : '#ffffff';
      const strokeColor = light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
      const r = badgeSize / 2;
      const iconInnerSize = Math.round(badgeSize * 0.65);
      const iconOffset = Math.round((badgeSize - iconInnerSize) / 2);
      // Circle background
      const bgSvg = `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
      </svg>`;
      const bgBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
      // SVG icon
      const iconSvg = buildSpecialDirIconSvg(emoji, iconInnerSize, iconColor);
      const iconSvgBuffer = await sharp(Buffer.from(iconSvg)).png().toBuffer();
      badgeBuffer = await sharp(bgBuffer)
        .composite([{ input: iconSvgBuffer, left: iconOffset, top: iconOffset }])
        .png()
        .toBuffer();
    } else {
      // Generate a circle badge with initial letter + stroke
      const bgColor = (config && config.color) || hashColor(projectName);
      const light = isLightColor(bgColor);
      const textColor = (config && config.textColor) || (light ? '#1e1e2e' : '#ffffff');
      const initial = projectName.charAt(0).toUpperCase();
      const r = badgeSize / 2;
      const strokeColor = light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.15)';
      const badgeSvg = `<svg width="${badgeSize}" height="${badgeSize}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}"/>
        <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle"
              font-family="SF Pro Display, Helvetica Neue, Arial, sans-serif"
              font-size="110" font-weight="700" fill="${textColor}">${initial}</text>
      </svg>`;
      badgeBuffer = await sharp(Buffer.from(badgeSvg)).png().toBuffer();
    }

    // Compose on a transparent canvas: base icon + badge
    const canvas = sharp({
      create: { width: canvasSize, height: canvasSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png();

    const iconBuffer = await canvas
      .composite([
        { input: baseBuffer, left: baseOffset, top: baseOffset },
        { input: badgeBuffer, left: badgeLeft, top: badgeTop },
      ])
      .png()
      .toBuffer();

    const image = nativeImage.createFromBuffer(iconBuffer);
    app.dock.setIcon(image);
  } catch (e) {
    console.error('Failed to set dock icon:', e);
  }
}

// SVG icon paths for special directories (rendered at 24x24 viewBox)
const SPECIAL_DIR_ICONS = {
  home: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>`,
  desktop: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>`,
  downloads: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`,
  documents: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>`,
  ssh: (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
    <line x1="6" y1="6" x2="6.01" y2="6"/>
    <line x1="6" y1="18" x2="6.01" y2="18"/>
  </svg>`,
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

function getSpecialDir(cwd) {
  return SPECIAL_DIRS[cwd] || null;
}

const SSH_COLOR = '#e06c75';

function detectSSH(shellPid) {
  try {
    const { execSync } = require('child_process');
    // Find ssh child processes of the shell
    const result = execSync(`ps -o pid=,command= -p $(pgrep -P ${shellPid} ssh 2>/dev/null || echo 0) 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 1000,
    }).trim();
    if (!result) return null;
    // Parse the ssh command to extract the host
    const match = result.match(/ssh\s+(?:.*?\s+)?(?:(\S+)@)?(\S+)\s*$/);
    if (match) {
      const user = match[1] || null;
      const host = match[2];
      return { user, host };
    }
    return null;
  } catch (_e) {
    return null;
  }
}

function buildSpecialDirIconSvg(iconKey, size, color) {
  const svgFn = SPECIAL_DIR_ICONS[iconKey];
  if (!svgFn) return null;
  // Re-render the icon at the desired size
  return svgFn(color).replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
}

function getStartDir() {
  return process.argv.slice(1).find(arg => {
    try {
      return !arg.startsWith('-') && !arg.includes('electron') && !arg.endsWith('.js') && !arg.endsWith('.') && fs.existsSync(arg) && fs.statSync(arg).isDirectory();
    } catch (_e) { return false; }
  }) || process.env.HOME || process.cwd();
}

function createWindow(startDir) {
  startDir = startDir || getStartDir();

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    titleBarStyle: 'default',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');

  const shell = process.env.SHELL || '/bin/zsh';
  const ptyProc = pty.spawn(shell, ['--login'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: startDir,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    },
  });

  ptyProc.onData((data) => {
    if (!win.isDestroyed()) {
      win.webContents.send('terminal-data', data);
    }
  });

  ptyProc.onExit(() => {
    if (!win.isDestroyed()) {
      win.close();
    }
  });

  // Watch for directory changes and SSH sessions
  let lastCwd = startDir;
  let lastSSHHost = null;
  const { execSync } = require('child_process');
  const pollInterval = setInterval(() => {
    try {
      const pid = ptyProc.pid;

      // Check for active SSH session
      const sshInfo = detectSSH(pid);
      const sshHost = sshInfo ? sshInfo.host : null;

      if (sshHost !== lastSSHHost) {
        lastSSHHost = sshHost;
        if (sshInfo) {
          // SSH session active — show SSH banner
          const displayName = sshInfo.user ? `${sshInfo.user}@${sshInfo.host}` : sshInfo.host;
          const sshConfig = { color: SSH_COLOR };
          const light = isLightColor(SSH_COLOR);
          const iconColor = light ? '#1e1e2e' : '#ffffff';
          const svg = buildSpecialDirIconSvg('ssh', 24, iconColor);
          const sshIconData = svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : null;
          win.webContents.send('update-banner', {
            cwd: displayName,
            bannerData: null,
            iconData: sshIconData,
            projectName: sshInfo.host,
            config: sshConfig,
          });
          if (win.isFocused()) {
            updateDockIcon(sshInfo.host, sshConfig, null, 'ssh');
          }
          return;
        }
        // SSH just disconnected — force a directory refresh
        lastCwd = null;
      } else if (sshHost) {
        // Still in same SSH session, no update needed
        return;
      }

      const result = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep '^n/' | grep 'cwd' || lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | tail -1 | sed 's/^n//'`, {
        encoding: 'utf8',
        timeout: 1000,
      }).trim();

      let cwd = result.replace(/^n/, '');
      if (!cwd) return;

      if (cwd !== lastCwd && fs.existsSync(cwd)) {
        lastCwd = cwd;
        const { config, bannerData, iconData, iconPath, projectRoot } = findProjectConfig(cwd);
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
        win.webContents.send('update-banner', {
          cwd,
          bannerData,
          iconData: finalIconData,
          projectName,
          config,
        });
        // Update dock icon for the focused window
        if (win.isFocused()) {
          updateDockIcon(projectName, config, iconPath, specialIcon);
        }
      }
    } catch (_e) {
      // ignore errors in cwd detection
    }
  }, 2000);

  windows.set(win.id, { window: win, ptyProcess: ptyProc, pollInterval, startDir });

  win.on('closed', () => {
    clearInterval(pollInterval);
    try { ptyProc.kill(); } catch (_e) { /* */ }
    windows.delete(win.id);
  });

  return win;
}

// IPC handlers — route to the correct window's pty
ipcMain.on('terminal-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (!entry) return;
  const { config, bannerData, iconData, iconPath, projectRoot } = findProjectConfig(entry.startDir);
  const special = getSpecialDir(entry.startDir);
  const displayRoot = projectRoot || entry.startDir;
  const projectName = (special && !projectRoot) ? special.name : (config.name || path.basename(displayRoot));
  const specialIcon = (!projectRoot && special) ? special.icon : null;
  // For special dirs, generate an SVG data URL for the renderer banner
  let finalIconData = iconData;
  if (specialIcon && !iconData) {
    const color = isLightColor(hashColor(projectName)) ? '#1e1e2e' : '#ffffff';
    const svg = buildSpecialDirIconSvg(specialIcon, 24, color);
    if (svg) finalIconData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
  win.webContents.send('update-banner', {
    cwd: entry.startDir,
    bannerData,
    iconData: finalIconData,
    projectName,
    config,
  });
  updateDockIcon(projectName, config, iconPath, specialIcon);
});

ipcMain.on('terminal-input', (event, data) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (entry) entry.ptyProcess.write(data);
});

ipcMain.on('set-title', (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.setTitle(title);
});

ipcMain.on('terminal-resize', (event, { cols, rows }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const entry = windows.get(win.id);
  if (entry) {
    try { entry.ptyProcess.resize(cols, rows); } catch (_e) { /* */ }
  }
});

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
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
    // Shell menu
    {
      label: 'Shell',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          accelerator: 'CmdOrCtrl+W',
          click: (_item, win) => { if (win) win.close(); },
        },
      ],
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: (_item, win) => { if (win) win.webContents.send('menu-copy'); },
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: (_item, win) => { if (win) win.webContents.send('menu-paste'); },
        },
        {
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: (_item, win) => { if (win) win.webContents.send('menu-select-all'); },
        },
        { type: 'separator' },
        {
          label: 'Clear',
          accelerator: 'CmdOrCtrl+K',
          click: (_item, win) => { if (win) win.webContents.send('menu-clear'); },
        },
      ],
    },
    // View menu
    {
      label: 'View',
      submenu: [
        {
          label: 'Bigger',
          accelerator: 'CmdOrCtrl+=',
          click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'in'); },
        },
        {
          label: 'Smaller',
          accelerator: 'CmdOrCtrl+-',
          click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'out'); },
        },
        {
          label: 'Default Size',
          accelerator: 'CmdOrCtrl+0',
          click: (_item, win) => { if (win) win.webContents.send('menu-zoom', 'reset'); },
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' },
        ] : [
          { role: 'close' },
        ]),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

app.whenReady().then(() => {
  initSpecialDirs();
  Menu.setApplicationMenu(buildMenu());
  createWindow(getStartDir());
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked and no windows exist
  if (windows.size === 0) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
