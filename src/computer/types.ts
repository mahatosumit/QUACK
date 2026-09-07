import { type IsoTimestamp } from "../core/types.js";

// ── Coordinates ───────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Screen & Display ──────────────────────────────────────────────

export interface DisplayInfo {
  id: string;
  name: string;
  bounds: Rect;
  isPrimary: boolean;
  scaleFactor: number;
  colorDepth: number;
  refreshRate: number;
}

export interface Screenshot {
  id: string;
  data: Buffer;
  format: "png" | "jpeg" | "bmp";
  displayId: string;
  bounds: Rect;
  capturedAt: IsoTimestamp;
}

// ── UI Elements ───────────────────────────────────────────────────

export type UiElementType =
  | "button" | "menu" | "menu_item" | "dialog" | "form" | "list" | "tree"
  | "tab" | "table" | "toolbar" | "editor" | "canvas" | "chart"
  | "text" | "text_field" | "password_field" | "textarea"
  | "checkbox" | "radio" | "dropdown" | "slider" | "switch"
  | "link" | "image" | "icon" | "progress" | "scrollbar"
  | "window" | "pane" | "group" | "label" | "tooltip" | "notification"
  | "unknown";

export interface UiElement {
  id: string;
  type: UiElementType;
  label: string;
  bounds: Rect;
  text: string;
  enabled: boolean;
  focused: boolean;
  visible: boolean;
  checked?: boolean;
  selected?: boolean;
  value?: string;
  placeholder?: string;
  tooltip?: string;
  children: UiElement[];
  parentId?: string;
  attributes: Record<string, string>;
  confidence: number;
}

export interface DetectedRegion {
  bounds: Rect;
  type: UiElementType;
  label: string;
  confidence: number;
  text: string;
}

// ── OCR ───────────────────────────────────────────────────────────

export interface TextRegion {
  text: string;
  bounds: Rect;
  confidence: number;
  language?: string;
  lines: { text: string; bounds: Rect }[];
}

export interface OcrResult {
  regions: TextRegion[];
  fullText: string;
  language: string;
  durationMs: number;
}

// ── Windows ───────────────────────────────────────────────────────

export interface WindowInfo {
  id: string;
  title: string;
  application: string;
  bounds: Rect;
  processId: number;
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  resizable: boolean;
  closable: boolean;
  layer: number;
}

// ── Applications ──────────────────────────────────────────────────

export interface ApplicationInfo {
  id: string;
  name: string;
  executablePath: string;
  version: string;
  windows: WindowInfo[];
  pid: number;
  running: boolean;
  cpuUsage: number;
  memoryUsage: number;
}

// ── Browser ───────────────────────────────────────────────────────

export type BrowserType = "chrome" | "edge" | "firefox" | "chromium" | "safari" | "opera";

export interface BrowserTab {
  id: string;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
  favicon?: string;
  domain: string;
  createdTimestamp: IsoTimestamp;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "strict" | "lax" | "none";
  expires?: IsoTimestamp;
}

export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitTime: IsoTimestamp;
  visitCount: number;
  typedCount: number;
}

export interface BrowserDevTools {
  version: string;
  protocolVersion: string;
  connected: boolean;
  capabilities: string[];
}

// ── Computer Actions ──────────────────────────────────────────────

export type MouseAction =
  | { type: "move"; target: Point }
  | { type: "click"; target: Point; button?: "left" | "right" | "middle"; count?: number }
  | { type: "double_click"; target: Point }
  | { type: "drag"; from: Point; to: Point }
  | { type: "scroll"; target: Point; deltaX: number; deltaY: number }
  | { type: "hover"; target: Point; durationMs?: number };

export type KeyboardAction =
  | { type: "type"; text: string }
  | { type: "key_down"; key: string }
  | { type: "key_up"; key: string }
  | { type: "press"; key: string; modifiers?: string[] }
  | { type: "shortcut"; keys: string[] };

export type ClipboardAction =
  | { type: "get_text" }
  | { type: "set_text"; text: string }
  | { type: "get_files" }
  | { type: "clear" };

