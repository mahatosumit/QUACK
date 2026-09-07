import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { ComputerRuntime } from "./computer-runtime.js";
import { NoopComputerProvider, NoopBrowserProvider } from "./noop-provider.js";
import { ComputerPlanner } from "./computer-planner.js";
import { SessionRecorder } from "./session-recorder.js";
import { MacroEngine } from "./macro-engine.js";
import { ActionValidator } from "./action-validator.js";
import { ComputerMemory } from "./computer-memory.js";
import { VisionRuntime } from "./vision-runtime.js";
import { createUCP, createUCPWithProviders } from "./ucp.js";
import type { ActionResult, SafetyPolicy } from "./types.js";

const SIMPLE_SAFETY: SafetyPolicy = { level: "unrestricted", allowedActions: ["mouse", "keyboard", "clipboard", "window", "application", "browser", "screen_capture", "file_access", "network"], applicationAllowlist: [], applicationDenylist: [], domainAllowlist: [], domainDenylist: [], requireConfirmation: [], maxUndoActions: 50, enableAutomaticRollback: true, auditAllActions: true };

describe("UCP — Computer Runtime", () => {
  let runtime: ComputerRuntime;

  before(() => { runtime = new ComputerRuntime(); });
  after(async () => { await runtime.shutdown(); });

  it("initializes", async () => {
    await runtime.initialize();
    assert.ok(runtime.getProvider());
    assert.ok(runtime.getBrowserProvider());
  });

  it("executes mouse move", async () => {
    const r = await runtime.execute({ type: "mouse", action: { type: "move", target: { x: 100, y: 200 } } });
    assert.equal(r.type, "mouse");
    if (r.type === "mouse") assert.ok(r.result.success);
  });

  it("executes mouse click", async () => {
    const r = await runtime.execute({ type: "mouse", action: { type: "click", target: { x: 500, y: 500 } } });
    if (r.type === "mouse") assert.ok(r.result.success);
  });

  it("executes double click", async () => {
    const r = await runtime.execute({ type: "mouse", action: { type: "double_click", target: { x: 300, y: 300 } } });
    if (r.type === "mouse") assert.ok(r.result.success);
  });

  it("executes mouse drag", async () => {
    const r = await runtime.execute({ type: "mouse", action: { type: "drag", from: { x: 0, y: 0 }, to: { x: 100, y: 100 } } });
    if (r.type === "mouse") assert.ok(r.result.success);
  });

  it("executes scroll", async () => {
    const r = await runtime.execute({ type: "mouse", action: { type: "scroll", target: { x: 500, y: 500 }, deltaX: 0, deltaY: 1 } });
    if (r.type === "mouse") assert.ok(r.result.success);
  });

  it("executes keyboard typing", async () => {
    const r = await runtime.execute({ type: "keyboard", action: { type: "type", text: "hello world" } });
    if (r.type === "keyboard") assert.ok(r.result.success);
  });

  it("executes key press", async () => {
    const r = await runtime.execute({ type: "keyboard", action: { type: "press", key: "enter" } });
    if (r.type === "keyboard") assert.ok(r.result.success);
  });

  it("executes keyboard shortcut", async () => {
    const r = await runtime.execute({ type: "keyboard", action: { type: "shortcut", keys: ["ctrl", "c"] } });
    if (r.type === "keyboard") assert.ok(r.result.success);
  });

  it("executes clipboard get/set", async () => {
    await runtime.execute({ type: "clipboard", action: { type: "set_text", text: "test clipboard" } });
    const r = await runtime.execute({ type: "clipboard", action: { type: "get_text" } });
    if (r.type === "clipboard") assert.equal(r.result.text, "test clipboard");
  });

  it("executes clipboard clear", async () => {
    await runtime.execute({ type: "clipboard", action: { type: "set_text", text: "to clear" } });
    await runtime.execute({ type: "clipboard", action: { type: "clear" } });
    const r = await runtime.execute({ type: "clipboard", action: { type: "get_text" } });
    if (r.type === "clipboard") assert.equal(r.result.text, "");
  });

  it("executes clipboard get files", async () => {
    const r = await runtime.execute({ type: "clipboard", action: { type: "get_files" } });
    if (r.type === "clipboard") assert.deepEqual(r.result.files, []);
  });

  it("executes screenshot", async () => {
    const r = await runtime.execute({ type: "screenshot" });
    assert.equal(r.type, "screenshot");
    if (r.type === "screenshot") assert.ok(r.result.screenshot);
  });

  it("executes get_display_info", async () => {
    const r = await runtime.execute({ type: "get_display_info" });
    if (r.type === "desktop_state") assert.ok(r.result.displays.length > 0);
  });

  it("executes get_desktop_state", async () => {
    const r = await runtime.execute({ type: "get_desktop_state" });
    if (r.type === "desktop_state") {
      assert.ok(r.result.displays);
      assert.ok(r.result.cursorPosition);
      assert.ok(typeof r.result.cursorPosition.x === "number");
    }
  });

  it("executes find_element", async () => {
    const r = await runtime.execute({ type: "find_element" });
    if (r.type === "find_element") assert.ok(Array.isArray(r.result.elements));
  });

  it("executes wait", async () => {
    const start = Date.now();
    const r = await runtime.execute({ type: "wait", durationMs: 50 });
    const elapsed = Date.now() - start;
    if (r.type === "wait") assert.ok(elapsed >= 40, `elapsed ${elapsed}ms`);
  });

  it("executes browser navigate", async () => {
    const r = await runtime.execute({ type: "browser", action: { type: "navigate", url: "https://example.com" } });
    if (r.type === "browser") assert.equal(r.result.url, "https://example.com");
  });

  it("executes browser get tabs", async () => {
    const r = await runtime.execute({ type: "browser", action: { type: "get_tabs" } });
    if (r.type === "browser") assert.ok((r.result.tabs?.length ?? 0) >= 1);
  });

  it("executes browser open/switch/close tab", async () => {
    const openR: ActionResult = await runtime.execute({ type: "browser", action: { type: "open_tab", url: "https://test.com" } });
    assert.equal(openR.type, "browser", `open_tab result type: ${openR.type}`);
    const tabsR: ActionResult = await runtime.execute({ type: "browser", action: { type: "get_tabs" } });
    assert.equal(tabsR.type, "browser", `get_tabs result type: ${tabsR.type}`);
    if (tabsR.type !== "browser") return;
    assert.equal(tabsR.result.tabs!.length, 2);

    const secondTabId = tabsR.result.tabs![1]!.id;
    await runtime.execute({ type: "browser", action: { type: "switch_tab", tabId: secondTabId } });
    await runtime.execute({ type: "browser", action: { type: "close_tab" } });
    const afterClose = await runtime.execute({ type: "browser", action: { type: "get_tabs" } });
    if (afterClose.type === "browser") assert.equal(afterClose.result.tabs!.length, 1);
  });

  it("executes browser cookies", async () => {
    await runtime.execute({ type: "browser", action: { type: "set_cookie", cookie: { name: "test", value: "val", domain: ".example.com", path: "/", secure: false, httpOnly: false, sameSite: "lax" } } });
    const r = await runtime.execute({ type: "browser", action: { type: "get_cookies" } });
    if (r.type === "browser") assert.equal(r.result.cookies!.length, 1);
  });

  it("executes browser back/forward/reload", async () => {
    const r1: ActionResult = await runtime.execute({ type: "browser", action: { type: "back" } });
    assert.equal(r1.type, "browser", `back result type: ${r1.type}`);
    const r2: ActionResult = await runtime.execute({ type: "browser", action: { type: "forward" } });
    assert.equal(r2.type, "browser", `forward result type: ${r2.type}`);
    const r3: ActionResult = await runtime.execute({ type: "browser", action: { type: "reload" } });
    assert.equal(r3.type, "browser", `reload result type: ${r3.type}`);
  });

  it("executes application launch/list/terminate", async () => {
    const launchR = await runtime.execute({ type: "application", action: { type: "launch", path: "notepad" } });
    if (launchR.type === "application") assert.ok(launchR.result.application?.running);
    const listR = await runtime.execute({ type: "application", action: { type: "list_running" } });
    if (listR.type === "application") assert.equal(listR.result.applications!.length, 1);
    if (launchR.type === "application") {
      await runtime.execute({ type: "application", action: { type: "terminate", applicationId: launchR.result.application!.id } });
    }
    const afterTerminate = await runtime.execute({ type: "application", action: { type: "list_running" } });
    if (afterTerminate.type === "application") assert.equal(afterTerminate.result.applications!.length, 0);
  });

  it("enforces safety policy", async () => {
    const restrictedRuntime = new ComputerRuntime({ safetyPolicy: { level: "simulation", allowedActions: [], applicationAllowlist: [], applicationDenylist: [], domainAllowlist: [], domainDenylist: [], requireConfirmation: [], maxUndoActions: 0, enableAutomaticRollback: false, auditAllActions: false } });
    const r = await restrictedRuntime.execute({ type: "mouse", action: { type: "click", target: { x: 0, y: 0 } } });
    assert.equal(r.type, "error");
  });

  it("handles unknown action type gracefully", async () => {
    const r = await runtime.execute({ type: "unknown" as any, action: {} as any });
    assert.equal(r.type, "error");
  });

  it("maintains audit log", async () => {
    const audited = new ComputerRuntime();
    await audited.initialize();
    const before = audited.getAuditLog().length;
    await audited.execute({ type: "screenshot" });
    assert.equal(audited.getAuditLog().length, before + 1);
    await audited.shutdown();
  });

  it("grants and revokes permissions", () => {
    runtime.grantPermission("mouse", true, "testing");
    let perms = runtime.getPermissions();
    assert.ok(perms.has("mouse"));
    runtime.revokePermission("mouse");
    perms = runtime.getPermissions();
    assert.ok(!perms.has("mouse"));
  });

  it("sets and gets safety policy", () => {
    runtime.setSafetyPolicy({ level: "dry_run", allowedActions: ["screen_capture"], applicationAllowlist: [], applicationDenylist: [], domainAllowlist: [], domainDenylist: [], requireConfirmation: [], maxUndoActions: 10, enableAutomaticRollback: false, auditAllActions: false });
    const policy = runtime.getSafetyPolicy();
    assert.equal(policy.level, "dry_run");
    runtime.setSafetyPolicy(SIMPLE_SAFETY);
  });
});

