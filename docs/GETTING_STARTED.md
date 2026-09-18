# QUACK Getting Started Guide

## Introduction

QUACK is an open-source AI Operating System that orchestrates autonomous software engineering. This guide will help you get QUACK running, understand the basic concepts, and complete your first tasks.

## Prerequisites

- **Node.js** >= 20 ([download](https://nodejs.org/))
- **npm** (included with Node.js)
- **Git** ([download](https://git-scm.com/))
- **Terminal** (PowerShell, bash, or zsh)

**No external services required** — QUACK runs with its built-in echo provider by default.

## Installation

### From Source

```bash
git clone https://github.com/mahatosumit/QUACK.git
cd QUACK
npm install
npm run build
```

### Verify Installation

```bash
node dist/cli.js --version
# Should output: 1.0.0

node dist/cli.js --help
# Shows available commands
```

## Quick Start

### 1. Run a Simple Goal (CLI)

```bash
node dist/cli.js start --goal "List files in the current workspace"
```

This will:
1. Start QUACK with the built-in echo provider
2. Decompose the goal into tasks
3. Execute the workspace filesystem tool
4. Return the result

### 2. Start the Control Room (QUACK Studio)

```bash
quack serve
```

The server starts on loopback (default port 3157) with:
- QUACK Studio at `/dashboard` — Mission Control, Console, Approval
  Center, Trace Center, Artifacts, Audit, Operations
- Live event stream (SSE) with payload redaction
- Session-authenticated Mission API

Check it's running:

```bash
curl http://127.0.0.1:3157/health
# Returns: {"ok":true,...}
```

> The retired desktop server (`node dist/desktop-app.js`) was removed in
> P7. `quack serve` is the one canonical local surface.

### 3. Explore the Architecture

- **Agents:** `GET /agents` — registered specialists and assignment state
- **Missions:** `GET /missions` — durable mission records
- **Traces:** `GET /traces/{id}` — execution timelines
- **Audit:** `GET /audit` — governance record

### 4. Run Tests

```bash
npm test
# 786+ tests, 0 failures expected
```

## Understanding the Architecture

QUACK is organized into 26 modules across 12 phases:

```
                     ┌──────────────────────┐
                     │   Executive Brain    │
                     │   + Simple Brain     │
                     └──────────┬───────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
   ┌──────┴──────┐     ┌───────┴────────┐    ┌───────┴──────┐
   │     COS     │     │ Organization   │    │    SEA       │
   │  Cognitive  │     │ (18 Agents)    │    │   Software   │
   │     OS      │     │ + Comm Bus     │    │  Engineering │
   │             │     │ + Shared Mem   │    │    Agent     │
   └─────────────┘     └────────────────┘    └──────────────┘
```

Each module has a specific role. The key ones:

| Module | Purpose |
|--------|---------|
| **Executive Brain** | Goal decomposition, task planning, orchestration |
| **Organization** | 18 specialized AI agents with communication bus |
| **COS** | Cognitive Operating System — high-level reasoning |
| **SEA** | Software Engineering Agent — code editing, testing, review |
| **AIRM** | AI Runtime Manager — model lifecycle, benchmarking |
| **UCP** | Universal Computer Platform — GUI automation |
| **DNPL** | Distributed Native Platform Layer — multi-machine |
| **Adaptive** | Experimental interfaces; execution and distillation require configured executors and are otherwise unsupported |

## Next Steps

1. **Read the [Architecture Book](./ARCHITECTURE_BOOK.md)** for deep system understanding
2. **Browse the [API Reference](./API_REFERENCE.md)** for all available endpoints
3. **Try the examples** in the `examples/` directory
4. **Review the [ADRs](./adr/)** for architectural decisions
5. **Read [CONTRIBUTING.md](../CONTRIBUTING.md)** to start contributing

## Troubleshooting

If you encounter issues:

1. Run `npm run build` to ensure the latest code is compiled
2. Check `.quack/` runtime state files if something seems stuck
3. Run with `node --inspect` for debugging
4. Check the audit log at `.quack/audit.jsonl`

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues.
