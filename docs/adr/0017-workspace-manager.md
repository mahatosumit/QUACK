# ADR 0017: Workspace Manager Architecture

Status: Accepted

## Context

QUACK needs a **Workspace Manager** that persists user state across sessions — open projects, panel layouts, recent files, recent tasks, active models, active skills, and workspace memory. Users should be able to switch between multiple workspaces without losing context.

## Decision

### Workspace State

Every workspace is a `WorkspaceState` object:

```typescript
interface WorkspaceState {
  id: string;
  name: string;
  root: string;               // File system root
  createdAt: string;
  lastOpened: string;
  openProjects: string[];     // Project paths
  recentFiles: string[];      // Max 20
  recentTasks: string[];      // Max 20
  panelLayout: PanelLayout;   // Panel configuration
  activeModelId?: string;
  activeSkills: string[];     // Enabled skill IDs
  memoryScope: "session" | "workspace" | "project";
}
```

### Panel Layout

```typescript
interface PanelLayout {
  leftPanel: string[];     // Panel IDs for left dock
  rightPanel: string[];    // Panel IDs for right dock
  bottomPanel: string[];   // Panel IDs for bottom dock
  activeView: string;      // Currently active view
}
```

### Workspace Manager

The `WorkspaceManager` class manages multiple workspaces in memory:

| Method | Purpose |
|--------|---------|
| `create(name, root)` | Create new workspace |
| `open(id)` | Open workspace (updates timestamp) |
| `close(id)` | Close workspace |
| `get(id)` | Get workspace by ID |
| `getAll()` | List all workspaces |
| `delete(id)` | Remove workspace |
| `addRecentFile(id, file)` | Track file (max 20, dedup) |
| `addRecentTask(id, task)` | Track task (max 20) |
| `updateLayout(id, layout)` | Save panel layout |
| `setActiveModel(id, modelId)` | Set active model |
| `addActiveSkill(id, skillId)` | Enable skill |
| `removeActiveSkill(id, skillId)` | Disable skill |

### Persistence

Currently in-memory only. Future phases will add:
- JSON file persistence to `dataDir/workspaces.json`
- Auto-save on state changes
- Workspace import/export

### Integration with System

The `WorkspaceManager` is created in `create-system.ts` and exposed as `QuackSystem.workspaces`. A default workspace named "default" is created on startup pointing at `config.workspaceRoot`.

## Consequences

**Positive:**
- Simple in-memory model with clear CRUD operations.
- Panel layout enables saving/restoring UI state.
- Recent files and tasks support quick navigation.
- Integration point for future file-based persistence.

**Negative:**
- No file persistence yet — all state is lost on restart.
- No workspace switching in the GUI (requires CLI or API).
- No multi-user or collaborative workspace support.

## Status

Accepted. Implemented in `src/workspace/`.
