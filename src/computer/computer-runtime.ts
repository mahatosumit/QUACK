const MAX_AUDIT_LOG_LENGTH = 1000;

import type { EventBus, QuackEventType } from "../events/event-bus.js";
import { now } from "../core/types.js";
import type {
  ActionResult, BrowserProvider, ComputerAction, ComputerPermission, ComputerProvider,
  MouseActionResult, KeyboardActionResult, ClipboardActionResult, WindowActionResult,
  ApplicationActionResult, BrowserActionResult, ScreenshotResult, FindElementResult,
  DesktopStateResult, SafetyPolicy, Point, Rect,
} from "./types.js";
import { NoopComputerProvider, NoopBrowserProvider } from "./noop-provider.js";

const DEFAULT_SAFETY: SafetyPolicy = {
  level: "live",
  allowedActions: ["mouse", "keyboard", "clipboard", "window", "application", "browser", "screen_capture", "file_access", "network"],
  applicationAllowlist: [],
  applicationDenylist: [],
  domainAllowlist: [],
  domainDenylist: [],
  requireConfirmation: [],
  maxUndoActions: 50,
  enableAutomaticRollback: true,
  auditAllActions: true,
};

export interface ComputerRuntimeOptions {
  provider?: ComputerProvider;
  browserProvider?: BrowserProvider;
  safetyPolicy?: SafetyPolicy;
  eventBus?: EventBus;
}

function emit(eb: EventBus | undefined, event: string, data: Record<string, unknown>): void {
  if (eb) eb.emit(event as QuackEventType, data as any, { actor: "computer-runtime" } as any).catch((err: Error) => {
    console.error("[ComputerRuntime] Failed to emit event:", err.message);
  });
}

export class ComputerRuntime {
  private provider: ComputerProvider;
  private browserProvider: BrowserProvider;
  private safety: SafetyPolicy;
  private eventBus?: EventBus;
  private permissions: Map<string, ComputerPermission> = new Map();
  private auditLog: { action: ComputerAction; result: ActionResult; timestamp: string }[] = [];

  constructor(options: ComputerRuntimeOptions = {}) {
    this.provider = options.provider ?? new NoopComputerProvider();
    this.browserProvider = options.browserProvider ?? new NoopBrowserProvider();
    this.safety = options.safetyPolicy ?? DEFAULT_SAFETY;
    this.eventBus = options.eventBus;
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
    await this.browserProvider.connect();
    emit(this.eventBus, "computer.initialized", {});
  }

  async shutdown(): Promise<void> {
    await this.browserProvider.disconnect();
    await this.provider.shutdown();
    emit(this.eventBus, "computer.shutdown", {});
  }

  async execute(action: ComputerAction): Promise<ActionResult> {
    const startTime = Date.now();
    emit(this.eventBus, "computer.action.started", { action });

    if (!this.isActionAllowed(action)) {
      const result: ActionResult = { type: "error", error: "ACTION_NOT_ALLOWED", message: `Action type not allowed by current safety policy` };
      this.audit(action, result);
      return result;
    }

    try {
      const result = await this.dispatch(action, startTime);
      this.audit(action, result);
      emit(this.eventBus, "computer.action.completed", { action, result });
      return result;
    } catch (err) {
      const errorResult: ActionResult = { type: "error", error: "EXECUTION_ERROR", message: err instanceof Error ? err.message : String(err) };
      this.audit(action, errorResult);
      emit(this.eventBus, "computer.action.failed", { action, error: errorResult.message });
      return errorResult;
    }
  }