describe("UCP — Computer Planner", () => {
  let runtime: ComputerRuntime;
  let planner: ComputerPlanner;

  before(async () => {
    runtime = new ComputerRuntime();
    await runtime.initialize();
    planner = new ComputerPlanner(runtime);
  });

  it("observes screen", async () => {
    const obs = await planner.observe("screen");
    assert.equal(obs.type, "screen");
  });

  it("observes desktop state", async () => {
    const obs = await planner.observe("focused_window");
    assert.equal(obs.type, "focused_window");
  });

  it("observes all", async () => {
    const all = await planner.observeAll();
    assert.ok(all.length >= 4);
  });

  it("creates a plan for browser navigation", async () => {
    const plan = await planner.createPlan("Navigate to https://example.com");
    assert.ok(plan.steps.length >= 1);
    assert.ok(plan.observations.length >= 4);
  });

  it("creates a plan with a different goal", async () => {
    const plan = await planner.createPlan("Take a screenshot");
    assert.ok(plan.steps.length >= 1);
  });

  it("executes a simple plan", async () => {
    const plan = await planner.createPlan("Take a screenshot");
    const result = await planner.executePlan(plan);
    assert.ok(result.stepResults.length >= 1);
  });

  it("maintains plan history", async () => {
    const history = planner.getPlanHistory();
    assert.ok(history.length >= 2);
  });
});

