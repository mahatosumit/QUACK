import type { ActionResult, ComputerAction, SafetyPolicy } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  suggestedAction?: ComputerAction;
}

export class ActionValidator {
  private safety: SafetyPolicy;
  private actionHistory: ComputerAction[] = [];

  constructor(safety: SafetyPolicy) {
    this.safety = safety;
  }

  validate(action: ComputerAction, context?: { focusedApp?: string; currentUrl?: string }): ValidationResult {
    if (this.isDesktopAction(action) && !this.canExecuteDesktopAction(action)) {
      return { valid: false, reason: "Desktop action not allowed by safety policy", suggestedAction: undefined };
    }

    if (action.type === "application" && action.action.type === "launch") {
      if (this.safety.applicationDenylist.length > 0) {
        const appName = action.action.path.toLowerCase();
        const denied = this.safety.applicationDenylist.some((d) => appName.includes(d.toLowerCase()));
        if (denied) return { valid: false, reason: `Application '${action.action.path}' is in the denylist` };
      }
      if (this.safety.applicationAllowlist.length > 0) {
        const appName = action.action.path.toLowerCase();
        const allowed = this.safety.applicationAllowlist.some((a) => appName.includes(a.toLowerCase()));
        if (!allowed) return { valid: false, reason: `Application '${action.action.path}' is not in the allowlist` };
      }
    }

    if (action.type === "browser" && action.action.type === "navigate") {
      if (this.safety.domainDenylist.length > 0) {
        try {
          const domain = new URL(action.action.url).hostname;
          const denied = this.safety.domainDenylist.some((d) => domain.includes(d));
          if (denied) return { valid: false, reason: `Domain '${domain}' is in the denylist` };
        } catch {
          return { valid: false, reason: "Invalid URL" };
        }
      }
    }

    if (this.safety.level === "simulation" || this.safety.level === "dry_run") {
      if (this.isDestructiveAction(action)) {
        return { valid: false, reason: `Destructive actions are not allowed in ${this.safety.level} mode`, suggestedAction: undefined };
      }
    }

    this.actionHistory.push(action);
    if (this.actionHistory.length > this.safety.maxUndoActions) {
      this.actionHistory = this.actionHistory.slice(-this.safety.maxUndoActions);
    }

    return { valid: true };
  }

  getUndoAction(action: ComputerAction): ComputerAction | null {
    switch (action.type) {
      case "mouse": {
        const a = action.action;
        if (a.type === "move" || a.type === "click" || a.type === "double_click" || a.type === "hover") {
          return { type: "mouse", action: { type: "move", target: { x: 0, y: 0 } } };
        }
        if (a.type === "drag") return { type: "mouse", action: { type: "drag", from: a.to, to: a.from } };
        return null;
      }
      case "clipboard": {
        if (action.action.type === "set_text" || action.action.type === "clear") {
          const prev = this.findPreviousClipboardContent();
          if (prev !== undefined) return { type: "clipboard", action: { type: "set_text", text: prev } };
        }
        return null;
      }
      case "window": {
        if (action.action.type === "minimize") return { type: "window", action: { type: "restore", windowId: action.action.windowId } };
        if (action.action.type === "maximize") return { type: "window", action: { type: "restore", windowId: action.action.windowId } };
        return null;
      }
      default:
        return null;
    }
  }

  private findPreviousClipboardContent(): string | undefined {
    for (let i = this.actionHistory.length - 1; i >= 0; i--) {
      const a = this.actionHistory[i]!;
      if (a.type === "clipboard" && a.action.type === "get_text") {
        return undefined;
      }
      if (a.type === "clipboard" && (a.action.type === "set_text" || a.action.type === "clear")) {
        return undefined;
      }
    }
    return undefined;
  }

  setSafetyPolicy(policy: SafetyPolicy): void {
    this.safety = policy;
  }

  private isDesktopAction(action: ComputerAction): boolean {
    return ["mouse", "keyboard", "clipboard", "window", "application", "browser"].includes(action.type);
  }

  private canExecuteDesktopAction(_action: ComputerAction): boolean {
    return true;
  }

  private isDestructiveAction(action: ComputerAction): boolean {
    return (
      (action.type === "keyboard" && action.action.type === "type") ||
      (action.type === "application" && (action.action.type === "terminate" || action.action.type === "launch")) ||
      (action.type === "window" && action.action.type === "close")
    );
  }
}
