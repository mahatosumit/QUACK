import { now } from "../core/types.js";
import type { ComputerRuntime } from "./computer-runtime.js";
import type {
  ActionResult, ComputerObservation, ComputerPlan, ComputerPlanStep, ObservationType,
} from "./types.js";

function createId(): string {
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

export class ComputerPlanner {
  private runtime: ComputerRuntime;
  private planHistory: ComputerPlan[] = [];

  constructor(runtime: ComputerRuntime) {
    this.runtime = runtime;
  }

  async observe(type: ObservationType, params?: Record<string, unknown>): Promise<ComputerObservation> {
    let result: unknown;

    switch (type) {
      case "screen": {
        const r = await this.runtime.execute({ type: "screenshot" });
        result = r.type === "screenshot" ? r.result.screenshot : null;
        break;
      }
      case "focused_window": {
        const r = await this.runtime.execute({ type: "get_desktop_state" });
        const state = r.type === "desktop_state" ? r.result : null;
        const focused = state?.windows?.find((w) => w.focused);
        result = focused ?? null;
        break;
      }
      case "active_elements": {
        const r = await this.runtime.execute({ type: "find_element" });
        result = r.type === "find_element" ? r.result.elements : [];
        break;
      }
      case "cursor_position": {
        const pos = await this.runtime.getProvider().getCursorPosition();
        result = pos;
        break;
      }
      case "application_state": {
        const r = await this.runtime.execute({ type: "application", action: { type: "list_running" } });
        result = r.type === "application" ? r.result.applications : [];
        break;
      }
      case "clipboard_content": {
        const text = await this.runtime.getProvider().getClipboardText();
        result = text;
        break;
      }
      case "ocr": {
        const r = await this.runtime.execute({ type: "screenshot" });
        if (r.type === "screenshot") {
          const ocr = await this.runtime.getProvider().ocrImage(r.result.screenshot);
          result = ocr;
        }
        break;
      }
      case "ui_tree": {
        const tree = await this.runtime.getProvider().getUiTree();
        result = tree;
        break;
      }
    }

    const observation: ComputerObservation = { type, result, timestamp: now() };
    return observation;
  }

  async observeAll(): Promise<ComputerObservation[]> {
    const types: ObservationType[] = ["screen", "focused_window", "active_elements", "cursor_position", "application_state", "clipboard_content", "ui_tree"];
    const results = await Promise.all(types.map((t) => this.observe(t)));
    return results;
  }

  async createPlan(goal: string, context?: string): Promise<ComputerPlan> {
    const observations = await this.observeAll();
    const steps = this.generateSteps(goal, observations);

    const plan: ComputerPlan = {
      id: createId(),
      goal,
      steps,
      observations,
      confidence: 0.5,
      context: context ?? "",
      createdAt: now(),
    };

    this.planHistory.push(plan);
    return plan;
  }

  async executePlan(plan: ComputerPlan): Promise<{ stepResults: ActionResult[]; success: boolean }> {
    const stepResults: ActionResult[] = [];
    for (const step of plan.steps) {
      const result = await this.executeStepWithRetry(step);
      stepResults.push(result);
      if (result.type === "error" && !step.retryOnFailure) {
        return { stepResults, success: false };
      }
    }
    return { stepResults, success: stepResults.every((r) => r.type !== "error") };
  }

  private async executeStepWithRetry(step: ComputerPlanStep): Promise<ActionResult> {
    for (let attempt = 0; attempt <= step.maxRetries; attempt++) {
      const result = await this.runtime.execute(step.action);
      if (result.type !== "error") return result;
      if (attempt < step.maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
    if (step.fallback) return this.runtime.execute(step.fallback);
    const lastResult = await this.runtime.execute(step.action);
    return lastResult;
  }

  private generateSteps(goal: string, observations: ComputerObservation[]): ComputerPlanStep[] {
    const goalLower = goal.toLowerCase();

    if (goalLower.includes("navigate") || goalLower.includes("browser") || goalLower.includes("open") || goalLower.includes("search")) {
      return this.generateBrowserSteps(goal);
    }
    if (goalLower.includes("launch") || goalLower.includes("start") || goalLower.includes("run") || goalLower.includes("open app")) {
      return this.generateLaunchSteps(goal);
    }
    if (goalLower.includes("type") || goalLower.includes("write") || goalLower.includes("enter") || goalLower.includes("fill")) {
      return this.generateTypeSteps(goal);
    }
    if (goalLower.includes("click") || goalLower.includes("press") || goalLower.includes("select")) {
      return this.generateClickSteps(goal);
    }
    if (goalLower.includes("screenshot") || goalLower.includes("capture") || goalLower.includes("screen")) {
      return this.generateScreenshotSteps(goal);
    }

    return [{
      id: createId(), description: `Observe current state`, action: { type: "get_desktop_state" },
      expectedOutcome: "Desktop state retrieved", verificationMethod: "screenshot", timeoutMs: 10000,
      retryOnFailure: true, maxRetries: 2,
    }];
  }

  private generateBrowserSteps(goal: string): ComputerPlanStep[] {
    const urlMatch = goal.match(/https?:\/\/[^\s]+/);
    return [
      { id: createId(), description: "Open browser tab", action: { type: "browser", action: { type: "open_tab" } }, expectedOutcome: "Tab opened", verificationMethod: "url_changed", timeoutMs: 10000, retryOnFailure: true, maxRetries: 2 },
      { id: createId(), description: `Navigate to ${urlMatch?.[0] ?? goal}`, action: { type: "browser", action: { type: "navigate", url: urlMatch?.[0] ?? goal } }, expectedOutcome: "Page loaded", verificationMethod: "url_changed", timeoutMs: 30000, retryOnFailure: true, maxRetries: 3, fallback: { type: "browser", action: { type: "navigate", url: urlMatch?.[0] ?? goal } } },
    ];
  }

  private generateLaunchSteps(goal: string): ComputerPlanStep[] {
    const appMatch = goal.match(/(?:launch|start|open|run)\s+(\w+(?:\s+\w+)*)/i);
    const appName = appMatch?.[1] ?? goal;
    return [{ id: createId(), description: `Launch ${appName}`, action: { type: "application", action: { type: "launch", path: appName } }, expectedOutcome: `${appName} launched`, verificationMethod: "application_state", timeoutMs: 15000, retryOnFailure: true, maxRetries: 2 }];
  }

  private generateTypeSteps(_goal: string): ComputerPlanStep[] {
    return [{ id: createId(), description: "Type text", action: { type: "keyboard", action: { type: "type", text: _goal } }, expectedOutcome: "Text typed", verificationMethod: "text_appears", timeoutMs: 5000, retryOnFailure: true, maxRetries: 1 }];
  }

  private generateClickSteps(_goal: string): ComputerPlanStep[] {
    return [{ id: createId(), description: "Click at current position", action: { type: "mouse", action: { type: "click", target: { x: 960, y: 540 } } }, expectedOutcome: "Click performed", verificationMethod: "screenshot", timeoutMs: 5000, retryOnFailure: true, maxRetries: 2 }];
  }

  private generateScreenshotSteps(_goal: string): ComputerPlanStep[] {
    return [{ id: createId(), description: "Capture screenshot", action: { type: "screenshot" }, expectedOutcome: "Screenshot taken", verificationMethod: "screenshot", timeoutMs: 5000, retryOnFailure: true, maxRetries: 1 }];
  }

  getPlanHistory(): ComputerPlan[] {
    return [...this.planHistory];
  }
}