describe("UCP — Session Recorder", () => {
  let runtime: ComputerRuntime;
  let recorder: SessionRecorder;

  before(async () => {
    runtime = new ComputerRuntime();
    await runtime.initialize();
    recorder = new SessionRecorder(runtime);
  });

  it("starts and stops recording", () => {
    const id = recorder.startRecording("test session");
    assert.ok(id);
    assert.ok(recorder.isRecording());
    const recording = recorder.stopRecording();
    assert.ok(recording);
    assert.equal(recording!.name, "test session");
    assert.ok(!recorder.isRecording());
  });

  it("pauses and resumes recording", () => {
    recorder.startRecording("pause test");
    assert.ok(recorder.pauseRecording());
    assert.ok(recorder.resumeRecording());
    recorder.stopRecording();
  });

  it("records steps during recording", async () => {
    recorder.startRecording("step test");
    const actionR = await runtime.execute({ type: "screenshot" });
    const step = await recorder.recordStep({ type: "screenshot" }, actionR);
    assert.ok(step);
    const recording = recorder.stopRecording();
    assert.equal(recording!.steps.length, 1);
  });

  it("does not record steps when not recording", async () => {
    const step = await recorder.recordStep({ type: "screenshot" }, { type: "error", error: "test", message: "test" });
    assert.equal(step, null);
  });

  it("lists and deletes recordings", () => {
    recorder.startRecording("list test");
    recorder.stopRecording();
    assert.ok(recorder.getAllRecordings().length >= 1);
    const recs = recorder.getAllRecordings();
    const deleted = recorder.deleteRecording(recs[0]!.id);
    assert.ok(deleted);
  });

  it("replays a recording", async () => {
    recorder.startRecording("replay test");
    const r = await runtime.execute({ type: "screenshot" });
    await recorder.recordStep({ type: "screenshot" }, r);
    const recording = recorder.stopRecording();
    const results = await recorder.replay(recording!.id);
    assert.ok(results.length >= 1);
  });

  it("creates id during startRecording", () => {
    const id = recorder.startRecording();
    assert.ok(id);
    recorder.stopRecording();
  });
});

