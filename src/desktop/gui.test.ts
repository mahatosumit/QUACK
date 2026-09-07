import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const GUI_BASE = "../../gui/src";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockStyle = any;

interface MockElement {
  tagName: string;
  id: string;
  className: string;
  hidden: boolean;
  textContent: string;
  innerHTML: string;
  value: string;
  style: MockStyle;
  parentElement: MockElement | null;
  children: MockElement[];
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, val: string) => void;
  classList: {
    _tokens: Set<string>;
    add: (...names: string[]) => void;
    remove: (...names: string[]) => void;
    toggle: (name: string, force?: boolean) => boolean;
    contains: (name: string) => boolean;
    length: number;
  };
  addEventListener: (evt: string, fn: () => void) => void;
  removeEventListener: (evt: string, fn: () => void) => void;
  appendChild: (child: MockElement) => void;
  removeChild: (child: MockElement) => void;
  remove: () => void;
  focus: () => void;
  click: () => void;
  querySelector: (sel: string) => MockElement | null;
  querySelectorAll: (sel: string) => MockElement[];
  [key: string]: unknown;
}

interface LocalStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, val: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  length: number;
  key: (idx: number) => string | null;
}

function mkLocalStore(): LocalStore {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => { storage.set(key, val); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
    get length() { return storage.size; },
    key: (idx: number) => [...storage.keys()][idx] ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createDoc(): { doc: any; ls: LocalStore } {
  const elementsById = new Map<string, MockElement>();
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const ls = mkLocalStore();

  function mkEl(tag: string): MockElement {
    const attrs = new Map<string, string>();
    const children: MockElement[] = [];
    const listenerMap = new Map<string, Array<() => void>>();
    const tokens = new Set<string>();
    const _style: MockStyle & { setProperty: (prop: string, val: string) => void } = {
      setProperty(prop: string, val: string) { _style[prop] = val; },
    };
    let text = "";
    let hidden = false;
    let _className = "";
    let _innerHTML = "";
    let _value = "";
    let _id = "";
    let _parent: MockElement | null = null;

    return {
      get tagName() { return tag.toUpperCase(); },
      set tagName(_v: string) {},
      get id() { return _id; },
      set id(v: string) {
        // Remove old ID mapping, set new one
        if (_id) elementsById.delete(_id);
        _id = v;
        if (v) elementsById.set(v, this as unknown as MockElement);
      },
      get className() { return _className; },
      set className(v: string) { _className = v; },
      get hidden() { return hidden; },
      set hidden(v: boolean) { hidden = v; },
      get textContent() { return text; },
      set textContent(v: string) { text = String(v); },
      get innerHTML() { return _innerHTML; },
      set innerHTML(v: string) { _innerHTML = v; },
      get value() { return _value; },
      set value(v: string) { _value = v; },
      get style() { return _style; },
      set style(v: Record<string, string> | (Record<string, string> & { setProperty: (prop: string, val: string) => void })) {
        Object.assign(_style, v);
      },
      get parentElement() { return _parent; },
      set parentElement(v: MockElement | null) { _parent = v; },
      children,
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, val: string) => { attrs.set(name, val); },
      classList: {
        _tokens: tokens,
        add: (...names: string[]) => { for (const n of names) tokens.add(n); },
        remove: (...names: string[]) => { for (const n of names) tokens.delete(n); },
        toggle: (name: string, force?: boolean) => {
          if (force !== undefined) {
            if (force) { tokens.add(name); return true; }
            tokens.delete(name); return false;
          }
          if (tokens.has(name)) { tokens.delete(name); return false; }
          tokens.add(name); return true;
        },
        contains: (name: string) => tokens.has(name),
        get length() { return tokens.size; },
      },
      addEventListener: (evt: string, fn: () => void) => {
        if (!listenerMap.has(evt)) listenerMap.set(evt, []);
        listenerMap.get(evt)!.push(fn);
      },
      removeEventListener: (evt: string, fn: () => void) => {
        const arr = listenerMap.get(evt);
        if (arr) {
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        }
      },
      appendChild: (child: MockElement) => { children.push(child); },
      removeChild: (child: MockElement) => {
        const idx = children.indexOf(child);
        if (idx >= 0) children.splice(idx, 1);
      },
      remove: () => {
        if (_id) elementsById.delete(_id);
      },
      focus: () => {},
      click: () => {
        const arr = listenerMap.get("click");
        if (arr) arr.forEach((fn) => fn());
      },
      querySelector: () => null,
      querySelectorAll: () => [],
    };
  }

  const doc: Record<string, unknown> = {
    documentElement: mkEl("html"),
    body: mkEl("body"),
    createElement: mkEl,
    getElementById: (id: string) => elementsById.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createDocumentFragment: () => ({ appendChild: () => {} }),
    addEventListener: (evt: string, fn: (e: unknown) => void) => {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt)!.push(fn);
    },
    dispatchEvent: () => true,
  };

  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).window = {
    addEventListener: doc.addEventListener,
    dispatchEvent: doc.dispatchEvent,
  };

  return { doc, ls };
}

