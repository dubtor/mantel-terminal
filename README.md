# Mantel

**A terminal that knows which project you're in.**

## The Problem

If you work with AI coding tools like Claude Code, Cursor, or Copilot, you've probably noticed: you end up with a lot of terminals open at once. One for each project. Maybe a dev server in one, a test runner in another, and a Claude Code session in a third — and that's just one project.

They all look the same. Same black rectangles. Same icons in the dock. You Cmd+Tab between them and have to squint at the title bar or type `pwd` to figure out where you are. When you're deep in a flow across multiple projects, this small friction adds up fast.

## What Mantel Does

Mantel is a terminal that automatically detects which project you're working in and makes it visually obvious.

**Each project gets its own color, icon, and identity** — in the tab bar, the info bar, and the dock icon. When you `cd` into a different project, everything updates. When you switch tabs, the dock icon changes. You always know where you are at a glance.

It works out of the box. Every directory gets a unique color derived from its name. But you can customize it: drop a `.mantel/` folder into any project with a `config.json` and an icon, and that project gets its own branding everywhere.

### What you get

- **Color-coded tabs** — each tab shows the project color, so you can tell them apart instantly
- **Project info bar** — shows the project name, path, icon, git branch, and a link to the GitHub repo
- **Dynamic dock icon** — the macOS dock icon updates with the active project's badge, so you can identify terminals even from the dock
- **SSH detection** — when you SSH into a remote machine, the terminal shows the hostname with a distinct color
- **Run menu** — if your project has a `package.json`, a Run menu appears with all available scripts. Scripts open in background tabs, so you can start a dev server without leaving your current tab
- **Configurable theme** — set your terminal colors via `~/.mantel/theme.json`, with built-in presets

## Quick Start

```bash
# Clone and install
git clone https://github.com/dubtor/mantel-terminal.git
cd mantel-terminal
npm install

# Launch
./mantel
```

## Project Setup

Any project works out of the box with auto-generated colors. To customize, create a `.mantel/` directory in your project root:

```bash
# Quick setup via CLI
./mantel init --name "My Project" --color "#1a56db" --icon ./logo.png

# Or manually
mkdir .mantel
```

`.mantel/config.json`:
```json
{
  "name": "My Project",
  "backgroundColor": "#1a56db",
  "textColor": "#ffffff",
  "icon": "assets/logo.png"
}
```

| Field | Description |
|---|---|
| `name` | Project display name. Without it, the directory name is shown |
| `backgroundColor` | Tab bar and info bar background color (hex). Falls back to auto-generated color |
| `textColor` | Text color (hex). Falls back to black/white based on background brightness |
| `icon` | Path to icon file, relative to project root. Supports png, jpg, svg, webp, gif, ico |

`mantel init` automatically populates `name` from `package.json` and detects common icon files (`favicon`, `logo`, `icon`, etc.) up to 3 directories deep when `--name` or `--icon` are not provided.

## Theme

Configure your terminal colors in `~/.mantel/theme.json`:

```json
"catppuccin"
```

Or with custom overrides:

```json
{
  "preset": "catppuccin",
  "background": "#1a1b26"
}
```

Built-in presets: `default` (macOS Terminal.app Basic), `catppuccin`.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Cmd+N | New window (same directory) |
| Cmd+T | New tab |
| Cmd+W | Close tab |
| Cmd+1-9 | Switch to tab |
| Cmd+Shift+[ / ] | Previous / next tab |
| Cmd+= / - / 0 | Zoom in / out / reset |
| Cmd+K | Clear terminal |

## How It Works

Mantel is an Electron app wrapping xterm.js with node-pty. Each tab runs its own shell process. Every 2 seconds, it checks the shell's working directory and walks up the file tree looking for a `.mantel/` folder. When it finds one, it applies that project's configuration to the tab color, info bar, and dock icon.

It also detects SSH sessions by inspecting child processes, and discovers `package.json` scripts to populate a contextual Run menu.

## Platform

macOS. Uses `lsof` for working directory detection, `app.dock` for dynamic dock icons, and zsh as the default shell.

## License

ISC
