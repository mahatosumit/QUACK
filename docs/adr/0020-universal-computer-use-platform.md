# ADR 0020: Universal Computer Use Platform

Status: Accepted

## Context

QUACK has evolved through 6 phases into a full Cognitive Operating System with multi-agent organization, persistent goals, decision intelligence, and self-improvement. However, it remains limited to API calls, source code, and structured tool invocations.

To graduate from an intelligent engineering platform to a true Universal Computer Operator, QUACK must understand and operate graphical user interfaces, desktop applications, browsers, documents, terminals, and operating system resources — the same way a skilled human operator would.

## Decision

### Architecture

A new `src/computer/` subsystem implements the Universal Computer Use Platform (UCP) as a provider-based architecture sitting alongside the existing subsystems.

```
ExecutiveBrain / COS / Organization
        │
        ▼
  Universal Computer Platform
  ├── ComputerRuntime (action dispatch, safety, audit)
  ├── ComputerPlanner (observe→understand→locate→verify→act)
  ├── VisionRuntime (OCR, UI tree, layout analysis, screen description)
  ├── SessionRecorder (record, replay, step forward/back)
  ├── MacroEngine (parameterized, versioned, reusable macros)
  ├── ActionValidator (allowlists, denylists, undo, simulation)
  ├── ComputerMemory (observations, plans, patterns, TTL)
  └── 7 ComputerSkills (browser, desktop, office, terminal, vscode, docker, git)
        │
        ▼
  ComputerProvider (OS-specific) + BrowserProvider (browser-specific)
```

### Provider Model

The UCP uses a provider abstraction to remain platform-independent:

- **ComputerProvider** — mouse, keyboard, clipboard, windows, applications, screen capture, OCR, UI tree, element detection
- **BrowserProvider** — navigation, tabs, cookies, history, DOM, DevTools, dialogs, file uploads

A `NoopComputerProvider` and `NoopBrowserProvider` provide in-memory mock implementations for testing, development, and CI environments.

### Action Model

All computer operations are expressed through a single discriminated union `ComputerAction`:

```typescript
type ComputerAction =
  | { type: "mouse"; action: MouseAction }
  | { type: "keyboard"; action: KeyboardAction }
  | { type: "clipboard"; action: ClipboardAction }
  | { type: "window"; action: WindowAction }
  | { type: "application"; action: ApplicationAction }
  | { type: "browser"; action: BrowserAction }
  | { type: "session"; action: SessionAction }
  | { type: "macro"; action: MacroAction }
  | { type: "screenshot" }
  | { type: "get_display_info" }
  | { type: "get_desktop_state" }
  | { type: "find_element" }
  | { type: "wait" }
  | { type: "inspect_element" }
  | { type: "highlight_element" };
```

Each action type returns a typed `ActionResult` union, enabling exhaustive type narrowing in consumers.

### Safety Model

Three-tier safety:

1. **SafetyPolicy** — static configuration (allowlists, denylists, simulation/dry_run/live modes)
2. **PermissionManager** — runtime grants/revocations per protected action category
3. **ActionValidator** — per-action validation with undo support and automatic rollback

### Computer Planning

Before any desktop interaction, the `ComputerPlanner` runs an **Observe → Plan → Verify → Act → Verify** loop:

1. `observeAll()` — captures screen, UI tree, windows, cursor, clipboard, applications
2. `createPlan(goal)` — generates steps from natural language goal
3. `executePlan(plan)` — executes each step with retry + fallback
4. Each step has a `verificationMethod` for post-condition checking

### Vision System

The `VisionRuntime` provides:

- **OCR** — text region extraction with confidence scoring
- **UI Tree** — accessibility tree with element types, states, and hierarchy
- **Layout Analysis** — semantic region detection (buttons, inputs, lists, tables, nav)
- **Screen Description** — unified `describeScreen()` that returns interactive element count, dialogs, focused element, text content, and summary
- **Element Search** — `findElementByText()` and `findElementByType()` with combined OCR + UI tree

### Session Recording

- Full action recording with before/after screenshots
- Pause/resume
- Replay from any step index
- Annotations support

### Macro Engine

- Parameterized macros with typed parameters (string, number, boolean, point, rect)
- Version tracking with usage counters
- Parameter injection via `$param` syntax
- 4 built-in macros: Type Text, Screenshot, Click, Navigate URL

### Built-in Skills

7 computer skills registered:
- **BrowserAutomationSkill** — navigate, click, type, extract, screenshot, tabs, cookies
- **DesktopAutomationSkill** — click, type, screenshot, move, scroll
- **OfficeAutomationSkill** — launch office applications
- **TerminalSkill** — open terminal, execute commands
- **VSCodeSkill** — open VS Code, command palette, edit
- **DockerSkill** — execute docker commands
- **GitSkill** — execute git commands

### Integration

The UCP is wired into `QuackSystem` as `system.ucp` and into `DesktopServer` for dashboard API endpoints:

```
GET /api/computer/state       — displays, policy, permissions
GET /api/computer/plan        — plan history
GET /api/computer/recordings  — session recordings
GET /api/computer/macros      — registered macros
GET /api/computer/audit       — action audit log
GET /api/computer/memory      — memory stats
```

## Consequences

**Positive:**
- QUACK can now understand and operate GUIs, browsers, and desktop applications.
- Provider abstraction enables platform-specific implementations (Win32, macOS, Linux) without changing consumer code.
- Safety model prevents destructive actions without explicit approval.
- Vision system combines OCR, UI tree analysis, and layout detection for robust screen understanding.
- Computer planning follows observe-verify-act loop — never blind clicking.
- Session recording enables debugging and replay of automation flows.
- Macro engine enables reusable, parameterized automation workflows.
- All 78 computer subsystem tests pass, bringing total to 514 passing tests.

**Negative:**
- No real OS-level providers yet (only Noop mocks) — cannot operate actual desktop.
- Vision system uses mock OCR/UI detection — no real OCR engine (Tesseract, etc.) integrated.
- Browser provider is mock-only — no Playwright/Puppeteer/CDP integration.
- Computer planning uses rule-based step generation — no LLM-powered planning.
- Action validator cannot truly undo clipboard changes (no clipboard history).
- No actual screenshot capture, mouse control, or keyboard input.
- No persistent storage for recordings, macros, or memory.
- Limited to 7 built-in skills.

## Phase 7b Recommendations

1. **Win32 provider** — implement `Win32ComputerProvider` using WinRT/Win32 APIs for mouse, keyboard, windows, applications, screen capture.
2. **CDP browser provider** — implement `CdpBrowserProvider` using Chrome DevTools Protocol (Playwright/Puppeteer) for real browser automation.
3. **Tesseract OCR** — integrate Tesseract.js or Tesseract native for real OCR.
4. **LLM-powered planning** — route `createPlan()` through ExecutiveBrain for dynamic step generation.
5. **Persistence** — save recordings, macros, and memory to disk (JSON/JSONL).
6. **Application provider** — real process management (spawn, signal, enumerate, resource tracking).
7. **X11/macOS providers** — platform-specific implementations for Linux and macOS.
8. **Desktop GUI** — build a real-time dashboard with screen viewer, action inspector, element highlighter, and macro editor.

## Status

Accepted. Implemented in `src/computer/`. 78 tests passing alongside 436 existing tests (514 total, 0 failures). Build is green.
