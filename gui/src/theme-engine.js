const themes = {
  dark: {
    bg: "#10110f", panel: "#191b17", panel2: "#20241e",
    line: "#343a32", text: "#f4f1e8", muted: "#a7afa0",
    accent: "#8fe388", accent2: "#79d8d1", warning: "#f0c36b",
    error: "#ee7c68", focus: "#d7ff6f", ink: "#0c0e0b",
    surface: "#0d100c",
  },
  light: {
    bg: "#f5f5f0", panel: "#ffffff", panel2: "#f0f0eb",
    line: "#d4d4cc", text: "#1a1a18", muted: "#6b6b63",
    accent: "#2b7a2b", accent2: "#1a6b6b", warning: "#b8860b",
    error: "#cc3333", focus: "#4a90d9", ink: "#0c0e0b",
    surface: "#eaeae5",
  },
  "high-contrast": {
    bg: "#000000", panel: "#111111", panel2: "#1a1a1a",
    line: "#ffffff", text: "#ffffff", muted: "#cccccc",
    accent: "#00ff00", accent2: "#00ffff", warning: "#ffff00",
    error: "#ff0000", focus: "#ffffff", ink: "#000000",
    surface: "#0a0a0a",
  },
};

export class ThemeEngine {
  constructor() {
    this.current = "dark";
    this.loadSaved();
  }

  get() { return this.current; }

  set(theme) {
    this.current = theme;
    this.apply();
    this.save();
  }

  toggle() {
    const list = ["dark", "light", "high-contrast"];
    const idx = list.indexOf(this.current);
    this.set(list[(idx + 1) % list.length]);
    return this.current;
  }

  getColors() { return themes[this.current]; }

  apply() {
    const c = this.getColors();
    const root = document.documentElement;
    for (const [key, val] of Object.entries(c)) {
      const prop = key === "accent" ? "--green"
        : key === "accent2" ? "--cyan"
        : key === "warning" ? "--amber"
        : key === "error" ? "--red"
        : `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
      root.style.setProperty(prop, val);
    }
    root.setAttribute("data-theme", this.current);
  }

  loadSaved() {
    try {
      const saved = localStorage.getItem("quack-theme");
      if (saved && themes[saved]) this.current = saved;
    } catch {}
  }

  save() {
    try { localStorage.setItem("quack-theme", this.current); } catch {}
  }
}
