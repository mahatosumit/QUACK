export interface WorkspaceState {
  readonly id: string;
  readonly name: string;
  readonly root: string;
  readonly createdAt: string;
  readonly lastOpened: string;
  readonly openProjects: readonly string[];
  readonly recentFiles: readonly string[];
  readonly recentTasks: readonly string[];
  readonly panelLayout: PanelLayout;
  readonly activeModelId?: string;
  readonly activeSkills: readonly string[];
  readonly memoryScope: "session" | "workspace" | "project";
}

export interface PanelLayout {
  readonly leftPanel: readonly string[];
  readonly rightPanel: readonly string[];
  readonly bottomPanel: readonly string[];
  readonly activeView: string;
}
