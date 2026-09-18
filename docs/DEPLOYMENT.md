# QUACK Deployment Guide

**Version:** 1.0.0

## Prerequisites

- Node.js >= 22.5 (runtime; `node:sqlite` coordination requires it; `engines` field is authoritative)
- npm 9+ (package manager)
- Git (for source checkout)

Docker is NOT required. QUACK is an npm package (`@quack/os`) installed and run
directly on the host OS; there is no Docker application deployment artifact
(no Dockerfile, no docker-compose file ships with this repository).

## Application deployment vs execution isolation

These are two different things:

- **Application deployment** — how the QUACK runtime itself is installed and
  started: **npm installation on a single host** (IMPLEMENTED).
- **Execution isolation backend** — where a governed workload step executes:
  the OS-process backend (IMPLEMENTED) or, when a Docker daemon is available
  in the environment, the container backend (BEST_EFFORT, environment
  dependent; fails closed when the daemon is unavailable). Docker is an
  optional *isolation backend*, never a *deployment method* for QUACK itself.

See [docs/deployment/PRODUCTION_TOPOLOGY.md](deployment/PRODUCTION_TOPOLOGY.md)
for the qualified topology.

## Installation

### From the npm package (primary)

```bash
npm install @quack/os
npx quack --version
npx quack doctor
```

### From source

```bash
git clone https://github.com/mahatosumit/QUACK.git
cd QUACK
npm install
npm run build
npx quack start "bootstrap the coding agent"
```

## Modes

### CLI Mode

```bash
npx quack start "analyze the workspace" --workspace ./my-project
npx quack start "refactor the main module"
```

### Server Mode

```bash
npx quack serve
# QUACK Studio + Mission API on http://127.0.0.1:3157/dashboard
```

The server binds loopback only and is authenticated by default; it refuses
non-loopback binding. See [docs/API_SERVER.md](API_SERVER.md).

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| QUACK_OPENAI_API_KEY | — | OpenAI API key for cloud provider |
| NVIDIA_API_KEY | — | NVIDIA NIM API key for cloud provider (never log or persist it) |
| QUACK_NVIDIA_BASE_URL | https://integrate.api.nvidia.com/v1 | NVIDIA NIM OpenAI-compatible base URL |
| QUACK_NVIDIA_MODEL | meta/llama-3.1-70b-instruct | Default NVIDIA NIM model |
| QUACK_DATA_DIR | ./.quack | Data persistence directory (single host, single dataDir) |
| QUACK_WORKSPACE_ROOT | cwd | Default workspace root |

Configuration is validated at construction time and fails closed on invalid
values. A keyless start is supported (echo provider; governed missions still
run; cloud providers simply stay unregistered).

## Production Deployment

1. Install: `npm install @quack/os` (Node >= 22.5, single host)
2. Configure: set environment variables; choose one persistent `QUACK_DATA_DIR`
3. Start: `npx quack serve --port 3157`
4. Monitor: `curl http://127.0.0.1:3157/health` or `quack doctor --json`
5. Back up: see [docs/deployment/DATA_LIFECYCLE.md](deployment/DATA_LIFECYCLE.md)
   (backup format `quack-solo-backup-v1`)

## Platform Support

| Platform | Status |
|----------|--------|
| Windows 10/11 | Supported |
| Ubuntu LTS | Supported |
| Debian | Supported |
| Fedora | Supported |
| macOS | Supported |
| WSL | Supported |
| Docker (as an application deployment artifact) | UNSUPPORTED — no Docker artifact ships with this repository |
| Docker (as an execution isolation backend, daemon-dependent) | BEST_EFFORT — fails closed when no daemon is available |

## Scope boundaries (qualified)

- Single-host deployment with one local filesystem dataDir: IMPLEMENTED.
- SQLite lease coordination within one host: IMPLEMENTED.
- Multi-host / distributed coordination: UNSUPPORTED.
- Docker application deployment: UNSUPPORTED (no artifact exists).
- Exactly-once external effects: UNSUPPORTED (at-most-once dispatch is the
  qualified guarantee).

See [docs/deployment/RELEASE_QUALIFICATION.md](deployment/RELEASE_QUALIFICATION.md)
for the full criterion-by-criterion classification.
