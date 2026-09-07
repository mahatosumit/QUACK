import type { BrowserProvider, ApplicationInfo, BrowserTab, ComputerProvider, DisplayInfo, OcrResult, Point, Rect, Screenshot, UiElement, DetectedRegion, BrowserCookie, BrowserHistoryEntry, BrowserDevTools, WindowInfo, UiElementType } from "./types.js";
import { now } from "../core/types.js";

const DEFAULT_DISPLAY = { x: 0, y: 0, width: 1920, height: 1080 };
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 1920, height: 1080 };
const DEFAULT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 720 };

export class NoopComputerProvider implements ComputerProvider {
  readonly name = "noop";
  readonly platform = process.platform;

  private displays: DisplayInfo[] = [{ id: "display-1", name: "Main Display", bounds: { ...DEFAULT_DISPLAY }, isPrimary: true, scaleFactor: 1, colorDepth: 32, refreshRate: 60 }];
  private cursorPosition: Point = { x: 960, y: 540 };
  private clipboardText = "";
  private windows: WindowInfo[] = [];
  private runningApps: ApplicationInfo[] = [];

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  async getDisplayInfo(): Promise<DisplayInfo[]> {
    return this.displays;
  }

  async captureScreen(displayId?: string, bounds?: Rect): Promise<Screenshot> {
    return { id: createId(), data: Buffer.from("fake-screenshot"), format: "png", displayId: displayId ?? "display-1", bounds: bounds ?? DEFAULT_BOUNDS, capturedAt: now() };
  }

  async moveMouse(point: Point): Promise<void> {
    this.cursorPosition = point;
  }
  async clickMouse(point: Point, _button?: string, _count?: number): Promise<void> {
    this.cursorPosition = point;
  }
  async doubleClick(point: Point): Promise<void> {
    this.cursorPosition = point;
  }
  async dragMouse(_from: Point, to: Point): Promise<void> {
    this.cursorPosition = to;
  }
  async scroll(_point: Point, _deltaX: number, _deltaY: number): Promise<void> {}
  async getCursorPosition(): Promise<Point> {
    return this.cursorPosition;
  }

  async pressKey(_key: string, _modifiers?: string[]): Promise<void> {}
  async typeText(text: string): Promise<void> {
    this.clipboardText = text;
  }
  async holdKey(_key: string): Promise<void> {}
  async releaseKey(_key: string): Promise<void> {}

  async getClipboardText(): Promise<string> {
    return this.clipboardText;
  }
  async setClipboardText(text: string): Promise<void> {
    this.clipboardText = text;
  }
  async getClipboardFiles(): Promise<string[]> {
    return [];
  }
  async clearClipboard(): Promise<void> {
    this.clipboardText = "";
  }

  async getWindows(): Promise<WindowInfo[]> {
    return this.windows;
  }
  async focusWindow(_windowId: string): Promise<void> {}
  async minimizeWindow(_windowId: string): Promise<void> {}
  async maximizeWindow(_windowId: string): Promise<void> {}
  async restoreWindow(_windowId: string): Promise<void> {}
  async closeWindow(_windowId: string): Promise<void> {}
  async resizeWindow(_windowId: string, _bounds: Rect): Promise<void> {}
  async moveWindow(_windowId: string, _position: Point): Promise<void> {}

  async launchApplication(path: string, _args?: string[]): Promise<ApplicationInfo> {
    const app: ApplicationInfo = { id: createId(), name: path.split("/").pop() ?? path, executablePath: path, version: "1.0", windows: [], pid: Math.floor(Math.random() * 10000), running: true, cpuUsage: 0, memoryUsage: 0 };
    this.runningApps.push(app);
    return app;
  }
  async terminateApplication(applicationId: string, _force?: boolean): Promise<void> {
    this.runningApps = this.runningApps.filter((a) => a.id !== applicationId);
  }
  async getRunningApplications(): Promise<ApplicationInfo[]> {
    return this.runningApps;
  }

  async getUiTree(_windowId?: string): Promise<UiElement> {
    return { id: "root", type: "window", label: "Root", bounds: { ...DEFAULT_DISPLAY }, text: "", enabled: true, focused: false, visible: true, children: [], attributes: {}, confidence: 1 };
  }

  async getUiElementAt(point: Point): Promise<UiElement | null> {
    return { id: "el-1", type: "unknown", label: "Element", bounds: { x: point.x - 10, y: point.y - 10, width: 20, height: 20 }, text: "element", enabled: true, focused: false, visible: true, children: [], attributes: {}, confidence: 1 };
  }