describe("UCP — Macro Engine", () => {
  const engine = new MacroEngine();

  it("registers builtins", () => {
    engine.registerBuiltins();
    const all = engine.getAll();
    assert.ok(all.length >= 4);
  });

  it("registers custom macros", () => {
    engine.register({ id: "custom-1", name: "Custom", version: "1.0", description: "Custom macro", parameters: [], steps: [{ description: "Test", action: { type: "wait", durationMs: 10 } }], tags: [], requiredPermissions: [], supportedApplications: [], platformCompatibility: [], fallbackStrategies: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", usageCount: 0 });
    assert.ok(engine.get("custom-1"));
  });

  it("finds by id", () => {
    const m = engine.get("macro-type-text");
    assert.ok(m);
    assert.equal(m!.name, "Type Text");
  });

  it("executes a macro", async () => {
    const results = await engine.execute("macro-screenshot", {}, async (action) => {
      return { type: "screenshot", result: { screenshot: { id: "ss-1", data: Buffer.from("test"), format: "png", displayId: "d1", bounds: { x: 0, y: 0, width: 100, height: 100 }, capturedAt: "2026-01-01T00:00:00Z" }, durationMs: 1 } };
    });
    assert.equal(results.length, 1);
  });

  it("executes a macro with parameters", async () => {
    const results = await engine.execute("macro-click", { x: 200, y: 300, button: "right" }, async (action) => {
      return { type: "mouse", result: { success: true, durationMs: 1 } };
    });
    assert.equal(results.length, 1);
  });

  it("removes a macro", () => {
    engine.remove("custom-1");
    assert.ok(!engine.get("custom-1"));
  });
});

describe("UCP — Action Validator", () => {
  let validator: ActionValidator;

  before(() => { validator = new ActionValidator(SIMPLE_SAFETY); });

  it("validates allowed actions", () => {
    const result = validator.validate({ type: "screenshot" });
    assert.ok(result.valid);
  });

  it("rejects actions with denylisted applications", () => {
    const strict = new ActionValidator({ ...SIMPLE_SAFETY, applicationDenylist: ["notepad"] });
    const result = strict.validate({ type: "application", action: { type: "launch", path: "notepad.exe" } });
    assert.ok(!result.valid);
  });

  it("rejects actions not in allowlist", () => {
    const strict = new ActionValidator({ ...SIMPLE_SAFETY, applicationAllowlist: ["chrome"] });
    const result = strict.validate({ type: "application", action: { type: "launch", path: "notepad.exe" } });
    assert.ok(!result.valid);
  });

  it("rejects denylisted domains", () => {
    const strict = new ActionValidator({ ...SIMPLE_SAFETY, domainDenylist: ["malware.com"] });
    const result = strict.validate({ type: "browser", action: { type: "navigate", url: "https://malware.com/test" } });
    assert.ok(!result.valid);
  });

  it("validates browser navigation to allowed domains", () => {
    const result = validator.validate({ type: "browser", action: { type: "navigate", url: "https://example.com" } });
    assert.ok(result.valid);
  });

  it("blocks destructive actions in simulation mode", () => {
    const sim = new ActionValidator({ ...SIMPLE_SAFETY, level: "simulation" });
    const result = sim.validate({ type: "keyboard", action: { type: "type", text: "dangerous command" } });
    assert.ok(!result.valid);
  });

  it("generates undo for mouse moves", () => {
    const undo = validator.getUndoAction({ type: "mouse", action: { type: "move", target: { x: 100, y: 100 } } });
    assert.ok(undo);
    if (undo && undo.type === "mouse" && undo.action.type === "move") {
      assert.deepEqual(undo.action.target, { x: 0, y: 0 });
    }
  });

  it("generates undo for minimize", () => {
    const undo = validator.getUndoAction({ type: "window", action: { type: "minimize", windowId: "w1" } });
    assert.ok(undo);
    if (undo && undo.type === "window" && undo.action.type === "restore") {
      assert.equal(undo.action.windowId, "w1");
    }
  });

  it("returns null for non-reversible actions", () => {
    const undo = validator.getUndoAction({ type: "screenshot" });
    assert.equal(undo, null);
  });

  it("updates safety policy", () => {
    validator.setSafetyPolicy({ level: "unrestricted", allowedActions: ["mouse", "keyboard"], applicationAllowlist: [], applicationDenylist: [], domainAllowlist: [], domainDenylist: [], requireConfirmation: [], maxUndoActions: 10, enableAutomaticRollback: false, auditAllActions: false });
    const result = validator.validate({ type: "mouse", action: { type: "click", target: { x: 0, y: 0 } } });
    assert.ok(result.valid);
    validator.setSafetyPolicy(SIMPLE_SAFETY);
  });
});

describe("UCP — Computer Memory", () => {
  const mem = new ComputerMemory(100);

  it("records observations", () => {
    mem.recordObservation({ type: "screen", result: "screenshot-data", timestamp: "2026-01-01T00:00:00Z" }, "test screen");
    const stats = mem.getStats();
    assert.equal(stats.byType["observation"], 1);
  });

  it("records action results", () => {
    mem.recordActionResult({ type: "screenshot" }, { type: "screenshot", result: { screenshot: {} as any, durationMs: 1 } }, "capture screen");
    const stats = mem.getStats();
    assert.equal(stats.byType["action_result"], 1);
  });

  it("records plans", () => {
    mem.recordPlan({ id: "plan-1", goal: "test", steps: [], observations: [], confidence: 0.5, context: "", createdAt: "2026-01-01T00:00:00Z" });
    const plans = mem.getRecentPlans(1);
    assert.equal(plans.length, 1);
  });

  it("records recordings", () => {
    mem.recordRecording({ id: "rec-1", name: "test", steps: [], durationMs: 0, startedAt: "2026-01-01T00:00:00Z", paused: false, tags: ["test"] });
    const stats = mem.getStats();
    assert.equal(stats.byType["recording"], 1);
  });

  it("records learned patterns", () => {
    mem.recordLearnedPattern("always check safety before destructive actions", "safety lesson");
    const stats = mem.getStats();
    assert.equal(stats.byType["learned_pattern"], 1);
  });

  it("queries by type", () => {
    const observations = mem.query(undefined, "observation", 10);
    assert.ok(observations.length >= 1);
    assert.equal(observations[0]!.type, "observation");
  });

  it("queries by tags", () => {
    const tagged = mem.query(["plan"], undefined, 10);
    assert.ok(tagged.length >= 1);
  });

  it("searches by text", () => {
    const results = mem.search("screenshot");
    assert.ok(results.length >= 1);
  });

  it("gets recent observations", () => {
    const recent = mem.getRecentObservations(2);
    assert.ok(recent.length >= 1);
  });

  it("clears memory", () => {
    mem.clear();
    assert.equal(mem.getStats().total, 0);
  });
});

describe("UCP — Vision Runtime", () => {
  let runtime: ComputerRuntime;
  let vision: VisionRuntime;

  before(async () => {
    runtime = new ComputerRuntime();
    await runtime.initialize();
    vision = new VisionRuntime(runtime.getProvider());
  });

  it("performs OCR", async () => {
    const ss = await runtime.getProvider().captureScreen();
    const ocr = await vision.performOcr(ss);
    assert.ok(ocr.language);
  });

  it("detects elements", async () => {
    const ss = await runtime.getProvider().captureScreen();
    const elements = await vision.detectElements(ss);
    assert.ok(Array.isArray(elements));
  });

  it("gets UI tree", async () => {
    const tree = await vision.getUiTree();
    assert.equal(tree.type, "window");
  });

  it("describes screen", async () => {
    const ss = await runtime.getProvider().captureScreen();
    const desc = await vision.describeScreen(ss);
    assert.ok(typeof desc.title === "string");
    assert.ok(typeof desc.interactiveElements === "number");
    assert.ok(typeof desc.summary === "string");
  });

  it("finds elements by text", async () => {
    const ss = await runtime.getProvider().captureScreen();
    const result = await vision.findElementByText("nonexistent", ss);
    assert.equal(result.element, null);
  });

  it("finds elements by type", async () => {
    const ss = await runtime.getProvider().captureScreen();
    const elements = await vision.findElementByType("button", ss);
    assert.ok(Array.isArray(elements));
  });
});

describe("UCP — createUCP factory", () => {
  it("creates a fully wired UCP", () => {
    const ucp = createUCP();
    assert.ok(ucp.runtime);
    assert.ok(ucp.planner);
    assert.ok(ucp.recorder);
    assert.ok(ucp.macros);
    assert.ok(ucp.validator);
    assert.ok(ucp.memory);
    assert.ok(ucp.vision);
  });

  it("creates UCP with custom provider", () => {
    const provider = new NoopComputerProvider();
    const browser = new NoopBrowserProvider();
    const ucp = createUCPWithProviders(provider, browser);
    assert.ok(ucp.runtime);
  });

  it("creates UCP with provided deps", () => {
    const mem = new ComputerMemory();
    const ucp = createUCP({ memory: mem });
    assert.equal(ucp.memory, mem);
  });

  it("register builtins on creation", () => {
    const ucp = createUCP();
    assert.ok(ucp.macros.getAll().length >= 4);
  });
});
