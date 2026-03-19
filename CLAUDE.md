# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mantel is an Electron-based terminal wrapper that displays project-specific banners and branding when navigating between directories. It detects the current working directory via polling and loads customization from `.mantel/` folders in project roots.

## Commands

- `npm start` — Launch the Electron app
- `npm run rebuild` — Rebuild native modules (node-pty) after Electron version changes
- `./wt [directory]` — Shell wrapper to launch the terminal in a specific directory
- `./wt --set-banner <image-path> [project-dir]` — Set a project banner image

There are no tests or linting configured.

## Architecture

Classic Electron main/renderer split across three files:

- **`main.js`** — Main process. Manages windows and tabs, each tab with its own PTY via `node-pty`. Polls for directory changes using `lsof` every 2 seconds, discovers `.mantel/` config by walking up the directory tree, detects SSH sessions, generates dynamic dock icons, and provides a contextual Run menu from `package.json` scripts.
- **`preload.js`** — Context bridge exposing `terminalAPI` to the renderer with methods for tab lifecycle, data I/O, resizing, banner updates, and menu actions.
- **`index.html`** — Renderer process (all inline). Manages multiple xterm.js terminals (one per tab), renders a colored tab bar, a dynamic banner area with project name/icon/git info, and handles resize/menu events.
- **`wt`** — Bash launcher script that resolves the target directory and starts Electron.
- **`scripts/patch-electron-name.js`** — Postinstall script that patches the Electron binary's Info.plist to display "Mantel" in the macOS menu bar.

### IPC Flow

1. Renderer signals `terminal-ready`
2. Main creates first tab, responds with `tab-created` (includes banner payload)
3. Terminal data flows via `terminal-data` (main→renderer) and `terminal-input` (renderer→main), both keyed by `tabId`
4. Resize events flow via `terminal-resize` (keyed by `tabId`)
5. Tab lifecycle: `create-tab`, `close-tab`, `set-active-tab`, `tab-created`, `tab-closed`

### Directory Change Detection

Per-tab polling every 2s using `lsof -p <pid> -Fn` on macOS to get the shell's current working directory. When it changes, it re-discovers the nearest `.mantel/` config and pushes an `update-project` event. Also detects SSH sessions via child process inspection.

### Project Customization

Projects opt in by creating a `.mantel/` directory containing:
- `config.json` — Optional: `{ name, backgroundColor, icon }`
- `icon.*` (png/jpg/gif/webp/svg) — Project icon (falls back to auto-generated initial with hashed color)

## Key Dependencies

- **electron** — Desktop app shell
- **node-pty** — PTY spawning for the shell process
- **@xterm/xterm** + **@xterm/addon-fit** — Terminal emulator UI
- **sharp** — Image processing for dynamic dock icon generation

## Platform

Currently macOS-focused (uses `lsof` for CWD detection, `app.dock` for dock icons, zsh as default shell).