function cleanupDom(): void {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).window;
}

async function importGui(name: string): Promise<Record<string, unknown>> {
  return import(`../../gui/src/${name}.js`);
}

describe("ThemeEngine", () => {
  beforeEach(() => {
    cleanupDom();
    createDoc();
  });

  it("defaults to dark theme", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { get: () => string };
    const engine = new Cls();
    assert.equal(engine.get(), "dark");
  });

  it("set changes theme and applies CSS variables", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { get: () => string; set: (t: string) => void; getColors: () => Record<string, string> };
    const engine = new Cls();
    engine.set("light");
    assert.equal(engine.get(), "light");
    assert.equal(engine.getColors().bg, "#f5f5f0");
  });

  it("toggle cycles dark -> light -> high-contrast -> dark", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { get: () => string; set: (t: string) => void; toggle: () => string };
    const engine = new Cls();
    engine.set("dark");
    assert.equal(engine.toggle(), "light");
    assert.equal(engine.toggle(), "high-contrast");
    assert.equal(engine.toggle(), "dark");
  });

  it("getColors returns correct palette for each theme", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { set: (t: string) => void; getColors: () => Record<string, string> };
    const engine = new Cls();
    engine.set("dark");
    assert.equal(engine.getColors().bg, "#10110f");
    engine.set("light");
    assert.equal(engine.getColors().bg, "#f5f5f0");
    engine.set("high-contrast");
    assert.equal(engine.getColors().bg, "#000000");
  });

  it("persists and loads theme from localStorage", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { get: () => string; set: (t: string) => void };
    const e1 = new Cls();
    e1.set("light");
    assert.equal(e1.get(), "light");
    const e2 = new Cls();
    assert.equal(e2.get(), "light");
  });

  it("handles corrupt localStorage gracefully", async () => {
    const ls = (globalThis as Record<string, unknown>).localStorage as LocalStore;
    ls.setItem("quack-theme", "nonexistent");
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { get: () => string };
    const engine = new Cls();
    assert.equal(engine.get(), "dark");
  });

  it("apply sets data-theme attribute on documentElement", async () => {
    const { ThemeEngine } = await importGui("theme-engine");
    const Cls = ThemeEngine as new () => { set: (t: string) => void };
    const engine = new Cls();
    engine.set("light");
    const doc = (globalThis as Record<string, unknown>).document as { documentElement: MockElement };
    assert.equal(doc.documentElement.getAttribute("data-theme"), "light");
  });
});

