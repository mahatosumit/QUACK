export class CommandPalette {
  constructor() {
    this.element = document.getElementById("commandPalette");
    this.input = document.getElementById("paletteInput");
    this.results = document.getElementById("paletteResults");
    this.commands = [];
    this.visible = false;
  }

  register(cmd) {
    this.commands.push(cmd);
  }

  toggle() {
    this.visible = !this.visible;
    this.element.hidden = !this.visible;
    if (this.visible) {
      this.input.value = "";
      this.input.focus();
      this.render("");
    }
  }

  show() {
    this.visible = true;
    this.element.hidden = false;
    this.input.value = "";
    this.input.focus();
    this.render("");
  }

  hide() {
    this.visible = false;
    this.element.hidden = true;
  }

  render(query) {
    const lower = query.toLowerCase();
    const filtered = this.commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(lower) ||
      cmd.keywords.some((k) => k.toLowerCase().includes(lower)),
    );

    this.results.innerHTML = filtered
      .map((cmd, i) => `<button class="palette-result" data-index="${i}">${cmd.label}</button>`)
      .join("");

    this.results.querySelectorAll(".palette-result").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        filtered[i].execute();
        this.hide();
      });
    });
  }

  bindEvents() {
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === "Escape") this.hide();
    });

    this.input.addEventListener("input", (e) => {
      this.render(e.target.value);
    });

    this.element.addEventListener("click", (e) => {
      if (e.target === this.element) this.hide();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = this.results.querySelector(".palette-result");
        first?.click();
      }
    });
  }
}