export type WindowAction =
  | { type: "focus"; windowId: string }
  | { type: "minimize"; windowId: string }
  | { type: "maximize"; windowId: string }
  | { type: "restore"; windowId: string }
  | { type: "resize"; windowId: string; bounds: Rect }
  | { type: "close"; windowId: string }
  | { type: "move"; windowId: string; position: Point }
  | { type: "enumerate" };

export type ApplicationAction =
  | { type: "launch"; path: string; args?: string[] }
  | { type: "terminate"; applicationId: string; force?: boolean }
  | { type: "list_running" }
  | { type: "get_info"; applicationId: string };

export type BrowserAction =
  | { type: "navigate"; url: string; tabId?: string }
  | { type: "click"; selector?: string; target?: Point }
  | { type: "type_text"; text: string; selector?: string }
  | { type: "extract"; selector?: string }
  | { type: "screenshot"; fullPage?: boolean }
  | { type: "get_tabs" }
  | { type: "switch_tab"; tabId: string }
  | { type: "close_tab"; tabId?: string }
  | { type: "open_tab"; url?: string }
  | { type: "get_cookies"; domain?: string }
  | { type: "set_cookie"; cookie: BrowserCookie }
  | { type: "get_history" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" }
  | { type: "devtools"; command: string; params?: Record<string, unknown> }
  | { type: "upload_file"; selector: string; filePath: string }
  | { type: "download_file"; url: string; destination: string }
  | { type: "handle_dialog"; accept: boolean; text?: string };

export type SessionAction =
  | { type: "start_recording" }
  | { type: "stop_recording" }
  | { type: "pause_recording" }
  | { type: "resume_recording" }
  | { type: "replay"; sessionId: string; stepIndex?: number }
  | { type: "step_forward" }
  | { type: "step_backward" };

export type MacroAction =
  | { type: "record_macro"; name: string }
  | { type: "stop_recording_macro" }
  | { type: "run_macro"; macroId: string; params?: Record<string, unknown> }
  | { type: "list_macros" }
  | { type: "export_macro"; macroId: string }
  | { type: "import_macro"; definition: MacroDefinition };

export type ComputerAction =
  | { type: "mouse"; action: MouseAction }
  | { type: "keyboard"; action: KeyboardAction }
  | { type: "clipboard"; action: ClipboardAction }
  | { type: "window"; action: WindowAction }
  | { type: "application"; action: ApplicationAction }
  | { type: "browser"; action: BrowserAction }
  | { type: "session"; action: SessionAction }
  | { type: "macro"; action: MacroAction }
  | { type: "screenshot"; displayId?: string }
  | { type: "get_display_info" }
  | { type: "get_desktop_state" }
  | { type: "find_element"; elementType?: UiElementType; label?: string; text?: string; timeoutMs?: number }
  | { type: "wait"; durationMs: number }
  | { type: "inspect_element"; selector: string }
  | { type: "highlight_element"; selector: string }
  | { type: "type_password"; password: string };

// ── Computer Action Results ───────────────────────────────────────

export interface MouseActionResult {
  success: boolean;
  finalPosition?: Point;
  elementsUnder?: UiElement[];
  durationMs: number;
}

export interface KeyboardActionResult {
  success: boolean;
  durationMs: number;
}

export interface ClipboardActionResult {
  success: boolean;
  text?: string;
  files?: string[];
  durationMs: number;
}

export interface WindowActionResult {
  success: boolean;
  windows?: WindowInfo[];
  window?: WindowInfo;
  durationMs: number;
}

export interface ApplicationActionResult {
  success: boolean;
  application?: ApplicationInfo;
  applications?: ApplicationInfo[];
  durationMs: number;
}

export interface BrowserActionResult {
  success: boolean;
  title?: string;
  url?: string;
  content?: string;
  screenshot?: Screenshot;
  tabs?: BrowserTab[];
  cookies?: BrowserCookie[];
  history?: BrowserHistoryEntry[];
  devtools?: BrowserDevTools;
  durationMs: number;
}

export interface ScreenshotResult {
  screenshot: Screenshot;
  durationMs: number;
}

export interface FindElementResult {
  elements: UiElement[];
  totalCount: number;
  durationMs: number;
}

export interface DesktopStateResult {
  displays: DisplayInfo[];
  windows: WindowInfo[];
  focusedWindowId?: string;
  cursorPosition: Point;
  applications: ApplicationInfo[];
  timestamp: IsoTimestamp;
}

export type ActionResult =
  | { type: "mouse"; result: MouseActionResult }
  | { type: "keyboard"; result: KeyboardActionResult }
  | { type: "clipboard"; result: ClipboardActionResult }
  | { type: "window"; result: WindowActionResult }
  | { type: "application"; result: ApplicationActionResult }
  | { type: "browser"; result: BrowserActionResult }
  | { type: "screenshot"; result: ScreenshotResult }
  | { type: "find_element"; result: FindElementResult }
  | { type: "desktop_state"; result: DesktopStateResult }
  | { type: "wait"; result: { success: boolean; durationMs: number } }
  | { type: "inspect_element"; result: { element: UiElement; durationMs: number } }
  | { type: "highlight_element"; result: { success: boolean; durationMs: number } }
  | { type: "error"; error: string; message: string };

// ── Computer Plan ─────────────────────────────────────────────────

export type ObservationType = "screen" | "focused_window" | "active_elements" | "cursor_position" | "application_state" | "clipboard_content" | "ocr" | "ui_tree";

export interface ComputerObservation {
  type: ObservationType;
  result: unknown;
  timestamp: IsoTimestamp;
}

export interface ComputerPlanStep {
  id: string;
  description: string;
  action: ComputerAction;
  expectedOutcome: string;
  verificationMethod: "screenshot" | "element_exists" | "element_gone" | "text_appears" | "text_disappears" | "url_changed" | "window_changed" | "application_state";
  timeoutMs: number;
  retryOnFailure: boolean;
  maxRetries: number;
  fallback?: ComputerAction;
}

export interface ComputerPlan {
  id: string;
  goal: string;
  steps: ComputerPlanStep[];
  observations: ComputerObservation[];
  confidence: number;
  context: string;
  createdAt: IsoTimestamp;
}

// ── Sessions & Recording ──────────────────────────────────────────

export interface RecordedStep {
  id: string;
  action: ComputerAction;
  screenshotBefore?: Screenshot;
  screenshotAfter?: Screenshot;
  result: ActionResult;
  timestamp: IsoTimestamp;
  durationMs: number;
  annotation?: string;
}

export interface SessionRecording {
  id: string;
  name: string;
  steps: RecordedStep[];
  durationMs: number;
  startedAt: IsoTimestamp;
  endedAt?: IsoTimestamp;
  paused: boolean;
  tags: string[];
}

// ── Macros ─────────────────────────────────────────────────────────

export interface MacroParameter {
  name: string;
  type: "string" | "number" | "boolean" | "point" | "rect" | "select";
  description: string;
  required: boolean;
  default?: unknown;
  options?: string[];
}

export interface MacroStep {
  description: string;
  action: ComputerAction;
  condition?: { field: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"; value: unknown };
  loop?: { variable: string; over: string; steps: MacroStep[] };
  validation?: { method: string; expected: unknown };
}

export interface MacroDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  parameters: MacroParameter[];
  steps: MacroStep[];
  tags: string[];
  requiredPermissions: string[];
  supportedApplications: string[];
  platformCompatibility: string[];
  fallbackStrategies: string[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  usageCount: number;
  lastUsedAt?: IsoTimestamp;
}

// ── Safety & Permissions ──────────────────────────────────────────

export type ProtectedAction = "mouse" | "keyboard" | "clipboard" | "window" | "application" | "browser" | "screen_capture" | "file_access" | "network";

export interface SafetyPolicy {
  level: "simulation" | "dry_run" | "live" | "unrestricted";
  allowedActions: ProtectedAction[];
  applicationAllowlist: string[];
  applicationDenylist: string[];
  domainAllowlist: string[];
  domainDenylist: string[];
  requireConfirmation: ProtectedAction[];
  maxUndoActions: number;
  enableAutomaticRollback: boolean;
  auditAllActions: boolean;
}

export interface ComputerPermission {
  action: ProtectedAction;
  allowed: boolean;
  requiresConfirmation: boolean;
  grantedAt?: IsoTimestamp;
  grantedBy?: string;
  reason?: string;
}

// ── Computer Provider ─────────────────────────────────────────────

export interface ComputerProvider {
  readonly name: string;
  readonly platform: string;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;

  getDisplayInfo(): Promise<DisplayInfo[]>;
  captureScreen(displayId?: string, bounds?: Rect): Promise<Screenshot>;

  moveMouse(point: Point): Promise<void>;
  clickMouse(point: Point, button?: string, count?: number): Promise<void>;
  doubleClick(point: Point): Promise<void>;
  dragMouse(from: Point, to: Point): Promise<void>;
  scroll(point: Point, deltaX: number, deltaY: number): Promise<void>;
  getCursorPosition(): Promise<Point>;

  pressKey(key: string, modifiers?: string[]): Promise<void>;
  typeText(text: string): Promise<void>;
  holdKey(key: string): Promise<void>;
  releaseKey(key: string): Promise<void>;

  getClipboardText(): Promise<string>;
  setClipboardText(text: string): Promise<void>;
  getClipboardFiles(): Promise<string[]>;
  clearClipboard(): Promise<void>;

  getWindows(): Promise<WindowInfo[]>;
  focusWindow(windowId: string): Promise<void>;
  minimizeWindow(windowId: string): Promise<void>;
  maximizeWindow(windowId: string): Promise<void>;
  restoreWindow(windowId: string): Promise<void>;
  closeWindow(windowId: string): Promise<void>;
  resizeWindow(windowId: string, bounds: Rect): Promise<void>;
  moveWindow(windowId: string, position: Point): Promise<void>;

  launchApplication(path: string, args?: string[]): Promise<ApplicationInfo>;
  terminateApplication(applicationId: string, force?: boolean): Promise<void>;
  getRunningApplications(): Promise<ApplicationInfo[]>;

  getUiTree(windowId?: string): Promise<UiElement>;
  getUiElementAt(point: Point): Promise<UiElement | null>;

  ocrImage(image: Screenshot, bounds?: Rect): Promise<OcrResult>;
  detectElements(image: Screenshot, types?: UiElementType[]): Promise<DetectedRegion[]>;

  isAvailable(): Promise<boolean>;
  getCapabilities(): string[];
}

// ── Browser Provider ──────────────────────────────────────────────

export interface BrowserProvider {
  readonly name: string;
  readonly browserType: BrowserType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  navigate(url: string, tabId?: string): Promise<{ title: string; url: string }>;
  clickElement(selector: string): Promise<void>;
  clickPoint(point: Point): Promise<void>;
  typeText(text: string, selector?: string): Promise<void>;
  extractContent(selector?: string): Promise<string>;
  screenshot(fullPage?: boolean): Promise<Screenshot>;

  getTabs(): Promise<BrowserTab[]>;
  switchTab(tabId: string): Promise<void>;
  openTab(url?: string): Promise<BrowserTab>;
  closeTab(tabId?: string): Promise<void>;

  getCookies(domain?: string): Promise<BrowserCookie[]>;
  setCookie(cookie: BrowserCookie): Promise<void>;

  getHistory(): Promise<BrowserHistoryEntry[]>;

  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;

  executeDevToolsCommand(command: string, params?: Record<string, unknown>): Promise<unknown>;
  getDevToolsInfo(): Promise<BrowserDevTools>;

  uploadFile(selector: string, filePath: string): Promise<void>;
  handleDialog(accept: boolean, text?: string): Promise<void>;

  getTitle(): Promise<string>;
  getUrl(): Promise<string>;
  getDomSnapshot(): Promise<string>;
  evaluateScript<T>(script: string): Promise<T>;

  isConnected(): boolean;
}

// ── Computer Skills ───────────────────────────────────────────────

export interface ComputerSkill {
  name: string;
  description: string;
  supportedApplications: string[];
  requiredPermissions: string[];
  requiredCapabilities: string[];
  platformCompatibility: string[];
  fallbackStrategies: string[];
  execute(params: Record<string, unknown>): Promise<ActionResult>;
}