describe("CommandPalette", () => {
  beforeEach(() => {
    cleanupDom();
    const { doc } = createDoc();
    const paletteEl = doc.createElement("div") as MockElement;
    const inputEl = doc.createElement("input") as MockElement;
    const resultsEl = doc.createElement("div") as MockElement;
    paletteEl.id = "commandPalette";
    inputEl.id = "paletteInput";
    resultsEl.id = "paletteResults";
    doc.getElementById = (id: string) => {
      if (id === "commandPalette") return paletteEl;
      if (id === "paletteInput") return inputEl;
      if (id === "paletteResults") return resultsEl;
      return null;
    };
  });

  it("constructor finds DOM elements", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => {
      element: MockElement; input: MockElement; results: MockElement;
      visible: boolean; commands: Array<Record<string, unknown>>;
    };
    const cp = new Cls();
    assert.ok(cp.element);
    assert.ok(cp.input);
    assert.ok(cp.results);
    assert.equal(cp.visible, false);
  });

  it("register adds a command", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => {
      commands: Array<Record<string, unknown>>; register: (cmd: Record<string, unknown>) => void;
    };
    const cp = new Cls();
    cp.register({ label: "Test", keywords: ["test"], execute: () => {} });
    assert.equal(cp.commands.length, 1);
  });

  it("toggle shows/hides palette", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => { visible: boolean; toggle: () => void; element: MockElement };
    const cp = new Cls();
    cp.toggle();
    assert.equal(cp.visible, true);
    cp.toggle();
    assert.equal(cp.visible, false);
  });

  it("render filters and creates buttons", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => {
      register: (cmd: Record<string, unknown>) => void; render: (q: string) => void; results: MockElement;
    };
    const cp = new Cls();
    cp.register({ label: "Git Commit", keywords: ["git", "commit"], execute: () => {} });
    cp.register({ label: "Run Tests", keywords: ["test", "run"], execute: () => {} });
    cp.render("git");
    assert.ok((cp.results.innerHTML as string).includes("Git Commit"));
    assert.ok(!(cp.results.innerHTML as string).includes("Run Tests"));
  });

  it("render shows all when query empty", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => {
      register: (cmd: Record<string, unknown>) => void; render: (q: string) => void; results: MockElement;
    };
    const cp = new Cls();
    cp.register({ label: "Git Commit", keywords: ["git"], execute: () => {} });
    cp.register({ label: "Run Tests", keywords: ["test"], execute: () => {} });
    cp.render("");
    assert.ok((cp.results.innerHTML as string).includes("Git Commit"));
    assert.ok((cp.results.innerHTML as string).includes("Run Tests"));
  });

  it("hide sets visible false", async () => {
    const { CommandPalette } = await importGui("command-palette");
    const Cls = CommandPalette as new () => { visible: boolean; show: () => void; hide: () => void };
    const cp = new Cls();
    cp.show();
    assert.equal(cp.visible, true);
    cp.hide();
    assert.equal(cp.visible, false);
  });
});

