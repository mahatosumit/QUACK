import type { ComputerRuntime } from "./computer-runtime.js";
import type { ActionResult, ComputerAction } from "./types.js";

export interface ComputerSkill {
  name: string;
  description: string;
  supportedApplications: string[];
  requiredPermissions: string[];
  requiredCapabilities: string[];
  execute(params: Record<string, unknown>, executeAction: (action: ComputerAction) => Promise<ActionResult>): Promise<ActionResult>;
}

export class BrowserAutomationSkill implements ComputerSkill {
  name = "browser-automation";
  description = "Automate browser interactions: navigate, click, type, extract";
  supportedApplications = ["chrome", "edge", "firefox", "chromium"];
  requiredPermissions = ["browser"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    const action = params["action"] as string;
    switch (action) {
      case "navigate": return exec({ type: "browser", action: { type: "navigate", url: params["url"] as string } });
      case "click": return exec({ type: "browser", action: { type: "click", selector: params["selector"] as string } });
      case "type": return exec({ type: "browser", action: { type: "type_text", text: params["text"] as string, selector: params["selector"] as string } });
      case "extract": return exec({ type: "browser", action: { type: "extract", selector: params["selector"] as string } });
      case "screenshot": return exec({ type: "browser", action: { type: "screenshot", fullPage: params["fullPage"] as boolean | undefined } });
      case "tabs": return exec({ type: "browser", action: { type: "get_tabs" } });
      case "cookies": return exec({ type: "browser", action: { type: "get_cookies", domain: params["domain"] as string | undefined } });
      default: return { type: "error", error: "UNKNOWN_BROWSER_SKILL_ACTION", message: `Unknown action: ${action}` };
    }
  }
}

export class DesktopAutomationSkill implements ComputerSkill {
  name = "desktop-automation";
  description = "Automate desktop interactions: click, type, move, screenshot";
  supportedApplications = [];
  requiredPermissions = ["mouse", "keyboard", "screen_capture"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    const action = params["action"] as string;
    switch (action) {
      case "click": {
        const x = Number(params["x"] ?? 960);
        const y = Number(params["y"] ?? 540);
        return exec({ type: "mouse", action: { type: "click", target: { x, y } } });
      }
      case "type": return exec({ type: "keyboard", action: { type: "type", text: params["text"] as string } });
      case "screenshot": return exec({ type: "screenshot" });
      case "move": {
        const x = Number(params["x"] ?? 960);
        const y = Number(params["y"] ?? 540);
        return exec({ type: "mouse", action: { type: "move", target: { x, y } } });
      }
      case "scroll": return exec({ type: "mouse", action: { type: "scroll", target: { x: Number(params["x"] ?? 960), y: Number(params["y"] ?? 540) }, deltaX: Number(params["deltaX"] ?? 0), deltaY: Number(params["deltaY"] ?? 1) } });
      default: return { type: "error", error: "UNKNOWN_DESKTOP_SKILL_ACTION", message: `Unknown action: ${action}` };
    }
  }
}

export class OfficeAutomationSkill implements ComputerSkill {
  name = "office-automation";
  description = "Automate office application workflows";
  supportedApplications = ["word", "excel", "powerpoint", "outlook"];
  requiredPermissions = ["application", "keyboard"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    const app = params["application"] as string ?? "notepad";
    return exec({ type: "application", action: { type: "launch", path: app, args: params["args"] as string[] | undefined } });
  }
}

export class TerminalSkill implements ComputerSkill {
  name = "terminal";
  description = "Automate terminal/console interactions";
  supportedApplications = ["cmd", "powershell", "terminal", "bash", "zsh", "iterm2"];
  requiredPermissions = ["application", "keyboard"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    const action = params["action"] as string;
    if (action === "open") {
      return exec({ type: "application", action: { type: "launch", path: (params["terminal"] as string) ?? "cmd" } });
    }
    return exec({ type: "keyboard", action: { type: "type", text: params["command"] as string } });
  }
}

export class VSCodeSkill implements ComputerSkill {
  name = "vscode";
  description = "Automate VS Code workflows";
  supportedApplications = ["code", "vscode", "visual studio code"];
  requiredPermissions = ["application", "keyboard"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    const action = params["action"] as string;
    if (action === "open") {
      return exec({ type: "application", action: { type: "launch", path: "code", args: [params["path"] as string].filter(Boolean) } });
    }
    if (action === "command") {
      return exec({ type: "keyboard", action: { type: "shortcut", keys: ["ctrl", "shift", "p"] } });
    }
    return exec({ type: "keyboard", action: { type: "type", text: params["command"] as string } });
  }
}

export class DockerSkill implements ComputerSkill {
  name = "docker";
  description = "Automate Docker workflows";
  supportedApplications = ["docker"];
  requiredPermissions = ["keyboard"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    return exec({ type: "keyboard", action: { type: "type", text: `docker ${params["command"] as string}` } });
  }
}

export class GitSkill implements ComputerSkill {
  name = "git";
  description = "Automate Git workflows";
  supportedApplications = [];
  requiredPermissions = ["keyboard"];
  requiredCapabilities = [];

  async execute(params: Record<string, unknown>, exec: (a: ComputerAction) => Promise<ActionResult>): Promise<ActionResult> {
    return exec({ type: "keyboard", action: { type: "type", text: `git ${params["command"] as string}` } });
  }
}

export function getBuiltinComputerSkills(): ComputerSkill[] {
  return [
    new BrowserAutomationSkill(),
    new DesktopAutomationSkill(),
    new OfficeAutomationSkill(),
    new TerminalSkill(),
    new VSCodeSkill(),
    new DockerSkill(),
    new GitSkill(),
  ];
}
