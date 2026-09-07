import { now } from "../core/types.js";
import type {
  MacroDefinition, MacroParameter, MacroStep, ActionResult,
} from "./types.js";

export class MacroEngine {
  private macros: Map<string, MacroDefinition> = new Map();

  register(definition: MacroDefinition): void {
    this.macros.set(definition.id, definition);
  }

  registerBuiltins(): void {
    this.register({
      id: "macro-type-text", name: "Type Text", version: "1.0", description: "Types text at current cursor position",
      parameters: [{ name: "text", type: "string", description: "Text to type", required: true }],
      steps: [{ description: "Type text", action: { type: "keyboard", action: { type: "type", text: "" } } }],
      tags: ["typing", "input"], requiredPermissions: ["keyboard"],
      supportedApplications: [], platformCompatibility: ["win32", "linux", "darwin"],
      fallbackStrategies: [], createdAt: now(), updatedAt: now(), usageCount: 0,
    });

    this.register({
      id: "macro-screenshot", name: "Take Screenshot", version: "1.0", description: "Captures a screenshot of the current display",
      parameters: [], steps: [{ description: "Capture screenshot", action: { type: "screenshot" } }],
      tags: ["screenshot", "capture"], requiredPermissions: ["screen_capture"],
      supportedApplications: [], platformCompatibility: ["win32", "linux", "darwin"],
      fallbackStrategies: [], createdAt: now(), updatedAt: now(), usageCount: 0,
    });

    this.register({
      id: "macro-click", name: "Click", version: "1.0", description: "Clicks at specified coordinates",
      parameters: [
        { name: "x", type: "number", description: "X coordinate", required: true },
        { name: "y", type: "number", description: "Y coordinate", required: true },
        { name: "button", type: "string", description: "Mouse button", required: false, default: "left" },
      ],
      steps: [{ description: "Click at coordinates", action: { type: "mouse", action: { type: "click", target: { x: 0, y: 0 }, button: "left" } } }],
      tags: ["click", "mouse"], requiredPermissions: ["mouse"],
      supportedApplications: [], platformCompatibility: ["win32", "linux", "darwin"],
      fallbackStrategies: [], createdAt: now(), updatedAt: now(), usageCount: 0,
    });

    this.register({
      id: "macro-navigate", name: "Navigate URL", version: "1.0", description: "Navigates browser to a URL",
      parameters: [{ name: "url", type: "string", description: "URL to navigate to", required: true }],
      steps: [{ description: "Navigate to URL", action: { type: "browser", action: { type: "navigate", url: "" } } }],
      tags: ["browser", "navigation"], requiredPermissions: ["browser"],
      supportedApplications: ["chrome", "edge", "firefox"], platformCompatibility: ["win32", "linux", "darwin"],
      fallbackStrategies: [], createdAt: now(), updatedAt: now(), usageCount: 0,
    });
  }

  get(id: string): MacroDefinition | undefined {
    return this.macros.get(id);
  }

  getAll(): MacroDefinition[] {
    return Array.from(this.macros.values());
  }

  async execute(macroId: string, params: Record<string, unknown>, executeActionFn: (action: any) => Promise<ActionResult>): Promise<ActionResult[]> {
    const macro = this.macros.get(macroId);
    if (!macro) return [];

    const results: ActionResult[] = [];
    const resolvedSteps = this.resolveSteps(macro.steps, params);

    for (const step of resolvedSteps) {
      const resolvedAction = this.resolveActionParams(step.action, params);
      const result = await executeActionFn(resolvedAction);
      results.push(result);
      if (result.type === "error") break;
      macro.usageCount++;
    }

    return results;
  }

  private resolveSteps(steps: MacroStep[], params: Record<string, unknown>): MacroStep[] {
    return steps.map((s) => ({
      ...s,
      action: this.resolveActionParams(s.action, params),
      loop: s.loop ? {
        ...s.loop,
        steps: s.loop.steps,
      } : undefined,
    }));
  }

  private resolveActionParams(action: any, params: Record<string, unknown>): any {
    const resolved = JSON.parse(JSON.stringify(action));
    this.walkAndReplace(resolved, params);
    return resolved;
  }

  private walkAndReplace(obj: any, params: Record<string, unknown>): void {
    if (typeof obj !== "object" || obj === null) return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string" && obj[key].startsWith("$")) {
        const paramName = obj[key].slice(1);
        if (paramName in params) obj[key] = params[paramName];
      } else {
        this.walkAndReplace(obj[key], params);
      }
    }
  }

  remove(id: string): boolean {
    return this.macros.delete(id);
  }
}

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}