  private async dispatch(action: ComputerAction, startTime: number): Promise<ActionResult> {
    switch (action.type) {
      case "mouse": return this.execMouse(action, startTime);
      case "keyboard": return this.execKeyboard(action, startTime);
      case "clipboard": return this.execClipboard(action, startTime);
      case "window": return this.execWindow(action, startTime);
      case "application": return this.execApplication(action, startTime);
      case "browser": return this.execBrowser(action, startTime);
      case "screenshot": return this.execScreenshot(action, startTime);
      case "get_display_info": return this.execDisplayInfo(startTime);
      case "get_desktop_state": return this.execDesktopState(startTime);
      case "find_element": return this.execFindElement(action, startTime);
      case "wait": return this.execWait(action, startTime);
      case "inspect_element": return this.execInspect(action, startTime);
      case "highlight_element": return this.execHighlight(action, startTime);
      case "session": return { type: "error", error: "NOT_IMPLEMENTED", message: "Session recording not yet implemented" } as ActionResult;
      case "macro": return { type: "error", error: "NOT_IMPLEMENTED", message: "Macro engine not yet implemented" } as ActionResult;
      default: return { type: "error", error: "UNKNOWN_ACTION", message: "Unknown action type" } as ActionResult;
    }
  }

  private async execMouse(action: ComputerAction & { type: "mouse" }, start: number): Promise<ActionResult> {
    const a = action.action;
    if (a.type === "move") await this.provider.moveMouse(a.target);
    else if (a.type === "click") await this.provider.clickMouse(a.target, a.button, a.count);
    else if (a.type === "double_click") await this.provider.doubleClick(a.target);
    else if (a.type === "hover") await this.provider.moveMouse(a.target);
    else if (a.type === "drag") await this.provider.dragMouse(a.from, a.to);
    else if (a.type === "scroll") await this.provider.scroll(a.target, a.deltaX, a.deltaY);
    const pos = await this.provider.getCursorPosition();
    return { type: "mouse", result: { success: true, finalPosition: pos, durationMs: Date.now() - start } };
  }

  private async execKeyboard(action: ComputerAction & { type: "keyboard" }, start: number): Promise<ActionResult> {
    const a = action.action;
    if (a.type === "type") await this.provider.typeText(a.text);
    else if (a.type === "press") await this.provider.pressKey(a.key, a.modifiers);
    else if (a.type === "key_down") await this.provider.holdKey(a.key);
    else if (a.type === "key_up") await this.provider.releaseKey(a.key);
    else if (a.type === "shortcut") {
      for (const k of a.keys) await this.provider.pressKey(k, a.keys.filter((x) => x !== k));
    }
    return { type: "keyboard", result: { success: true, durationMs: Date.now() - start } };
  }

  private async execClipboard(action: ComputerAction & { type: "clipboard" }, start: number): Promise<ActionResult> {
    const a = action.action;
    if (a.type === "get_text") {
      const text = await this.provider.getClipboardText();
      return { type: "clipboard", result: { success: true, text, durationMs: Date.now() - start } };
    } else if (a.type === "set_text") {
      await this.provider.setClipboardText(a.text);
      return { type: "clipboard", result: { success: true, durationMs: Date.now() - start } };
    } else if (a.type === "get_files") {
      const files = await this.provider.getClipboardFiles();
      return { type: "clipboard", result: { success: true, files, durationMs: Date.now() - start } };
    }
    await this.provider.clearClipboard();
    return { type: "clipboard", result: { success: true, durationMs: Date.now() - start } };
  }

  private async execWindow(action: ComputerAction & { type: "window" }, start: number): Promise<ActionResult> {
    const a = action.action;
    if (a.type === "enumerate") {
      const windows = await this.provider.getWindows();
      return { type: "window", result: { success: true, windows, durationMs: Date.now() - start } };
    }
    if (a.type === "focus") await this.provider.focusWindow(a.windowId);
    else if (a.type === "minimize") await this.provider.minimizeWindow(a.windowId);
    else if (a.type === "maximize") await this.provider.maximizeWindow(a.windowId);
    else if (a.type === "restore") await this.provider.restoreWindow(a.windowId);
    else if (a.type === "close") await this.provider.closeWindow(a.windowId);
    else if (a.type === "resize") await this.provider.resizeWindow(a.windowId, a.bounds);
    else if (a.type === "move") await this.provider.moveWindow(a.windowId, a.position);
    const windows = await this.provider.getWindows();
    const w = windows.find((w2) => w2.id === a.windowId);
    return { type: "window", result: { success: true, windows, window: w, durationMs: Date.now() - start } };
  }

