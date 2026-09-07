import { fail, ok, now, createId, type QuackResult } from "../core/types.js";
import type { PanelLayout, WorkspaceState } from "./types.js";

const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  leftPanel: [],
  rightPanel: [],
  bottomPanel: [],
  activeView: "editor",
};

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceState>();

  create(name: string, root: string): QuackResult<WorkspaceState> {
    const existing = [...this.workspaces.values()].find(
      (w) => w.name === name,
    );
    if (existing) {
      return fail({
        code: "workspace.duplicate",
        message: `Workspace "${name}" already exists.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const timestamp = now();
    const workspace: WorkspaceState = {
      id: createId("ws"),
      name,
      root,
      createdAt: timestamp,
      lastOpened: timestamp,
      openProjects: [],
      recentFiles: [],
      recentTasks: [],
      panelLayout: { ...DEFAULT_PANEL_LAYOUT },
      activeSkills: [],
      memoryScope: "workspace",
    };

    this.workspaces.set(workspace.id, workspace);
    return ok(workspace);
  }

  open(id: string): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const updated: WorkspaceState = { ...workspace, lastOpened: now() };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  close(id: string): QuackResult<void> {
    if (!this.workspaces.has(id)) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    return ok(undefined);
  }

  get(id: string): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    return ok(workspace);
  }

  getAll(): WorkspaceState[] {
    return [...this.workspaces.values()];
  }

  delete(id: string): QuackResult<void> {
    if (!this.workspaces.has(id)) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    this.workspaces.delete(id);
    return ok(undefined);
  }

  addRecentFile(id: string, file: string): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const filtered = workspace.recentFiles.filter((f) => f !== file);
    const recentFiles = [file, ...filtered].slice(0, 20);

    const updated: WorkspaceState = { ...workspace, recentFiles };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  addRecentTask(id: string, task: string): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const filtered = workspace.recentTasks.filter((t) => t !== task);
    const recentTasks = [task, ...filtered].slice(0, 20);

    const updated: WorkspaceState = { ...workspace, recentTasks };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  updateLayout(
    id: string,
    layout: Partial<PanelLayout>,
  ): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const panelLayout: PanelLayout = {
      ...workspace.panelLayout,
      ...layout,
    };

    const updated: WorkspaceState = { ...workspace, panelLayout };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  setActiveModel(
    id: string,
    modelId: string,
  ): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const updated: WorkspaceState = { ...workspace, activeModelId: modelId };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  addActiveSkill(id: string, skillId: string): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    if (workspace.activeSkills.includes(skillId)) {
      return ok(workspace);
    }

    const activeSkills = [...workspace.activeSkills, skillId];
    const updated: WorkspaceState = { ...workspace, activeSkills };
    this.workspaces.set(id, updated);
    return ok(updated);
  }

  removeActiveSkill(
    id: string,
    skillId: string,
  ): QuackResult<WorkspaceState> {
    const workspace = this.workspaces.get(id);
    if (!workspace) {
      return fail({
        code: "workspace.not_found",
        message: `Workspace ${id} not found.`,
        category: "runtime",
        recoverable: true,
      });
    }

    const activeSkills = workspace.activeSkills.filter((s) => s !== skillId);
    const updated: WorkspaceState = { ...workspace, activeSkills };
    this.workspaces.set(id, updated);
    return ok(updated);
  }
}
