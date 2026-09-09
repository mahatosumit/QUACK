# QUACK

**QUACK** (Quantum Unified Autonomous Cognitive Kernel) is a local-first AI execution runtime: mission goals become governed, evidence-backed workflows with capability-based authorization, deterministic execution, verification, and durable receipts.

[![CI](https://github.com/mahatosumit/QUACK/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)
[![Security Scan](https://github.com/mahatosumit/QUACK/actions/workflows/security-scan.yml/badge.svg)](./.github/workflows/security-scan.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Status: Production Candidate.** QUACK is at the v1 production-candidate stage. See [Platform Support](#platform-support) for exactly what is CI-verified, and [Limitations](#limitations) for honest boundaries.

## What is QUACK?

QUACK turns a goal like *"analyze this workspace and produce a report"* into a **mission**: a planned workflow whose every tool call passes a capability check, whose execution produces evidence, whose completion requires verification, and whose outcome is persisted as a receipt.

It is not a chatbot and it is not an autonomous agent that gets free rein over your machine. It is an execution system with security controls:

- **Missions** — goal submission → deterministic planning → governed workflow execution → verification → receipt.
- **Capability-governed tools** — every tool call (workspace reads, terminal, browser, MCP, delegation) is admitted by the CapabilityBroker against explicit grants. Nothing executes by default.
- **Skills** — governed, declarative capability packs (including a reasoning pack); external skills are statically analyzed and quarantined, never auto-executed.
- **Providers** — optional model-provider adapters (NVIDIA NIM, OpenAI-compatible, vLLM, Ollama, Anthropic, echo). Credentials are read only through the SecretProvider boundary.
- **Recovery** — multi-process mission ownership with lease fencing; crashed missions resume exactly-once with durable checkpoints.
- **QUACK Studio** — a browser control room that is a client of the runtime's authenticated loopback API, not a second engine.

An important architectural distinction: **mission execution is deterministic workflow execution**. Provider model generation (`generate`) is exercised through provider health checks and the model runtime — reasoning nodes do not silently call an LLM. A mission completes because its workflow evidence verifies, not because a model said so.

## Why QUACK?

Most agent frameworks make execution easy and governance an afterthought. QUACK starts from the opposite premise:

1. **One canonical execution path** — every capability flows through `QuackRuntime → CapabilityBroker → governed tool execution → evidence → verification → receipt`. There is no privileged side channel.
2. **Fail closed** — unknown capabilities, missing grants, sandbox escapes, and security failures deny rather than escalate.
3. **Verifiable outcomes** — completion is bound to a verification record over workflow evidence, persisted as a receipt you can inspect later.
4. **Local-first, provider-optional** — everything works on a fresh machine with zero credentials; providers add model-backed reasoning and health-checked generation on top.

## Core Capabilities

| Capability | Where |
| :--- | :--- |
| Governed mission execution | `quack run "<goal>"` |
| Deterministic planning (fresh-machine safe) | Built-in `Planner`; `ExecutiveBrain` when providers are configured |
| Capability-based authorization | CapabilityBroker + explicit grants (standing consent is read-only by default) |
| Workspace tools (list/read/search) | Governed, workspace-rooted, traversal-safe |
| Terminal execution | Explicitly granted only; runs inside the configured workspace |
| Skills (native, reasoning, external) | `quack skills …` — quarantine-first for external material |
| Personas (style-only) | `quack personas` — never capability grants |
| Provider validation | `quack provider list / doctor / test <id>` |
| Multi-process recovery | Ownership leases + fencing; `quack resume <id>` |
| Evidence, verification, receipts | Contract v1 records persisted with every mission |
| Backup / restore | `quack backup` / `quack restore <path>` (verified, secret-free) |
| QUACK Studio (browser control room) | `quack serve` → `http://127.0.0.1:3000/dashboard` |

## Architecture

QUACK has a **single canonical execution path**. There is no second scheduler, second broker, or UI-specific runtime:

```text
QuackRuntime
  → SessionRuntime
  → DefaultLoopDriver
  → WorkflowEngine / ExecutionScheduler
  → CapabilityBroker
  → Policy / Identity / Authorization
  → Execution Admission
  → Sandbox Gate
  → Worker
  → Tool / Skill / MCP / Delegation
  → Evidence
  → Verification
  → Completion / Receipt
```

Briefly:

- **QuackRuntime** — the kernel: owns missions, sessions, task state, and the loop.
- **Planner / Brain** — turns a goal into a task graph. On a fresh machine (no provider credentials) the `SimpleBrain` uses the same deterministic planner as the `ExecutiveBrain`, producing read-only workspace invocations. Neither fabricates elevated calls (terminal, workspace writes); a static planner cannot know those inputs, so such nodes run as reasoning steps unless a graph is explicitly compiled.
- **CapabilityBroker** — every tool request resolves against explicit grants; denials are recorded and enforced.
- **WorkflowEngine** — executes the graph with retries, timeouts, and durable checkpoints (journal + checkpoint stores under the data directory).
- **Evidence → Verification → Receipt** — execution emits evidence; completion requires a verification record (contract v1) bound to that evidence; the outcome is persisted as a receipt.
- **Ownership** — cross-process missions hold a lease in a coordination database; fencing tokens reject stale writers after takeover.

## Installation

Requires **Node.js >= 22.5** (npm included). No build step.

```bash
npm install -g @quack/os
quack --version
```

Shell installers (from the published site once the release is out):

```bash
# Linux / macOS
curl -fsSL https://quack.os/install.sh | bash
# Windows (PowerShell)
irm https://quack.os/install.ps1 | iex
```

> The installers reject unsupported Node versions, missing Node, and unpublished packages, and fail closed on network errors. See [install security notes](docs/install/security/INSTALL_SECURITY.md).

## Quick Start

```bash
quack init            # first run: creates ~/.quack (config, data, logs, skills)
quack doctor --json   # health check: runtime, storage, recovery, security, skills
quack run "list workspace files"   # a real governed mission
quack status          # missions, tasks, and skills summary
```

The first mission above works with **zero provider credentials** — planning is deterministic and the workspace tools are read-only, standing-consent capabilities.

To add model-backed reasoning and provider generation:

```bash
export NVIDIA_API_KEY=nvapi-...   # or QUACK_OPENAI_API_KEY, ANTHROPIC_API_KEY, ...
quack provider doctor             # live health check of every registered provider
```

Credentials are read only through the security layer (allowlisted env vars, consumer-bound); they are never logged or exposed to tools, skills, or the Studio UI.

## CLI

Full reference: [docs/cli/CLI.md](docs/cli/CLI.md). Summary of the actual command surface:

| Command | Purpose |
| :--- | :--- |
| `quack init` | Initialize `~/.quack` |
| `quack doctor [--json]` | Health diagnostics (runtime, storage, recovery, security, skills) |
| `quack status` | Missions/tasks/skills summary |
| `quack run <goal>` | Run a governed mission |
| `quack resume <id>` | Resume an interrupted mission |
| `quack mission <goal>` | Run a mission through the agent loop |
| `quack skills [search\|create\|install\|enable\|disable]` | Skill lifecycle |
| `quack personas` | List style-only personas |
| `quack provider list / doctor / test <id>` | Provider registry + health |
| `quack agents` | List specialist agents |
| `quack trace <goal>` / `quack evaluate <goal>` | Run a mission emitting a harness trace/evaluation |
| `quack serve [--port <p>]` | Start the Studio desktop server (default 3000) |
| `quack config` | Show effective configuration and its sources |
| `quack backup [path]` / `quack restore <path>` | Verified secret-free backup/restore |
| `quack update` / `quack uninstall [--purge-data]` | Self-update / removal |

Global options: `--json` (machine-readable output for any command), `--config/-c <file>`, `--workspace/-w <dir>`, `--data-dir/-d <dir>`, `--port/-p <n>`, `--headless`, `--help`, `--version`.

Exit codes: `0` success · `1` failure · `2` usage error.

## Missions

A **mission** is a goal submitted to the runtime. Its lifecycle:

```text
goal
  → planning (deterministic graph; nodes with tools carry explicit invocations)
  → capability admission (standing consent covers read-only workspace tools only)
  → workflow execution (each node's tools run only if the broker grants them)
  → evidence (every governed call leaves a record)
  → verification (contract-v1 record over workflow evidence)
  → receipt (persisted with the task; inspect via quack status/resume)
```

Example:

```bash
$ quack run "analyze the workspace and search for authentication"
# → the planner emits list-files + code-search invocations
# → the broker admits them under standing consent (read-only)
# → the workflow completes; the mission verifies on workflow evidence
# → receipt persisted; failures fail closed with a typed error
```

Failure semantics are honest: if a node declares tools without invocations, if a capability is denied, or if verification finds no successful evidence, the mission **fails** with a typed error (e.g. `runtime.execution_incomplete`) rather than pretending success. Missions are not guaranteed autonomous completion — they are guaranteed *governed* execution.

Interrupted missions (process crash, lease loss) resume with `quack resume <id>`; a second process cannot execute a mission owned by a live one, and a stale writer's fenced writes are rejected after takeover.

## Skills

Skills are declarative capability packs. Native skills ship with the runtime; the reasoning pack adds governed reasoning aids. Skill **commands**:

```bash
quack skills                  # list registered skills + installed packages
quack skills search <query>    # search configured skill roots (explicit roots only)
quack skills create <id>      # scaffold a new package (never auto-activated)
quack skills install <path>   # import + validate a declarative package
quack skills enable <id>      # activate (explicit step)
quack skills disable <id>
```

Security boundary for external skills:

1. **Static analysis only** — external repositories are read (bounded, read-only), classified by declared requirements (not claims), and security-reviewed (APPROVE / REVIEW / REJECT).
2. **Quarantine-first** — remote material is staged in an isolated quarantine directory; it is never executed.
3. **Explicit human steps** — installation and enablement are separate, explicit actions.
4. **No ambient authority** — installed skills start disabled; enabling grants nothing beyond declared, reviewed permissions; prompt-injection patterns in manifests are rejected.

See [skill ecosystem](docs/skills/ecosystem.md) and [external skill security](docs/security/external-skills.md).

### Reasoning pack

Eight governed, LOW-risk reasoning skills ship in `skills/reasoning/`: `ultrathink`, `skeptic`, `mirror`, `punch`, `no-yap`, `blind-spots`, `ooda`, `artifacts`. They are declarative policy text injected verbatim into mission workflows — read-only, deny-escalation, no network, no secrets. They are reasoning aids, not privileged agents: selecting a persona or reasoning skill never grants a capability.

## Personas

`quack personas` lists style-only personas: `architect`, `researcher`, `debugger`, `security-reviewer`, `product-manager`, `engineer`, `critic`. Personas affect style and reasoning emphasis only — **they cannot grant permissions, tools, or trust**. This is a hard security invariant of the persona framework.

## Providers

```text
Environment / Secret source
  → SecretProvider (allowlist + consumer binding)
  → Provider Adapter
  → CapabilityBroker
  → Provider API
```

Implemented adapters: NVIDIA NIM, OpenAI-compatible, vLLM, Ollama (local), Anthropic, and an in-process echo provider used by tests. Providers auto-register **only when their credential env vars are present**:

| Provider | Environment variable(s) |
| :--- | :--- |
| NVIDIA NIM | `NVIDIA_API_KEY` (+ `QUACK_NVIDIA_BASE_URL`, `QUACK_NVIDIA_MODEL`) |
| OpenAI-compatible | `QUACK_OPENAI_API_KEY` (+ `QUACK_OPENAI_BASE_URL`, `QUACK_OPENAI_MODEL`) |
| vLLM | `QUACK_VLLM_BASE_URL` + `QUACK_VLLM_MODEL` |
| Ollama (local) | `QUACK_OLLAMA_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` |

Provider states are distinct: **registered** (credential present) → **health-checked** (`quack provider doctor` / `test <id>` perform live checks; failures are recorded and fail closed) → **model-runtime capable**. No arbitrary code reads provider credentials directly — the raw environment reads live only inside the security layer, bound to a named consumer.

## Security Model

- **CapabilityBroker** — what execution may do. Every tool call resolves to an explicit grant; standing consent covers read-only workspace reads only; elevated permissions (terminal, workspace write) require explicit grants or an approver.
- **Sandbox gate** — whether execution is admitted at all; denials fail closed.
- **SecretProvider** — the only credential boundary: allowlisted variables, consumer binding, broker-gated runtime reads. Secrets are never logged, never returned to tools, never sent to the browser.
- **Path policy** — every workspace path is validated: traversal (`..`), absolute escape, symlink/junction escape, UNC/device paths, alternate data streams, and NUL are rejected; existing paths are realpath-verified against the trusted root.
- **Skill quarantine** — external skill material is staged, statically reviewed, and never auto-executed (see Skills).
- **Evidence / Verification / Receipts** — completion requires a verification record bound to workflow evidence; outcomes persist as receipts.
- **Ownership & fencing** — multi-process mission writes are lease-fenced; stale writers are rejected after takeover.
- **Fail closed** — every security boundary above denies on doubt rather than escalating.

Honest boundary: the worker backend enforces these **process-level** controls (capability admission, path policy, argv-only process execution with materialized env). It is **not** an OS-level sandbox; plugins/skills executing in-process are trusted code, and stronger OS isolation (containers, seccomp, separate users) is future work. See [threat model](docs/security/THREAT_MODEL.md).

## Privacy

QUACK does **not** scan your computer. Skill discovery reads only **explicitly configured skill roots** and, inside them, only skill manifests. QUACK never automatically reads browser profiles, cookies, passwords, SSH keys, credential stores, unrelated personal files, or unrelated repositories — a separately authorized capability is required for any operation outside its configured workspace and data directories.

## QUACK Studio

Studio is a browser control room — **a client of QuackRuntime**, not a second engine:

```text
Browser / Studio
  → authenticated loopback HTTP API
  → QuackRuntime
```

`quack serve` starts the server (default `http://127.0.0.1:3000/dashboard`). Current areas: missions, skills, providers, agents, memory, settings, events. Provider credentials are never exposed to the browser. Studio inherits the runtime's single execution path, scheduler, broker, and verification — there is no UI-specific mission runtime.

## Configuration

Precedence (highest wins):

```text
CLI arguments  >  QUACK_* environment variables  >  ~/.quack/config/config.json  >  defaults
```

`quack config` prints the effective configuration and where each value came from. Data lives under the data directory (`--data-dir`, default `.quack/` for repo runs; the CLI home is `~/.quack`): tasks, checkpoints/journal, coordination database, audit log, skill registry, receipts. Secrets are never stored in these files — supply credentials through the supported provider environment variables (see [Providers](#providers)).

## Data, Storage & Recovery

- **Mission state** — tasks + plan persisted (`tasks.json`), durable workflow checkpoints and journal.
- **Audit** — append-only, write-serialized event log (`audit.jsonl`).
- **Coordination** — SQLite coordination DB holds ownership leases with fencing epochs; `begin immediate` serializes competing processes.
- **Recovery** — `quack resume <id>` re-acquires (or takes over an expired) ownership, restores the checkpoint, and completes exactly-once: retry-safe tools replay idempotently; acknowledged work is never repeated. A stale process resuming a completed mission receives the stored terminal result without re-executing.
- **Backup** — `quack backup` produces a verified, secret-free archive; `quack restore` verifies then atomically restores.

## Development

```bash
git clone https://github.com/mahatosumit/QUACK.git
cd QUACK
npm install          # or: npm ci
npm run build        # tsc → dist/
npm test             # build + full suite
npm run typecheck    # tsc --noEmit
npm run lint         # typecheck + static-quality checks
npm --prefix sdk test
```

The SDK is a workspace at [`sdk/`](./sdk) (TypeScript client over `@quack/os`; see `sdk/README.md`).

## Testing

Test areas include: runtime and canonical execution, planner, capability broker, provider auth/conformance, skills (discovery, quarantine, execution profiles, adversarial security), personas, storage/coordination, multi-process recovery, verification/receipts, packaging/public-release, CLI, and cross-platform path/process behavior. The suite runs in CI on the full OS × Node matrix (see badges); current snapshot: 1500+ tests, 0 failures expected on every supported platform.

## Project Structure

```text
src/
  runtime/        # QuackRuntime kernel, missions, recovery
  brain/          # planning (SimpleBrain, ExecutiveBrain)
  engine/         # workflow engine, session runtime, planner
  security/       # CapabilityBroker, permissions, secret provider
  skills/         # registry, packages, discovery, intelligence pipeline
  providers/      # provider adapters + conformance
  storage/        # task stores, SQLite repositories, coordination
  platform/       # path policy, process execution, platform adapters
  tools/          # workspace/terminal/git/browser/MCP tools
  telemetry/      # audit log
  cli/            # CLI commands, config, paths
  sdk/            # TypeScript client SDK (workspace)
skills/           # reasoning skill pack (shipped in the package)
docs/             # deep documentation (ADR, security, providers, skills)
installers/       # install.sh / install.ps1
scripts/          # release/packaging/static-quality scripts
.github/          # CI, release, security-scan workflows
```

## Documentation

- [Installation guide](docs/install/INSTALL.md) · [Installer security](docs/install/security/INSTALL_SECURITY.md)
- [CLI reference](docs/cli/CLI.md) · [Quickstart](docs/QUICKSTART.md)
- [Provider setup](docs/providers/setup.md) · [Provider runtime](docs/PROVIDER_RUNTIME.md)
- [Skill ecosystem](docs/skills/ecosystem.md) · [Skill runtime](docs/SKILL_RUNTIME.md) · [External skill security](docs/security/external-skills.md)
- [Personas](docs/agents/personas.md) · [Agents](docs/agents/AGENT_RUNTIME.md)
- [Security](SECURITY.md) · [Threat model](docs/security/THREAT_MODEL.md)
- [Architecture](docs/ARCHITECTURE.md) · [V1 architecture](docs/QUACK_OS_V1_ARCHITECTURE.md)
- [Windows portable packaging](docs/production/WINDOWS_PORTABLE.md) · [Release process](RELEASE_PROCESS.md)
- [ADR index](docs/adr/) · [Full docs index](docs/)

## Platform Support

Evidence-based, from actual CI runs (updated per release):

| Platform | Architecture | Status |
| :--- | :--- | :--- |
| Windows (Server 2025) | x64 | CI-verified (Node 22, 24) |
| Linux (Ubuntu 24.04) | x64 | CI-verified (Node 22, 24) |
| Linux (Ubuntu 24.04) | ARM64 | CI-verified (focused gates, Node 24) |
| macOS (latest) | x64 | CI-verified (Node 22, 24) |
| macOS (14) | ARM64 | CI-verified (focused gates, Node 24) |

Installer smoke tests (real tarball → clean install → CLI exercise) run in CI on Windows/Linux/macOS × Node 22/24. This table reflects the CI matrix actually configured at the time of the latest release; treat any unlisted combination as **not verified**.

## Limitations

- Provider model generation is distinct from deterministic workflow execution; in-mission reasoning nodes do not invoke provider `generate()`. This is by design (verification is evidence-based, not model-based).
- Fresh-machine planning is read-only: a static planner cannot derive inputs for context-dependent tools (terminal, workspace writes), so those surfaces require explicit grants, an approver, or a compiled graph.
- Process-level governance is not an OS-level sandbox; stronger isolation is future work.
- Some Studio API surfaces (security-denials, recovery-state, persona APIs) are post-V1.
- External skill execution requires explicit validation, installation, and enablement — there is no auto-execution path.
- Providers need their own credentials; without them QUACK runs fully but without model-backed reasoning.

## Roadmap

**V1 (current)** — governed mission execution, capability broker, skills + reasoning pack, provider validation, multi-process recovery, verification/receipts, CLI, Studio client, packaging.

**Post-V1** — OS-level worker isolation, model-backed planner integration, expanded Studio APIs, signed installers, additional provider adapters, external skill ecosystem growth.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short:

- One focused PR per change; `npm test`, `npm run typecheck`, `npm run lint` must pass.
- No secrets in commits, logs, or fixtures (deliberate redaction fixtures must be clearly marked).
- Preserve the architecture invariants: single execution path, fail-closed security boundaries, no second runtime/scheduler/broker.
- Security-relevant changes should include adversarial test coverage where feasible.

## Security

See [SECURITY.md](SECURITY.md) for reporting. Security design lives in [docs/security/THREAT_MODEL.md](docs/security/THREAT_MODEL.md); the audit process is documented in [docs/SECURITY_AUDIT_PROCESS.md](docs/SECURITY_AUDIT_PROCESS.md).

## License

[MIT](LICENSE)