  private async execApplication(action: ComputerAction & { type: "application" }, start: number): Promise<ActionResult> {
    const a = action.action;
    if (a.type === "list_running") {
      const apps = await this.provider.getRunningApplications();
      return { type: "application", result: { success: true, applications: apps, durationMs: Date.now() - start } };
    }
    if (a.type === "launch") {
      const app = await this.provider.launchApplication(a.path, a.args);
      return { type: "application", result: { success: true, application: app, durationMs: Date.now() - start } };
    }
    if (a.type === "terminate") {
      await this.provider.terminateApplication(a.applicationId, a.force);
      return { type: "application", result: { success: true, durationMs: Date.now() - start } };
    }
    const apps = await this.provider.getRunningApplications();
    const app = apps.find((a2) => a2.id === a.applicationId);
    return { type: "application", result: { success: true, application: app, durationMs: Date.now() - start } };
  }

  private async execBrowser(action: ComputerAction & { type: "browser" }, start: number): Promise<ActionResult> {
    const br = this.browserProvider;
    const a = action.action;
    switch (a.type) {
      case "navigate": {
        const nav = await br.navigate(a.url, a.tabId);
        return { type: "browser", result: { success: true, title: nav.title, url: nav.url, durationMs: Date.now() - start } };
      }
      case "click": {
        if (a.selector) await br.clickElement(a.selector);
        else if (a.target) await br.clickPoint(a.target);
        return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      }
      case "type_text": {
        await br.typeText(a.text, a.selector);
        return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      }
      case "extract": {
        const content = await br.extractContent(a.selector);
        return { type: "browser", result: { success: true, content, durationMs: Date.now() - start } };
      }
      case "screenshot": {
        const ss = await br.screenshot(a.fullPage);
        return { type: "browser", result: { success: true, screenshot: ss, durationMs: Date.now() - start } };
      }
      case "get_tabs": {
        const tabs = await br.getTabs();
        return { type: "browser", result: { success: true, tabs, durationMs: Date.now() - start } };
      }
      case "switch_tab": await br.switchTab(a.tabId); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "close_tab": await br.closeTab(a.tabId); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "open_tab": await br.openTab(a.url); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "get_cookies": {
        const cookies = await br.getCookies(a.domain);
        return { type: "browser", result: { success: true, cookies, durationMs: Date.now() - start } };
      }
      case "set_cookie": await br.setCookie(a.cookie); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "get_history": {
        const history = await br.getHistory();
        return { type: "browser", result: { success: true, history, durationMs: Date.now() - start } };
      }
      case "back": await br.goBack(); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "forward": await br.goForward(); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "reload": await br.reload(); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "devtools": {
        const result = await br.executeDevToolsCommand(a.command, a.params);
        return { type: "browser", result: { success: true, devtools: result as any, durationMs: Date.now() - start } };
      }
      case "upload_file": await br.uploadFile(a.selector, a.filePath); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      case "handle_dialog": await br.handleDialog(a.accept, a.text); return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
      default: return { type: "browser", result: { success: true, durationMs: Date.now() - start } };
    }
  }

  private async execScreenshot(action: ComputerAction & { type: "screenshot" }, start: number): Promise<ActionResult> {
    const ss = await this.provider.captureScreen(action.displayId);
    return { type: "screenshot", result: { screenshot: ss, durationMs: Date.now() - start } };
  }

  private async execDisplayInfo(start: number): Promise<ActionResult> {
    const displays = await this.provider.getDisplayInfo();
    const windows = await this.provider.getWindows();
    const cursorPosition = await this.provider.getCursorPosition();
    const applications = await this.provider.getRunningApplications();
    return { type: "desktop_state", result: { displays, windows, cursorPosition, applications, timestamp: now() } };
  }

  private async execDesktopState(start: number): Promise<ActionResult> {
    const displays = await this.provider.getDisplayInfo();
    const windows = await this.provider.getWindows();
    const cursorPosition = await this.provider.getCursorPosition();
    const applications = await this.provider.getRunningApplications();
    const focusedWindowId = windows.find((w) => w.focused)?.id;
    return { type: "desktop_state", result: { displays, windows, focusedWindowId, cursorPosition, applications, timestamp: now() } };
  }