  async ocrImage(_image: Screenshot, _bounds?: Rect): Promise<OcrResult> {
    return { regions: [], fullText: "", language: "en", durationMs: 1 };
  }

  async detectElements(_image: Screenshot, _types?: UiElementType[]): Promise<DetectedRegion[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
  getCapabilities(): string[] {
    return ["mouse", "keyboard", "clipboard", "screenshot", "windows", "applications", "ui-tree", "ocr"];
  }
}

export class NoopBrowserProvider implements BrowserProvider {
  readonly name = "noop-browser";
  readonly browserType = "chromium";

  private tabs: BrowserTab[] = [{ id: "tab-1", title: "New Tab", url: "about:blank", active: true, loading: false, domain: "about:blank", createdTimestamp: now() }];
  private activeTabId = "tab-1";
  private cookies: BrowserCookie[] = [];
  private history: BrowserHistoryEntry[] = [];
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  async navigate(url: string, tabId?: string): Promise<{ title: string; url: string }> {
    const tab = this.tabs.find((t) => t.id === (tabId ?? this.activeTabId));
    if (tab) {
      tab.url = url;
      tab.title = url;
      tab.domain = new URL(url).hostname;
    }
    this.history.push({ url, title: url, visitTime: now(), visitCount: 1, typedCount: 0 });
    return { title: url, url };
  }
  async clickElement(_selector: string): Promise<void> {}
  async clickPoint(_point: Point): Promise<void> {}
  async typeText(_text: string, _selector?: string): Promise<void> {}
  async extractContent(_selector?: string): Promise<string> {
    return "<html><body>Mock content</body></html>";
  }
  async screenshot(_fullPage?: boolean): Promise<Screenshot> {
    return { id: createId(), data: Buffer.from("browser-screenshot"), format: "png", displayId: "display-1", bounds: { ...DEFAULT_VIEWPORT }, capturedAt: now() };
  }
  async getTabs(): Promise<BrowserTab[]> {
    return this.tabs;
  }
  async switchTab(tabId: string): Promise<void> {
    this.activeTabId = tabId;
    for (const t of this.tabs) t.active = t.id === tabId;
  }
  async openTab(url?: string): Promise<BrowserTab> {
    const tab: BrowserTab = { id: createId(), title: url ?? "New Tab", url: url ?? "about:blank", active: true, loading: false, domain: url ? new URL(url).hostname : "about:blank", createdTimestamp: now() };
    for (const t of this.tabs) t.active = false;
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    return tab;
  }
  async closeTab(tabId?: string): Promise<void> {
    const id = tabId ?? this.activeTabId;
    this.tabs = this.tabs.filter((t) => t.id !== id);
    if (this.activeTabId === id) {
      this.activeTabId = this.tabs[0]?.id ?? "";
    }
  }
  async getCookies(_domain?: string): Promise<BrowserCookie[]> {
    return this.cookies;
  }
  async setCookie(cookie: BrowserCookie): Promise<void> {
    this.cookies.push(cookie);
  }
  async getHistory(): Promise<BrowserHistoryEntry[]> {
    return this.history;
  }
  async goBack(): Promise<void> {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (tab && this.history.length > 0) {
      const prev = this.history.at(-2);
      if (prev) { tab.url = prev.url; tab.title = prev.title; }
    }
  }
  async goForward(): Promise<void> {}
  async reload(): Promise<void> {}
  async executeDevToolsCommand(_command: string, _params?: Record<string, unknown>): Promise<unknown> {
    return {};
  }
  async getDevToolsInfo(): Promise<BrowserDevTools> {
    return { version: "mock", protocolVersion: "1.3", connected: true, capabilities: [] };
  }
  async uploadFile(_selector: string, _filePath: string): Promise<void> {}
  async handleDialog(_accept: boolean, _text?: string): Promise<void> {}
  async getTitle(): Promise<string> {
    return this.tabs.find((t) => t.id === this.activeTabId)?.title ?? "";
  }
  async getUrl(): Promise<string> {
    return this.tabs.find((t) => t.id === this.activeTabId)?.url ?? "";
  }
  async getDomSnapshot(): Promise<string> {
    return "<html><body>Mock DOM</body></html>";
  }
  async evaluateScript<T>(script: string): Promise<T> {
    return script as unknown as T;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