describe("WindowManager", () => {
  beforeEach(() => {
    cleanupDom();
    const { doc } = createDoc();
    const missionBtn = doc.createElement("button") as MockElement;
    missionBtn.className = "rail-button";
    missionBtn.setAttribute("data-view", "mission");
    const agentsBtn = doc.createElement("button") as MockElement;
    agentsBtn.className = "rail-button";
    agentsBtn.setAttribute("data-view", "agents");
    const missionPanel = doc.createElement("div") as MockElement;
    missionPanel.className = "view";
    missionPanel.setAttribute("data-view-panel", "mission");
    const agentsPanel = doc.createElement("div") as MockElement;
    agentsPanel.className = "view";
    agentsPanel.setAttribute("data-view-panel", "agents");
    doc.querySelectorAll = (sel: string) => {
      if (sel === ".rail-button") return [missionBtn, agentsBtn];
      if (sel === ".view") return [missionPanel, agentsPanel];
      return [];
    };
  });

  it("constructor discovers views and buttons", async () => {
    const { WindowManager } = await importGui("window-manager");
    const Cls = WindowManager as new () => { views: Map<string, MockElement>; buttons: Map<string, MockElement> };
    const wm = new Cls();
    assert.ok(wm.views.has("mission"));
    assert.ok(wm.views.has("agents"));
    assert.ok(wm.buttons.has("mission"));
    assert.ok(wm.buttons.has("agents"));
  });

  it("show switches active view", async () => {
    const { WindowManager } = await importGui("window-manager");
    const Cls = WindowManager as new () => { show: (v: string) => void; getActive: () => string };
    const wm = new Cls();
    wm.show("agents");
    assert.equal(wm.getActive(), "agents");
  });

  it("show toggles active class on views", async () => {
    const { WindowManager } = await importGui("window-manager");
    const Cls = WindowManager as new () => { views: Map<string, MockElement>; show: (v: string) => void };
    const wm = new Cls();
    const missionView = wm.views.get("mission")!;
    const agentsView = wm.views.get("agents")!;
    wm.show("agents");
    assert.ok(!missionView.classList.contains("active"));
    assert.ok(agentsView.classList.contains("active"));
    wm.show("mission");
    assert.ok(missionView.classList.contains("active"));
    assert.ok(!agentsView.classList.contains("active"));
  });

  it("getActive returns current view", async () => {
    const { WindowManager } = await importGui("window-manager");
    const Cls = WindowManager as new () => { getActive: () => string; show: (v: string) => void };
    const wm = new Cls();
    wm.show("agents");
    assert.equal(wm.getActive(), "agents");
  });

  it("bindEvents attaches click listeners", async () => {
    const { WindowManager } = await importGui("window-manager");
    const Cls = WindowManager as new () => {
      buttons: Map<string, MockElement>; bindEvents: () => void; getActive: () => string;
    };
    const wm = new Cls();
    wm.bindEvents();
    wm.buttons.get("mission")!.click();
    assert.equal(wm.getActive(), "mission");
    wm.buttons.get("agents")!.click();
    assert.equal(wm.getActive(), "agents");
  });
});

describe("NotificationCenter", () => {
  beforeEach(() => {
    cleanupDom();
    createDoc();
  });

  it("constructor creates container in body", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => { container: MockElement; notifications: Array<Record<string, unknown>> };
    const nc = new Cls();
    assert.ok(nc.container);
    assert.equal(nc.notifications.length, 0);
  });

  it("notify adds a notification", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => { notify: (msg: string, type: string, dur: number) => void; notifications: Array<Record<string, unknown>> };
    const nc = new Cls();
    nc.notify("Hello world", "info", 0);
    assert.equal(nc.notifications.length, 1);
    assert.equal(nc.notifications[0].message, "Hello world");
    assert.equal(nc.notifications[0].type, "info");
  });

  it("notify with no expiry stays", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => { notify: (msg: string, type: string, dur: number) => void; notifications: Array<Record<string, unknown>> };
    const nc = new Cls();
    nc.notify("Persistent", "info", 0);
    assert.equal(nc.notifications.length, 1);
  });

  it("dismiss removes a notification", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => {
      notify: (msg: string, type: string, dur: number) => void;
      dismiss: (id: string) => void;
      notifications: Array<Record<string, unknown>>;
    };
    const nc = new Cls();
    nc.notify("Test", "info", 0);
    const id = nc.notifications[0].id as string;
    nc.dismiss(id);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(nc.notifications.length, 0);
  });

  it("dismiss handles unknown id gracefully", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => { dismiss: (id: string) => void };
    const nc = new Cls();
    nc.dismiss("nonexistent");
    assert.ok(true);
  });

  it("notify creates element with correct class", async () => {
    const { NotificationCenter } = await importGui("notification-center");
    const Cls = NotificationCenter as new () => { notify: (msg: string, type: string, dur: number) => void; notifications: Array<Record<string, unknown>> };
    const nc = new Cls();
    nc.notify("Warning!", "warning", 0);
    assert.equal(nc.notifications[0].type, "warning");
    assert.equal(nc.notifications[0].message, "Warning!");
  });
});
