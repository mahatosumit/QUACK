export class WindowManager {
  constructor() {
    this.views = new Map();
    this.buttons = new Map();
    this.activeView = "mission";

    document.querySelectorAll(".view").forEach((el) => {
      const view = el.getAttribute("data-view-panel");
      if (view) this.views.set(view, el);
    });
    document.querySelectorAll(".rail-button").forEach((el) => {
      const view = el.getAttribute("data-view");
      if (view) this.buttons.set(view, el);
    });
  }

  show(view) {
    this.activeView = view;
    this.views.forEach((el, key) => {
      el.classList.toggle("active", key === view);
    });
    this.buttons.forEach((el, key) => {
      el.classList.toggle("active", key === view);
    });
  }

  getActive() { return this.activeView; }

  bindEvents() {
    this.buttons.forEach((btn, view) => {
      btn.addEventListener("click", () => this.show(view));
    });
  }
}
