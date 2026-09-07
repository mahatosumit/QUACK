export class NotificationCenter {
  constructor() {
    this.container = document.createElement("div");
    this.container.className = "notification-center";
    Object.assign(this.container.style, {
      position: "fixed", bottom: "16px", right: "16px", zIndex: "100",
      display: "flex", flexDirection: "column", gap: "8px", maxWidth: "360px",
    });
    document.body.appendChild(this.container);
    this.notifications = [];
  }

  notify(message, type = "info", durationMs = 4000) {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.notifications.push({ id, message, type });

    const el = document.createElement("div");
    el.id = id;
    el.className = `notification notification-${type}`;
    el.textContent = message;
    Object.assign(el.style, {
      padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--line)",
      background: "var(--panel)", color: "var(--text)", fontSize: "13px",
      animation: "slideIn 0.2s ease", boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
    });

    el.addEventListener("click", () => this.dismiss(id));
    this.container.appendChild(el);

    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  dismiss(id) {
    const el = document.getElementById(id);
    if (el) {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.2s";
      setTimeout(() => {
        el.remove();
        this.notifications = this.notifications.filter((n) => n.id !== id);
      }, 200);
    }
  }
}
