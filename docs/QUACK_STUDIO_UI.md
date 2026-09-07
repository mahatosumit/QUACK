# QUACK Control Room

Control Room is the dependency-free browser UI served by the authenticated QUACK
HTTP server at `/dashboard`. It is desktop-first, responsive, dark/light capable,
and keeps runtime authority and credentials on the server.

## Navigation

- **Overview**: runtime truth, mission count, reachable providers, approvals, and
  explicit setup blockers.
- **Missions**: durable mission ledger, submission, dry run, trace, events,
  verification, and evidence.
- **Agents**: registered workers without claiming that idle entries are executing.
- **Models**: Provider Control Center with capability discovery, reachability,
  health-only checks, fallback order, and evidence-based L0/L1 labels.
- **Actions**: provider health, capability risk/approval catalog, durable execution
  ledger, and ambiguous external state.
- **Integrations**: MCP transports, boundaries, enabled state, and health.
- **Browser**: Playwright boundary, action count, and default-deny posture.
- **Files**: workspace and upload containment, not an unrestricted file picker.
- **Approvals**: action approvals and conceptual improvement decisions.
- **Evidence**: mission, experience, decision, and failure records.
- **System**: provider setup, API security, network default, MCP count, and action
  recovery state.
- **Settings**: bounded improvement settings. Hard safety gates cannot be disabled.

## First run and safety

The first-run dialog displays actual local status for runtime, NVIDIA, Ollama,
browser, and network policy. It does not install software, call a model, or expose
credentials. Status is stored locally only to avoid repeating the dialog.

Improvement approval records a human decision but does not create a worktree,
apply source edits, verify a patch, or merge. Action side effects remain governed
by the canonical action runtime and durable ledger.

## Verification

- Real Microsoft Edge E2E covers authenticated load, Models, Actions, keyboard
  focus, theme switching, console errors, and axe analysis.
- axe reported zero serious/critical violations on the exercised journey.
- Dark and light screenshots were captured and inspected at 1920x1080,
  1440x900, and 1366x768. The reproducible harness is
  `scripts/capture-control-room.mjs` (`npm run qa:visual`).
- Unit/server tests verify required navigation, responsive CSS, authenticated
  assets, provider checks, action/MCP/system read models, and protected settings.