  private async execFindElement(action: ComputerAction & { type: "find_element" }, start: number): Promise<ActionResult> {
    const tree = await this.provider.getUiTree();
    const elements = this.findInTree(tree, action.elementType, action.label, action.text);
    return { type: "find_element", result: { elements, totalCount: elements.length, durationMs: Date.now() - start } };
  }

  private findInTree(node: import("./types.js").UiElement, elementType?: string, label?: string, text?: string): import("./types.js").UiElement[] {
    const results: import("./types.js").UiElement[] = [];
    let match = true;
    if (elementType && node.type !== elementType) match = false;
    if (label && !node.label.toLowerCase().includes(label.toLowerCase())) match = false;
    if (text && !node.text.toLowerCase().includes(text.toLowerCase())) match = false;
    if (match) results.push(node);
    for (const child of node.children) results.push(...this.findInTree(child, elementType, label, text));
    return results;
  }

  private async execWait(action: ComputerAction & { type: "wait" }, start: number): Promise<ActionResult> {
    await new Promise((resolve) => setTimeout(resolve, action.durationMs));
    return { type: "wait", result: { success: true, durationMs: Date.now() - start } };
  }

  private async execInspect(action: ComputerAction & { type: "inspect_element" }, start: number): Promise<ActionResult> {
    const tree = await this.provider.getUiTree();
    const elements = this.findInTree(tree, undefined, action.selector, undefined);
    return { type: "inspect_element", result: { element: elements[0] ?? tree, durationMs: Date.now() - start } };
  }

  private async execHighlight(action: ComputerAction & { type: "highlight_element" }, start: number): Promise<ActionResult> {
    return { type: "highlight_element", result: { success: true, durationMs: Date.now() - start } };
  }

  private isActionAllowed(action: ComputerAction): boolean {
    if (this.safety.level === "simulation") return action.type === "screenshot" || action.type === "get_display_info" || action.type === "get_desktop_state" || action.type === "wait";
    if (this.safety.level === "dry_run") return action.type === "screenshot" || action.type === "get_display_info" || action.type === "get_desktop_state" || action.type === "find_element" || action.type === "inspect_element" || action.type === "wait";

    const actionTypeMap: Record<string, import("./types.js").ProtectedAction> = {
      mouse: "mouse", keyboard: "keyboard", clipboard: "clipboard",
      window: "window", application: "application", browser: "browser",
      screenshot: "screen_capture",
    };
    const protectedAction = actionTypeMap[action.type];
    if (protectedAction && this.safety.requireConfirmation.includes(protectedAction)) {
      const perm = this.permissions.get(protectedAction);
      if (!perm?.allowed) return false;
    }
    return this.safety.allowedActions.includes(protectedAction ?? "screen_capture");
  }

  setSafetyPolicy(policy: SafetyPolicy): void {
    this.safety = policy;
  }

  getSafetyPolicy(): SafetyPolicy {
    return { ...this.safety };
  }

  grantPermission(action: import("./types.js").ProtectedAction, allowed: boolean, reason?: string): void {
    this.permissions.set(action, { action, allowed, requiresConfirmation: false, grantedAt: now(), grantedBy: "user", reason });
  }

  revokePermission(action: import("./types.js").ProtectedAction): void {
    this.permissions.delete(action);
  }

  getPermissions(): Map<string, ComputerPermission> {
    return new Map(this.permissions);
  }

  getAuditLog(): { action: ComputerAction; result: ActionResult; timestamp: string }[] {
    return [...this.auditLog];
  }

  getProvider(): ComputerProvider {
    return this.provider;
  }

  getBrowserProvider(): BrowserProvider {
    return this.browserProvider;
  }

  private audit(action: ComputerAction, result: ActionResult): void {
    this.auditLog.push({ action, result, timestamp: now() });
    if (this.auditLog.length > MAX_AUDIT_LOG_LENGTH) this.auditLog = this.auditLog.slice(-Math.floor(MAX_AUDIT_LOG_LENGTH / 2));
  }
}
