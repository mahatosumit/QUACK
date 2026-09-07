import type { NativeService, NativeServiceDefinition, ClipboardContent, DesktopNotification, ProcessInfo, NativeWindowInfo } from "./types.js";

export class NativeServicesManager {
  private services: Map<string, NativeService> = new Map();
  private notifications: DesktopNotification[] = [];
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  // Registers a local definition; this does not install or start an OS service.
  registerService(def: NativeServiceDefinition): string {
    const id = createId();
    const svc: NativeService = {
      name: def.name,
      description: def.description,
      status: "stopped",
      pid: undefined,
      startedAt: undefined,
      autoStart: def.autoStart,
      dependencies: [],
    };
    this.services.set(id, svc);
    return id;
  }

  async startService(id: string): Promise<boolean> {
    throw new Error("Native startService is unsupported: no native service adapter is configured.");
  }

  async stopService(id: string): Promise<boolean> {
    throw new Error("Native stopService is unsupported: no native service adapter is configured.");
  }

  getService(id: string): NativeService | undefined {
    return this.services.get(id);
  }

  getAllServices(): NativeService[] {
    return Array.from(this.services.values());
  }

  getServiceStatus(): { running: number; stopped: number; error: number } {
    const status = { running: 0, stopped: 0, error: 0 };
    for (const svc of this.services.values()) {
      if (svc.status === "running") status.running++;
      else if (svc.status === "error") status.error++;
      else status.stopped++;
    }
    return status;
  }

  async getClipboardContent(): Promise<ClipboardContent> {
    throw new Error("Native getClipboardContent is unsupported: no native service adapter is configured.");
  }

  async setClipboardContent(content: ClipboardContent): Promise<void> {
    throw new Error("Native setClipboardContent is unsupported: no native service adapter is configured.");
  }

  async sendNotification(notification: DesktopNotification): Promise<string> {
    throw new Error("Native sendNotification is unsupported: no native service adapter is configured.");
  }

  getNotifications(): DesktopNotification[] {
    return [...this.notifications];
  }

  async listProcesses(): Promise<ProcessInfo[]> {
    throw new Error("Native listProcesses is unsupported: no native service adapter is configured.");
  }

  async getProcess(pid: number): Promise<ProcessInfo | null> {
    throw new Error("Native getProcess is unsupported: no native service adapter is configured.");
  }

  async killProcess(pid: number, _signal?: string): Promise<boolean> {
    throw new Error("Native killProcess is unsupported: no native service adapter is configured.");
  }

  async listWindows(): Promise<NativeWindowInfo[]> {
    throw new Error("Native listWindows is unsupported: no native service adapter is configured.");
  }

  async focusWindow(windowId: number): Promise<boolean> {
    throw new Error("Native focusWindow is unsupported: no native service adapter is configured.");
  }
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
