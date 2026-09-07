export type DesktopEventType =
  | "desktop.ready"
  | "desktop.server.started"
  | "desktop.server.stopped"
  | "desktop.window.created"
  | "desktop.window.closed"
  | "desktop.window.focused"
  | "desktop.window.minimized"
  | "desktop.command.palette"
  | "desktop.theme.changed"
  | "desktop.layout.changed"
  | "desktop.workspace.opened"
  | "desktop.workspace.closed"
  | "desktop.notification"
  | "desktop.update.available"
  | "desktop.update.installed"
  | "desktop.crash";

export interface DesktopConfig {
  readonly port: number;
  readonly staticDir: string;
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly title: string;
  readonly icon?: string;
}

/** Default port for the QUACK desktop server */
export const DEFAULT_PORT = 3157;

export const DEFAULT_DESKTOP_CONFIG: DesktopConfig = {
  port: DEFAULT_PORT,
  staticDir: "gui",
  windowWidth: 1400,
  windowHeight: 900,
  minWidth: 800,
  minHeight: 600,
  title: "QUACK Desktop",
};
