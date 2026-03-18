# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wrapped Terminal is an Electron-based desktop terminal emulator that displays project-specific banners and branding when navigating between directories. It detects the current working directory via polling and loads customization from `.terminal/` folders in project roots.

## Commands

- `npm start` — Launch the Electron app
- `npm run rebuild` — Rebuild native modules (node-pty) after Electron version changes
- `./wt [directory]` — Shell wrapper to launch the terminal in a specific directory
- `./wt --set-banner <image-path> [project-dir]` — Set a project banner image

There are no tests or linting configured.

## Architecture

Classic Electron main/renderer split across three files:

- **`main.js`** — Main process. Spawns a PTY shell via `node-pty`, handles IPC, polls for directory changes using `lsof` every 2 seconds, discovers `.terminal/` config by walking up the directory tree, and sends banner updates to the renderer.
- **`preload.js`** — Context bridge exposing `terminalAPI` to the renderer with methods for data I/O, resizing, and banner updates.
- **`index.html`** — Renderer process (all inline). Uses xterm.js for the terminal display, renders a dynamic banner area with project name/icon/image, and handles resize events.
- **`wt`** — Bash launcher script that resolves the target directory and starts Electron.

### IPC Flow

1. Renderer signals `terminal-ready`
2. Main responds with `update-banner` (project config + images as data URLs)
3. Terminal data flows via `terminal-data` (main→renderer) and `terminal-input` (renderer→main)
4. Resize events flow via `terminal-resize`

### Directory Change Detection

Main process polls every 2s using `lsof -p <pid> -Fn` on macOS to get the shell's current working directory. When it changes, it re-discovers the nearest `.terminal/` config and pushes an `update-banner` event.

### Project Customization

Projects opt in by creating a `.terminal/` directory containing:
- `config.json` — Optional: `{ name, color, textColor }`
- `banner.*` (png/jpg/gif/webp/svg) — Full-width banner image
- `icon.*` — Project icon (falls back to auto-generated initial with hashed color)

## Key Dependencies

- **electron** — Desktop app shell
- **node-pty** — PTY spawning for the shell process
- **@xterm/xterm** + **@xterm/addon-fit** — Terminal emulator UI
- **sharp** — Image processing (in deps, available for banner manipulation)

## Platform

Currently macOS-focused (uses `lsof` for CWD detection, zsh as default shell, macOS titlebar styling).
