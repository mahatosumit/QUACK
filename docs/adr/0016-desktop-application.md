# ADR 0016: Desktop Application Architecture

Status: Accepted

## Context

QUACK needs a **Desktop Application** that provides a full IDE-like experience while remaining independent from the Engine Runtime. The desktop must support AI conversation, project management, code editing, terminal, git, knowledge graphs, memory, skills, plugins, and model management — all in a dockable, resizable, configurable interface.

## Decision

### Architecture

```
┌──────────────────────────────────────────┐
│  Electron Main Process                   │
│  ┌─────────────┐  ┌───────────────────┐  │
│  │ Window Mgmt  │  │ Desktop Server    │  │
│  │              │  │ (HTTP :3157)      │  │
│  └─────────────┘  └────────┬──────────┘  │
├─────────────────────────────┼────────────┤
│  Renderer (Browser)        │             │
│  ┌─────────────────────────▼─────────┐   │
│  │  gui/app.js (frontend app)        │   │
│  │  gui/src/theme-engine.js          │   │
│  │  gui/src/command-palette.js       │   │
│  │  gui/src/window-manager.js        │   │
│  │  gui/src/notification-center.js   │   │
│  └───────────────────────────────────┘   │
└──────────────────────────────────────────┘
         ↕ HTTP REST
┌──────────────────────────────────────────┐
│  QUACK Backend (Node.js)                 │
│  create-system.ts → DesktopServer        │
│  Skills | Models | Plugins | Workspaces  │
└──────────────────────────────────────────┘
```

### Desktop Server

A lightweight `DesktopServer` provides HTTP endpoints for the GUI to communicate with the QUACK backend:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Health check |
| `/api/version` | GET | Version info |
| `/api/workspace` | GET | Workspace root/data dir |

Future endpoints will expose skill execution, model queries, plugin management, and workspace operations.

### Frontend Architecture

The existing static HTML/CSS/JS GUI at `gui/` is extended with modular JavaScript classes:

| Module | Purpose |
|--------|---------|
| `theme-engine.js` | Light/dark/high-contrast themes with localStorage persistence |
| `command-palette.js` | Universal command palette (Ctrl+K) |
| `window-manager.js` | Rail navigation and view switching |
| `notification-center.js` | Toast notifications with auto-dismiss |

### Desktop Runtime

The `src/desktop-app.ts` entry point starts both the QUACK runtime and the Desktop HTTP server, then submits the initial goal. It serves as the Electron main process entry point and the standalone Node.js desktop server.

### Display Layout

The existing `gui/index.html` provides a 3-column layout:
- **Left rail**: Navigation buttons (6 views)
- **Center workbench**: Mission Control, Agents, Workspace, Memory, Plugins, Settings
- **Right dock**: Signals and Logs

All panels support responsive breakpoints at 1180px and 720px.

## Consequences

**Positive:**
- Desktop is independent from Engine Runtime — failures in one don't affect the other.
- Existing HTML/CSS/JS GUI is enhanced, not rewritten.
- HTTP bridge enables future non-Electron desktop clients.
- Theme engine supports accessibility (high contrast).

**Negative:**
- No Electron build/packaging yet — runs as `node dist/desktop-app.js`.
- No native window management (traffic lights, system tray).
- No IPC for native APIs (file dialogs, notifications, clipboard).
- Desktop server is HTTP-based, not WebSocket — no real-time push.

## Status

Accepted. Implemented in `gui/`, `src/desktop/`, and `src/desktop-app.ts`.
